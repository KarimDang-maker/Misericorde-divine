import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { dateRangeClause, normalizeDateRange, requireDate } from "../utils/dates.js"
import { fromCents, money, toCents } from "../utils/money.js"
import { likePattern, normalizeSearchTerm, paginationMeta } from "../utils/pagination.js"
import { createAuditLog } from "./audit.js"

export const ACCOUNT_TYPES = ["caisse", "banque"]

const optionalText = (max) =>
  z.string().trim().max(max).nullish().transform((v) => v || null)

export const accountSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,30}$/, "2 à 30 caractères : lettres, chiffres, - ou _"),
  nom: z.string().trim().min(2).max(150),
  type: z.enum(ACCOUNT_TYPES),
  banque: optionalText(150),
  numeroCompte: optionalText(60),
  soldeInitial: z.union([z.string(), z.number()]).default("0"),
  autoriserSoldeNegatif: z.boolean().default(false),
})
export const accountUpdateSchema = z.object({
  nom: z.string().trim().min(2).max(150).optional(),
  banque: optionalText(150).optional(),
  numeroCompte: optionalText(60).optional(),
  autoriserSoldeNegatif: z.boolean().optional(),
})

const accountFromRow = (r) => ({
  id: r.id,
  code: r.code,
  nom: r.nom,
  type: r.type,
  banque: r.banque,
  numeroCompte: r.numero_compte,
  soldeInitial: money(r.solde_initial),
  autoriserSoldeNegatif: Boolean(r.autoriser_solde_negatif),
  actif: Boolean(r.actif),
  solde: r.solde !== undefined ? money(r.solde) : undefined,
  createdAt: r.created_at,
})

const BALANCE_SQL = `a.solde_initial + COALESCE(SUM(CASE m.sens WHEN 'entree' THEN m.montant ELSE -m.montant END), 0)`

/**
 * Définition du solde : solde initial + somme des entrées − somme des sorties de tous les
 * mouvements (annulations incluses via leurs contre-écritures), éventuellement jusqu'à une date.
 */
export async function listAccounts(filters = {}) {
  const where = []
  const params = []
  if (filters.type) {
    if (!ACCOUNT_TYPES.includes(filters.type)) {
      throw unprocessable("TYPE_INVALIDE", "Type de compte invalide.", { type: "caisse ou banque" })
    }
    where.push("a.type = ?")
    params.push(filters.type)
  }
  if (filters.actif !== undefined && filters.actif !== "") {
    where.push("a.actif = ?")
    params.push(filters.actif === "true" || filters.actif === true || filters.actif === "1" ? 1 : 0)
  }
  const term = normalizeSearchTerm(filters.q)
  if (term) {
    const like = likePattern(term)
    where.push("(a.code LIKE ? OR a.nom LIKE ? OR a.banque LIKE ? OR a.numero_compte LIKE ?)")
    params.push(like, like, like, like)
  }
  const list = await rows(
    null,
    `SELECT a.*, ${BALANCE_SQL} AS solde FROM financial_accounts a
     LEFT JOIN financial_movements m ON m.account_id = a.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY a.id ORDER BY a.type ASC, a.nom ASC`,
    params,
  )
  return list.map(accountFromRow)
}

export async function getAccountById(id, executor = null) {
  const row = await one(
    executor,
    `SELECT a.*, ${BALANCE_SQL} AS solde FROM financial_accounts a
     LEFT JOIN financial_movements m ON m.account_id = a.id WHERE a.id = ? GROUP BY a.id`,
    [id],
  )
  if (!row) throw notFound("COMPTE_NOT_FOUND", "Le compte demandé est introuvable.")
  return accountFromRow(row)
}

export async function findAccountByCode(code, executor = null) {
  return one(executor, "SELECT * FROM financial_accounts WHERE code = ?", [code])
}

