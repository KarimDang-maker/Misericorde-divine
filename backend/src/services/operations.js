import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { dateRangeClause, normalizeDateRange, requireDate, today } from "../utils/dates.js"
import { money, parsePositiveAmount, toCents } from "../utils/money.js"
import { likePattern, normalizeSearchTerm, paginationMeta, parseSort } from "../utils/pagination.js"
import { nextReference } from "../utils/references.js"
import { createAuditLog } from "./audit.js"
import { assertAccountsSolvent, createFinancialMovement, lockAccounts } from "./accounts.js"

/**
 * Cotisations, recettes, dons et dépenses partagent le même cycle de vie financier :
 * création → mouvement de compte → (modification synchronisée) → annulation avec contre-écriture.
 * Chaque type est décrit par une configuration ; la logique critique n'existe qu'une fois.
 */
export const OPERATION_TYPES = {
  cotisations: {
    key: "cotisations",
    type: "contribution",
    table: "contributions",
    categoryTable: "contribution_categories",
    prefix: "CT",
    sens: "entree",
    label: "cotisation",
    member: "required",
    hasPeriode: true,
    hasTiers: false,
  },
  recettes: {
    key: "recettes",
    type: "revenue",
    table: "revenues",
    categoryTable: "revenue_categories",
    prefix: "RC",
    sens: "entree",
    label: "recette",
    member: "optional",
    hasPeriode: false,
    hasTiers: true,
  },
  dons: {
    key: "dons",
    type: "donation",
    table: "donations",
    categoryTable: "donation_categories",
    prefix: "DN",
    sens: "entree",
    label: "don",
    member: "optional",
    hasPeriode: false,
    hasTiers: true,
  },
  depenses: {
    key: "depenses",
    type: "expense",
    table: "expenses",
    categoryTable: "expense_categories",
    prefix: "DP",
    sens: "sortie",
    label: "dépense",
    member: "none",
    hasPeriode: false,
    hasTiers: true,
  },
}

export const OPERATION_STATUSES = ["valide", "annule"]

export function operationConfig(key) {
  const config = OPERATION_TYPES[key]
  if (!config) throw notFound("OPERATION_TYPE_INCONNU", "Type d'opération inconnu.")
  return config
}

const optionalText = (max) =>
  z.string().trim().max(max).nullish().transform((v) => v || null)
const id = z.coerce.number().int().positive()
const amount = z.union([z.string(), z.number()])

function baseShape(config) {
  const shape = {
    rubriqueId: id,
    compteId: id,
    montant: amount,
    dateOperation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format AAAA-MM-JJ"),
    modePaiement: optionalText(40),
    libelle: optionalText(255),
  }
  if (config.member === "required") shape.membreId = id
  if (config.member === "optional") shape.membreId = id.nullish().transform((v) => v ?? null)
  if (config.hasTiers) shape.tiers = optionalText(190)
  if (config.hasPeriode) {
    shape.periode = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format AAAA-MM")
      .nullish()
      .transform((v) => v || null)
  }
  return shape
}

export const createSchemaFor = (config) => z.object(baseShape(config))
export const updateSchemaFor = (config) => z.object(baseShape(config)).partial()
export const cancelSchema = z.object({ motif: z.string().trim().min(3, "Motif obligatoire (3 caractères min.)").max(500) })

export function operationFromRow(config, r) {
  const out = {
    id: r.id,
    type: config.type,
    reference: r.reference,
    rubriqueId: r.category_id,
    rubrique: r.rubrique_libelle,
    rubriqueCode: r.rubrique_code,
    compteId: r.account_id,
    compte: r.compte_nom,
    compteCode: r.compte_code,
    montant: money(r.montant),
    dateOperation: r.date_operation,
    modePaiement: r.mode_paiement,
    libelle: r.libelle,
    statut: r.statut,
    motifAnnulation: r.motif_annulation,
    annuleLe: r.annule_le,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
  if (config.member !== "none") {
    out.membreId = r.member_id
    out.membre = r.membre_nom ?? null
    out.membreReference = r.membre_reference ?? null
  }
  if (config.hasTiers) out.tiers = r.tiers
  if (config.hasPeriode) out.periode = r.periode
  if (config.key === "dons") out.nature = r.rubrique_nature
  return out
}

function selectSql(config) {
  const member = config.member !== "none"
  return `SELECT o.*, c.libelle AS rubrique_libelle, c.code AS rubrique_code,
      ${config.key === "dons" ? "c.nature AS rubrique_nature," : ""}
      a.nom AS compte_nom, a.code AS compte_code
      ${member ? ", m.reference AS membre_reference, CONCAT(m.prenom, ' ', m.nom) AS membre_nom" : ""}
    FROM ${config.table} o
    JOIN ${config.categoryTable} c ON c.id = o.category_id
    JOIN financial_accounts a ON a.id = o.account_id
    ${member ? "LEFT JOIN members m ON m.id = o.member_id" : ""}`
}

const SORTS = {
  dateOperation: "o.date_operation",
  montant: "o.montant",
  reference: "o.reference",
  createdAt: "o.created_at",
  statut: "o.statut",
}

function buildFilters(config, filters) {
  const where = []
  const params = []
  const term = normalizeSearchTerm(filters.q)
  if (term) {
    const like = likePattern(term)
    const parts = ["o.reference LIKE ?", "o.libelle LIKE ?"]
    const values = [like, like]
    if (config.hasTiers) {
      parts.push("o.tiers LIKE ?")
      values.push(like)
    }
    if (config.member !== "none") {
      parts.push("CONCAT(m.prenom,' ',m.nom) LIKE ?", "m.reference LIKE ?")
      values.push(like, like)
    }
    where.push(`(${parts.join(" OR ")})`)
    params.push(...values)
  }
  const numeric = (value, field, column) => {
    if (value === undefined || value === "") return
    const n = Number(value)
    if (!Number.isInteger(n) || n <= 0) {
      throw unprocessable("FILTRE_INVALIDE", `Filtre « ${field} » invalide.`, { [field]: "Entier attendu" })
    }
    where.push(`${column} = ?`)
    params.push(n)
  }
  if (config.member !== "none") numeric(filters.membreId, "membreId", "o.member_id")
  numeric(filters.rubriqueId, "rubriqueId", "o.category_id")
  numeric(filters.compteId, "compteId", "o.account_id")
  if (filters.reference) {
    where.push("o.reference = ?")
    params.push(String(filters.reference))
  }
  if (filters.statut) {
    if (!OPERATION_STATUSES.includes(filters.statut)) {
      throw unprocessable("STATUT_INVALIDE", "Statut invalide.", { statut: "valide ou annule" })
    }
    where.push("o.statut = ?")
    params.push(filters.statut)
  }
  if (config.key === "dons" && filters.nature) {
    where.push("c.nature = ?")
    params.push(String(filters.nature))
  }
  dateRangeClause("o.date_operation", normalizeDateRange(filters.dateDebut, filters.dateFin), where, params)
  for (const [field, op] of [
    ["montantMin", ">="],
    ["montantMax", "<="],
  ]) {
    if (filters[field] !== undefined && filters[field] !== "") {
      const cents = toCents(filters[field])
      if (cents === null) {
        throw unprocessable("FILTRE_INVALIDE", `Filtre « ${field} » invalide.`, { [field]: "Montant invalide" })
      }
      where.push(`o.montant ${op} ?`)
      params.push((cents / 100).toFixed(2))
    }
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
}

export async function listOperations(config, filters, pagination, sortQuery) {
  const { where, params } = buildFilters(config, filters)
  const sort = parseSort(sortQuery, SORTS, { field: "dateOperation", direction: "desc" })
  const from = selectSql(config).slice(selectSql(config).indexOf("FROM"))
  const totals = await one(
    null,
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN o.statut='valide' THEN o.montant END),0) AS somme ${from} ${where}`,
    params,
  )
  const list = await rows(
    null,
    `${selectSql(config)} ${where} ORDER BY ${sort.column} ${sort.direction}, o.id DESC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  )
  return {
    items: list.map((r) => operationFromRow(config, r)),
    meta: { ...paginationMeta(pagination, Number(totals.total)), sommeValide: money(totals.somme) },
  }
}

/** Même requête que l'écran, sans pagination : utilisée par les exports (cohérence écran/export). */
export async function listAllOperations(config, filters = {}) {
  const { where, params } = buildFilters(config, filters)
  const list = await rows(null, `${selectSql(config)} ${where} ORDER BY o.date_operation ASC, o.id ASC LIMIT 50000`, params)
  return list.map((r) => operationFromRow(config, r))
}

export async function getOperationById(config, operationId, executor = null) {
  const row = await one(executor, `${selectSql(config)} WHERE o.id = ?`, [operationId])
  if (!row) {
    throw notFound(`${config.type.toUpperCase()}_NOT_FOUND`, `La ${config.label} demandée est introuvable.`)
  }
  return operationFromRow(config, row)
}