export async function getAccountBalance(id, asOfDate, executor = null) {
  const date = asOfDate ? requireDate(asOfDate, "date") : null
  const row = await one(
    executor,
    `SELECT a.id, a.code, a.nom, ${BALANCE_SQL} AS solde,
            COALESCE(SUM(CASE m.sens WHEN 'entree' THEN m.montant END), 0) AS entrees,
            COALESCE(SUM(CASE m.sens WHEN 'sortie' THEN m.montant END), 0) AS sorties
     FROM financial_accounts a
     LEFT JOIN financial_movements m ON m.account_id = a.id ${date ? "AND m.date_operation <= ?" : ""}
     WHERE a.id = ? GROUP BY a.id`,
    date ? [date, id] : [id],
  )
  if (!row) throw notFound("COMPTE_NOT_FOUND", "Le compte demandé est introuvable.")
  return {
    compteId: row.id,
    code: row.code,
    nom: row.nom,
    aLaDate: date,
    solde: money(row.solde),
    totalEntrees: money(row.entrees),
    totalSorties: money(row.sorties),
  }
}

export async function createAccount(data, ctx, executor = null) {
  const initial = toCents(data.soldeInitial)
  if (initial === null) {
    throw unprocessable("MONTANT_INVALIDE", "Solde initial invalide.", { soldeInitial: "Montant invalide" })
  }
  if (initial < 0 && !data.autoriserSoldeNegatif) {
    throw unprocessable("SOLDE_INITIAL_NEGATIF", "Un solde initial négatif exige d'autoriser le solde négatif.", {
      soldeInitial: "Négatif non autorisé",
    })
  }
  const work = async (conn) => {
    if (await findAccountByCode(data.code, conn)) {
      throw conflict("COMPTE_DOUBLON", "Ce code de compte existe déjà.", { code: "Déjà utilisé" })
    }
    const result = await run(
      conn,
      `INSERT INTO financial_accounts (code, nom, type, banque, numero_compte, solde_initial, autoriser_solde_negatif)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.code, data.nom, data.type, data.banque, data.numeroCompte, fromCents(initial), data.autoriserSoldeNegatif ? 1 : 0],
    )
    const created = await getAccountById(result.insertId, conn)
    await createAuditLog(conn, { ctx, action: "CREATE", entityType: "account", entityId: created.id, after: created })
    return created
  }
  return executor ? work(executor) : withTransaction(work)
}

export async function updateAccount(id, patch, ctx, executor = null) {
  const work = async (conn) => {
    const row = await one(conn, "SELECT * FROM financial_accounts WHERE id = ? FOR UPDATE", [id])
    if (!row) throw notFound("COMPTE_NOT_FOUND", "Le compte demandé est introuvable.")
    const before = await getAccountById(id, conn)
    const next = { ...before, ...patch }
    if (patch.autoriserSoldeNegatif === false && before.solde < 0) {
      throw unprocessable("SOLDE_NEGATIF", "Le solde actuel est négatif : impossible d'interdire le solde négatif.", {
        autoriserSoldeNegatif: "Solde actuellement négatif",
      })
    }
    await run(
      conn,
      "UPDATE financial_accounts SET nom=?, banque=?, numero_compte=?, autoriser_solde_negatif=? WHERE id=?",
      [next.nom, next.banque ?? null, next.numeroCompte ?? null, next.autoriserSoldeNegatif ? 1 : 0, id],
    )
    const after = await getAccountById(id, conn)
    await createAuditLog(conn, { ctx, action: "UPDATE", entityType: "account", entityId: id, before, after })
    return after
  }
  return executor ? work(executor) : withTransaction(work)
}

export async function setAccountActive(id, actif, ctx, executor = null) {
  const work = async (conn) => {
    const row = await one(conn, "SELECT * FROM financial_accounts WHERE id = ? FOR UPDATE", [id])
    if (!row) throw notFound("COMPTE_NOT_FOUND", "Le compte demandé est introuvable.")
    await run(conn, "UPDATE financial_accounts SET actif = ? WHERE id = ?", [actif ? 1 : 0, id])
    await createAuditLog(conn, {
      ctx,
      action: actif ? "ENABLE" : "DISABLE",
      entityType: "account",
      entityId: id,
      before: { actif: Boolean(row.actif) },
      after: { actif },
    })
    return getAccountById(id, conn)
  }
  return executor ? work(executor) : withTransaction(work)
}

export const disableAccount = (id, ctx) => setAccountActive(id, false, ctx)

const movementFromRow = (r) => ({
  id: Number(r.id),
  compteId: r.account_id,
  sens: r.sens,
  montant: money(r.montant),
  dateOperation: r.date_operation,
  sourceType: r.source_type,
  sourceId: r.source_id,
  nature: r.nature,
  reference: r.reference,
  libelle: r.libelle,
  createdAt: r.created_at,
})

export async function getAccountMovements(id, filters, pagination) {
  await getAccountById(id)
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const where = ["m.account_id = ?"]
  const params = [id]
  dateRangeClause("m.date_operation", range, where, params)
  if (filters.sens) {
    if (!["entree", "sortie"].includes(filters.sens)) {
      throw unprocessable("SENS_INVALIDE", "Sens invalide.", { sens: "entree ou sortie" })
    }
    where.push("m.sens = ?")
    params.push(filters.sens)
  }
  const clause = where.join(" AND ")
  const total = await one(null, `SELECT COUNT(*) AS total FROM financial_movements m WHERE ${clause}`, params)
  const list = await rows(
    null,
    `SELECT m.* FROM financial_movements m WHERE ${clause}
     ORDER BY m.date_operation DESC, m.id DESC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  )
  return { items: list.map(movementFromRow), meta: paginationMeta(pagination, Number(total.total)) }
}

export async function listAllMovements(filters = {}) {
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const where = []
  const params = []
  dateRangeClause("m.date_operation", range, where, params)
  if (filters.compteId) {
    where.push("m.account_id = ?")
    params.push(Number(filters.compteId))
  }
  const list = await rows(
    null,
    `SELECT m.*, a.code AS compte_code, a.nom AS compte_nom FROM financial_movements m
     JOIN financial_accounts a ON a.id = m.account_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY m.date_operation ASC, m.id ASC`,
    params,
  )
  return list.map((r) => ({ ...movementFromRow(r), compteCode: r.compte_code, compteNom: r.compte_nom }))
}

/**
 * Méthode interne centrale : seul point d'écriture des mouvements. Elle verrouille le compte
 * (SELECT ... FOR UPDATE) puis contrôle que le solde ne devient pas négatif si c'est interdit.
 * Les services métier l'appellent dans la transaction de l'opération.
 */
export async function createFinancialMovement(conn, data) {
  await lockAccounts(conn, [data.accountId])
  const account = await one(conn, "SELECT actif FROM financial_accounts WHERE id = ?", [data.accountId])
  if (!account) throw notFound("COMPTE_NOT_FOUND", "Le compte demandé est introuvable.")
  if (!account.actif && data.nature !== "contre_ecriture") {
    throw unprocessable("COMPTE_INACTIF", "Ce compte est désactivé.", { compteId: "Compte désactivé" })
  }
  const result = await run(
    conn,
    `INSERT INTO financial_movements (account_id, sens, montant, date_operation, source_type, source_id, nature, reference, libelle, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.accountId,
      data.sens,
      data.montant,
      data.dateOperation,
      data.sourceType,
      data.sourceId,
      data.nature ?? "normal",
      data.reference,
      data.libelle ?? null,
      data.userId ?? null,
    ],
  )
  await assertAccountsSolvent(conn, [data.accountId])
  return result.insertId
}

/** Verrouille les comptes dans l'ordre croissant des identifiants (évite les deadlocks). */
export async function lockAccounts(conn, accountIds) {
  const ids = [...new Set(accountIds)].sort((a, b) => a - b)
  for (const id of ids) await one(conn, "SELECT id FROM financial_accounts WHERE id = ? FOR UPDATE", [id])
}

export async function assertAccountsSolvent(conn, accountIds) {
  for (const id of new Set(accountIds)) {
    const account = await getAccountById(id, conn)
    if (account.solde < 0 && !account.autoriserSoldeNegatif) {
      throw unprocessable(
        "SOLDE_INSUFFISANT",
        `Solde insuffisant sur « ${account.nom} » : l'opération rendrait le solde négatif.`,
        { compteId: "Solde insuffisant" },
      )
    }
  }
}