/** Détail complet : opération, justificatifs, mouvements et historique des statuts. */
export async function getOperationDetail(config, operationId) {
  const operation = await getOperationById(config, operationId)
  const [attachments, movements, history] = await Promise.all([
    rows(
      null,
      `SELECT a.id, a.nom_original, a.mime_type, a.taille, a.created_at FROM operation_attachments oa
       JOIN attachments a ON a.id = oa.attachment_id WHERE oa.operation_type = ? AND oa.operation_id = ?`,
      [config.type, operationId],
    ),
    rows(null, "SELECT * FROM financial_movements WHERE source_type = ? AND source_id = ? ORDER BY id", [
      config.type,
      operationId,
    ]),
    rows(
      null,
      `SELECT h.*, u.nom AS user_nom FROM operation_status_history h LEFT JOIN users u ON u.id = h.user_id
       WHERE h.operation_type = ? AND h.operation_id = ? ORDER BY h.id`,
      [config.type, operationId],
    ),
  ])
  return {
    ...operation,
    justificatifs: attachments.map((a) => ({
      id: a.id,
      nom: a.nom_original,
      mimeType: a.mime_type,
      taille: a.taille,
      createdAt: a.created_at,
    })),
    mouvements: movements.map((m) => ({
      id: Number(m.id),
      sens: m.sens,
      montant: money(m.montant),
      dateOperation: m.date_operation,
      nature: m.nature,
      reference: m.reference,
    })),
    historique: history.map((h) => ({
      ancienStatut: h.ancien_statut,
      nouveauStatut: h.nouveau_statut,
      motif: h.motif,
      utilisateur: h.user_nom,
      date: h.created_at,
    })),
  }
}

async function validateReferences(config, conn, data, current = null) {
  if (data.membreId) {
    const member = await one(conn, "SELECT id, statut FROM members WHERE id = ?", [data.membreId])
    if (!member) throw unprocessable("MEMBRE_NOT_FOUND", "Le membre est introuvable.", { membreId: "Introuvable" })
    if (member.statut === "archive" && data.membreId !== current?.membreId) {
      throw unprocessable("MEMBRE_ARCHIVE", "Le membre est archivé.", { membreId: "Membre archivé" })
    }
  }
  const category = await one(conn, `SELECT id, actif FROM ${config.categoryTable} WHERE id = ?`, [data.rubriqueId])
  if (!category) throw unprocessable("RUBRIQUE_NOT_FOUND", "La rubrique est introuvable.", { rubriqueId: "Introuvable" })
  if (!category.actif && data.rubriqueId !== current?.rubriqueId) {
    throw unprocessable("RUBRIQUE_INACTIVE", "La rubrique est désactivée.", { rubriqueId: "Rubrique désactivée" })
  }
  const account = await one(conn, "SELECT id, actif FROM financial_accounts WHERE id = ?", [data.compteId])
  if (!account) throw unprocessable("COMPTE_NOT_FOUND", "Le compte est introuvable.", { compteId: "Introuvable" })
  if (!account.actif && data.compteId !== current?.compteId) {
    throw unprocessable("COMPTE_INACTIF", "Le compte est désactivé.", { compteId: "Compte désactivé" })
  }
}

async function recordHistory(conn, config, operationId, before, after, motif, ctx) {
  await run(
    conn,
    `INSERT INTO operation_status_history (operation_type, operation_id, ancien_statut, nouveau_statut, motif, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [config.type, operationId, before, after, motif ?? null, ctx?.user?.id ?? null],
  )
}

export async function createOperation(config, input, ctx, executor = null) {
  const work = async (conn) => {
    const data = { ...input }
    data.montant = parsePositiveAmount(data.montant)
    requireDate(data.dateOperation, "dateOperation")
    if (config.member === "none") delete data.membreId
    await validateReferences(config, conn, data)

    const reference = await nextReference(conn, config.prefix, data.dateOperation)
    const columns = ["reference", "category_id", "account_id", "montant", "date_operation", "mode_paiement", "libelle", "created_by"]
    const values = [
      reference,
      data.rubriqueId,
      data.compteId,
      data.montant,
      data.dateOperation,
      data.modePaiement ?? null,
      data.libelle ?? null,
      ctx?.user?.id ?? null,
    ]
    if (config.member !== "none") {
      columns.push("member_id")
      values.push(data.membreId ?? null)
    }
    if (config.hasTiers) {
      columns.push("tiers")
      values.push(data.tiers ?? null)
    }
    if (config.hasPeriode) {
      columns.push("periode")
      values.push(data.periode ?? null)
    }
    const inserted = await run(
      conn,
      `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      values,
    )
    // Mouvement de compte dans la MÊME transaction que l'opération.
    await createFinancialMovement(conn, {
      accountId: data.compteId,
      sens: config.sens,
      montant: data.montant,
      dateOperation: data.dateOperation,
      sourceType: config.type,
      sourceId: inserted.insertId,
      reference,
      libelle: data.libelle,
      userId: ctx?.user?.id,
    })
    await recordHistory(conn, config, inserted.insertId, null, "valide", null, ctx)
    const created = await getOperationById(config, inserted.insertId, conn)
    await createAuditLog(conn, { ctx, action: "CREATE", entityType: config.type, entityId: created.id, after: created })
    return created
  }
  return executor ? work(executor) : withTransaction(work)
}

export async function updateOperation(config, operationId, patch, ctx, executor = null) {
  const work = async (conn) => {
    const locked = await one(conn, `SELECT id, statut, account_id FROM ${config.table} WHERE id = ? FOR UPDATE`, [operationId])
    if (!locked) throw notFound(`${config.type.toUpperCase()}_NOT_FOUND`, `La ${config.label} demandée est introuvable.`)
    if (locked.statut !== "valide") {
      throw conflict("OPERATION_ANNULEE", `Une ${config.label} annulée ne peut plus être modifiée.`)
    }
    const before = await getOperationById(config, operationId, conn)
    const merged = { ...before, ...patch }
    merged.montant = parsePositiveAmount(merged.montant)
    requireDate(merged.dateOperation, "dateOperation")
    await validateReferences(config, conn, merged, before)

    await lockAccounts(conn, [before.compteId, merged.compteId])
    const sets = ["category_id = ?", "account_id = ?", "montant = ?", "date_operation = ?", "mode_paiement = ?", "libelle = ?"]
    const values = [merged.rubriqueId, merged.compteId, merged.montant, merged.dateOperation, merged.modePaiement ?? null, merged.libelle ?? null]
    if (config.member !== "none") {
      sets.push("member_id = ?")
      values.push(merged.membreId ?? null)
    }
    if (config.hasTiers) {
      sets.push("tiers = ?")
      values.push(merged.tiers ?? null)
    }
    if (config.hasPeriode) {
      sets.push("periode = ?")
      values.push(merged.periode ?? null)
    }
    await run(conn, `UPDATE ${config.table} SET ${sets.join(", ")} WHERE id = ?`, [...values, operationId])
    // Le mouvement d'origine suit l'opération (compte, montant, date) ; l'historique est dans l'audit.
    const synced = await run(
      conn,
      `UPDATE financial_movements SET account_id = ?, montant = ?, date_operation = ?, libelle = ?
       WHERE source_type = ? AND source_id = ? AND nature = 'normal'`,
      [merged.compteId, merged.montant, merged.dateOperation, merged.libelle ?? null, config.type, operationId],
    )
    if (synced.affectedRows === 0) {
      await createFinancialMovement(conn, {
        accountId: merged.compteId,
        sens: config.sens,
        montant: merged.montant,
        dateOperation: merged.dateOperation,
        sourceType: config.type,
        sourceId: operationId,
        reference: before.reference,
        libelle: merged.libelle,
        userId: ctx?.user?.id,
      })
    }
    await assertAccountsSolvent(conn, [before.compteId, merged.compteId])
    const after = await getOperationById(config, operationId, conn)
    await createAuditLog(conn, { ctx, action: "UPDATE", entityType: config.type, entityId: operationId, before, after })
    return after
  }
  return executor ? work(executor) : withTransaction(work)
}

export async function cancelOperation(config, operationId, motif, ctx) {
  return withTransaction(async (conn) => {
    const locked = await one(conn, `SELECT id, statut FROM ${config.table} WHERE id = ? FOR UPDATE`, [operationId])
    if (!locked) throw notFound(`${config.type.toUpperCase()}_NOT_FOUND`, `La ${config.label} demandée est introuvable.`)
    if (locked.statut === "annule") {
      throw conflict("OPERATION_DEJA_ANNULEE", `Cette ${config.label} est déjà annulée.`)
    }
    const before = await getOperationById(config, operationId, conn)
    await run(
      conn,
      `UPDATE ${config.table} SET statut = 'annule', motif_annulation = ?, annule_par = ?, annule_le = UTC_TIMESTAMP() WHERE id = ?`,
      [motif, ctx?.user?.id ?? null, operationId],
    )
    // Contre-écriture : on n'efface jamais un mouvement, on enregistre son inverse.
    await createFinancialMovement(conn, {
      accountId: before.compteId,
      sens: config.sens === "entree" ? "sortie" : "entree",
      montant: parsePositiveAmount(before.montant),
      dateOperation: today(),
      sourceType: config.type,
      sourceId: operationId,
      nature: "contre_ecriture",
      reference: before.reference,
      libelle: `Annulation : ${motif}`.slice(0, 255),
      userId: ctx?.user?.id,
    })
    await recordHistory(conn, config, operationId, "valide", "annule", motif, ctx)
    const after = await getOperationById(config, operationId, conn)
    await createAuditLog(conn, { ctx, action: "CANCEL", entityType: config.type, entityId: operationId, before, after })
    return after
  })
}

export async function getMemberContributions(memberId, filters = {}) {
  const config = OPERATION_TYPES.cotisations
  return listAllOperations(config, { ...filters, membreId: memberId })
}

