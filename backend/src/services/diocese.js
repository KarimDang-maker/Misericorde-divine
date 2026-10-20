import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { dateRangeClause, normalizeDateRange, requireDate, today } from "../utils/dates.js"
import { fromCents, money, parsePositiveAmount, toCents } from "../utils/money.js"
import { likePattern, normalizeSearchTerm, paginationMeta } from "../utils/pagination.js"
import { nextReference } from "../utils/references.js"
import { createAuditLog } from "./audit.js"
import { createFinancialMovement } from "./accounts.js"
import { getGeneralSettings } from "./settings.js"
import { cancelSchema } from "./operations.js"

const id = z.coerce.number().int().positive()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format AAAA-MM-JJ")

export const diocesanSchema = z.object({
  compteId: id,
  montant: z.union([z.string(), z.number()]),
  dateOperation: isoDate,
  periodeDebut: isoDate,
  periodeFin: isoDate,
  libelle: z.string().trim().max(255).nullish().transform((v) => v || null),
})
export const diocesanPeriodSchema = z.object({
  dateDebut: isoDate,
  dateFin: isoDate,
  compteId: id.optional(),
  dateOperation: isoDate.optional(),
})
export { cancelSchema as diocesanCancelSchema }

const fromRow = (r) => ({
  id: r.id,
  type: "diocesan",
  reference: r.reference,
  compteId: r.account_id,
  compte: r.compte_nom,
  montant: money(r.montant),
  dateOperation: r.date_operation,
  periodeDebut: r.periode_debut,
  periodeFin: r.periode_fin,
  assiette: r.assiette === null ? null : money(r.assiette),
  taux: r.taux === null ? null : Number(r.taux),
  libelle: r.libelle,
  statut: r.statut,
  motifAnnulation: r.motif_annulation,
  createdAt: r.created_at,
})

const SELECT = `SELECT d.*, a.nom AS compte_nom FROM diocesan_contributions d JOIN financial_accounts a ON a.id = d.account_id`

function buildFilters(filters) {
  const where = []
  const params = []
  dateRangeClause("d.date_operation", normalizeDateRange(filters.dateDebut, filters.dateFin), where, params)
  if (filters.statut) {
    where.push("d.statut = ?")
    params.push(filters.statut)
  }
  const term = normalizeSearchTerm(filters.q)
  if (term) {
    const like = likePattern(term)
    where.push("(d.reference LIKE ? OR d.libelle LIKE ? OR a.nom LIKE ?)")
    params.push(like, like, like)
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
}

export async function listDiocesanContributions(filters, pagination) {
  const { where, params } = buildFilters(filters)
  const total = await one(null, `SELECT COUNT(*) AS total FROM diocesan_contributions d JOIN financial_accounts a ON a.id = d.account_id ${where}`, params)
  const list = await rows(
    null,
    `${SELECT} ${where} ORDER BY d.date_operation DESC, d.id DESC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  )
  return { items: list.map(fromRow), meta: paginationMeta(pagination, Number(total.total)) }
}

export async function listAllDiocesanContributions(filters = {}) {
  const { where, params } = buildFilters(filters)
  const list = await rows(null, `${SELECT} ${where} ORDER BY d.date_operation ASC, d.id ASC`, params)
  return list.map(fromRow)
}

export async function getDiocesanContributionById(contributionId, executor = null) {
  const row = await one(executor, `${SELECT} WHERE d.id = ?`, [contributionId])
  if (!row) throw notFound("DIOCESE_NOT_FOUND", "La contribution diocésaine est introuvable.")
  return fromRow(row)
}

export async function createDiocesanContribution(data, ctx, extra = {}) {
  requireDate(data.dateOperation, "dateOperation")
  requireDate(data.periodeDebut, "periodeDebut")
  requireDate(data.periodeFin, "periodeFin")
  if (data.periodeDebut > data.periodeFin) {
    throw unprocessable("PERIODE_INVALIDE", "La période est invalide.", { periodeDebut: "Postérieure à la fin" })
  }
  const montant = parsePositiveAmount(data.montant)
  return withTransaction(async (conn) => {
    const account = await one(conn, "SELECT id, actif FROM financial_accounts WHERE id = ?", [data.compteId])
    if (!account) throw unprocessable("COMPTE_NOT_FOUND", "Le compte est introuvable.", { compteId: "Introuvable" })
    if (!account.actif) throw unprocessable("COMPTE_INACTIF", "Le compte est désactivé.", { compteId: "Désactivé" })
    const reference = await nextReference(conn, "DC", data.dateOperation)
    const inserted = await run(
      conn,
      `INSERT INTO diocesan_contributions (reference, account_id, montant, date_operation, periode_debut, periode_fin, assiette, taux, libelle, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference,
        data.compteId,
        montant,
        data.dateOperation,
        data.periodeDebut,
        data.periodeFin,
        extra.assiette ?? null,
        extra.taux ?? null,
        data.libelle,
        ctx?.user?.id ?? null,
      ],
    )
    await createFinancialMovement(conn, {
      accountId: data.compteId,
      sens: "sortie",
      montant,
      dateOperation: data.dateOperation,
      sourceType: "diocesan",
      sourceId: inserted.insertId,
      reference,
      libelle: data.libelle ?? "Contribution diocésaine",
      userId: ctx?.user?.id,
    })
    await run(
      conn,
      `INSERT INTO operation_status_history (operation_type, operation_id, ancien_statut, nouveau_statut, user_id) VALUES ('diocesan', ?, NULL, 'valide', ?)`,
      [inserted.insertId, ctx?.user?.id ?? null],
    )
    const created = await getDiocesanContributionById(inserted.insertId, conn)
    await createAuditLog(conn, { ctx, action: "CREATE", entityType: "diocesan", entityId: created.id, after: created })
    return created
  })
}

export async function cancelDiocesanContribution(contributionId, motif, ctx) {
  return withTransaction(async (conn) => {
    const locked = await one(conn, "SELECT id, statut FROM diocesan_contributions WHERE id = ? FOR UPDATE", [contributionId])
    if (!locked) throw notFound("DIOCESE_NOT_FOUND", "La contribution diocésaine est introuvable.")
    if (locked.statut === "annule") throw conflict("OPERATION_DEJA_ANNULEE", "Cette contribution est déjà annulée.")
    const before = await getDiocesanContributionById(contributionId, conn)
    await run(
      conn,
      "UPDATE diocesan_contributions SET statut='annule', motif_annulation=?, annule_par=?, annule_le=UTC_TIMESTAMP() WHERE id=?",
      [motif, ctx?.user?.id ?? null, contributionId],
    )
    await createFinancialMovement(conn, {
      accountId: before.compteId,
      sens: "entree",
      montant: parsePositiveAmount(before.montant),
      dateOperation: today(),
      sourceType: "diocesan",
      sourceId: contributionId,
      nature: "contre_ecriture",
      reference: before.reference,
      libelle: `Annulation : ${motif}`.slice(0, 255),
      userId: ctx?.user?.id,
    })
    await run(
      conn,
      `INSERT INTO operation_status_history (operation_type, operation_id, ancien_statut, nouveau_statut, motif, user_id) VALUES ('diocesan', ?, 'valide', 'annule', ?, ?)`,
      [contributionId, motif, ctx?.user?.id ?? null],
    )
    const after = await getDiocesanContributionById(contributionId, conn)
    await createAuditLog(conn, { ctx, action: "CANCEL", entityType: "diocesan", entityId: contributionId, before, after })
    return after
  })
}

/** Somme des opérations valides entrant dans l'assiette configurée sur la période (bornes incluses). */
async function computeBase(assiette, range) {
  const sum = async (table) => {
    const where = ["statut = 'valide'"]
    const params = []
    dateRangeClause("date_operation", range, where, params)
    const row = await one(null, `SELECT COALESCE(SUM(montant),0) AS total FROM ${table} WHERE ${where.join(" AND ")}`, params)
    return toCents(row.total)
  }
  const tables = {
    cotisations: ["contributions"],
    cotisations_dons: ["contributions", "donations"],
    recettes_totales: ["contributions", "donations", "revenues"],
  }[assiette]
  let cents = 0
  for (const table of tables) cents += await sum(table)
  return cents
}

/** Arrondi commercial (0,5 vers le haut) en arithmétique entière : centimes × taux(%) / 100. */
export function applyRate(baseCents, tauxPercent) {
  const scaled = BigInt(Math.round(tauxPercent * 10000)) // taux × 10^4
  const numerator = BigInt(baseCents) * scaled
  const divisor = 1000000n // 100 (pourcent) × 10^4
  return Number((numerator + divisor / 2n) / divisor)
}

export async function calculateDiocesanContribution(period) {
  const range = normalizeDateRange(period.dateDebut, period.dateFin)
  if (!range.dateDebut || !range.dateFin) {
    throw unprocessable("PERIODE_REQUISE", "La période (début et fin) est obligatoire.", { dateDebut: "Obligatoire" })
  }
  const settings = await getGeneralSettings()
  if (settings.dioceseTaux === null || !settings.dioceseAssiette) {
    throw unprocessable(
      "REGLE_DIOCESAINE_NON_CONFIGUREE",
      "Le taux et l'assiette de la contribution diocésaine doivent d'abord être configurés dans les paramètres.",
    )
  }
  const baseCents = await computeBase(settings.dioceseAssiette, range)
  const dueCents = applyRate(baseCents, settings.dioceseTaux)
  const paid = await one(
    null,
    `SELECT COALESCE(SUM(montant),0) AS total FROM diocesan_contributions
     WHERE statut = 'valide' AND periode_debut = ? AND periode_fin = ?`,
    [range.dateDebut, range.dateFin],
  )
  const paidCents = toCents(paid.total)
  return {
    periode: range,
    assiette: settings.dioceseAssiette,
    baseCalcul: money(fromCents(baseCents)),
    taux: settings.dioceseTaux,
    montantDu: money(fromCents(dueCents)),
    dejaVerse: money(fromCents(paidCents)),
    resteAVerser: money(fromCents(Math.max(0, dueCents - paidCents))),
  }
}

export async function generateDiocesanContribution(period, ctx) {
  const calc = await calculateDiocesanContribution(period)
  if (calc.resteAVerser <= 0) {
    throw unprocessable("RIEN_A_VERSER", "Aucun montant restant à verser pour cette période.")
  }
  if (!period.compteId) {
    throw unprocessable("COMPTE_REQUIS", "Le compte de paiement est obligatoire.", { compteId: "Obligatoire" })
  }
  const created = await createDiocesanContribution(
    {
      compteId: period.compteId,
      montant: calc.resteAVerser,
      dateOperation: period.dateOperation ?? today(),
      periodeDebut: calc.periode.dateDebut,
      periodeFin: calc.periode.dateFin,
      libelle: `Contribution diocésaine ${calc.periode.dateDebut} → ${calc.periode.dateFin}`,
    },
    ctx,
    { assiette: calc.baseCalcul, taux: calc.taux },
  )
  return { contribution: created, calcul: calc }
}

export async function getDiocesanSummary(filters = {}) {
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const where = ["statut = 'valide'"]
  const params = []
  dateRangeClause("date_operation", range, where, params)
  const row = await one(
    null,
    `SELECT COALESCE(SUM(montant),0) AS total, COUNT(*) AS nombre, MAX(date_operation) AS derniere
     FROM diocesan_contributions WHERE ${where.join(" AND ")}`,
    params,
  )
  const settings = await getGeneralSettings()
  const configured = settings.dioceseTaux !== null && Boolean(settings.dioceseAssiette)
  let calcul = null
  if (configured && range.dateDebut && range.dateFin) {
    const baseCents = await computeBase(settings.dioceseAssiette, range)
    calcul = {
      assiette: settings.dioceseAssiette,
      baseCalcul: money(fromCents(baseCents)),
      taux: settings.dioceseTaux,
      montantDu: money(fromCents(applyRate(baseCents, settings.dioceseTaux))),
    }
  }
  return {
    periode: range,
    totalVerse: money(row.total),
    nombre: Number(row.nombre),
    derniereDate: row.derniere,
    regleConfiguree: configured,
    calcul,
  }
}

/** Opérations ayant alimenté l'assiette de la contribution (même période, assiette courante). */
export async function getRelatedOperations(contributionId) {
  const contribution = await getDiocesanContributionById(contributionId)
  const settings = await getGeneralSettings()
  const assiette = settings.dioceseAssiette ?? "cotisations"
  const tables = {
    cotisations: [["cotisation", "contributions"]],
    cotisations_dons: [
      ["cotisation", "contributions"],
      ["don", "donations"],
    ],
    recettes_totales: [
      ["cotisation", "contributions"],
      ["don", "donations"],
      ["recette", "revenues"],
    ],
  }[assiette]
  const items = []
  for (const [type, table] of tables) {
    const list = await rows(
      null,
      `SELECT id, reference, date_operation, montant, libelle FROM ${table}
       WHERE statut = 'valide' AND date_operation BETWEEN ? AND ? ORDER BY date_operation, id`,
      [contribution.periodeDebut, contribution.periodeFin],
    )
    for (const r of list) {
      items.push({
        type,
        id: r.id,
        reference: r.reference,
        dateOperation: r.date_operation,
        montant: money(r.montant),
        libelle: r.libelle,
      })
    }
  }
  items.sort((a, b) => a.dateOperation.localeCompare(b.dateOperation))
  return { contribution, assiette, operations: items }
}

export async function getDiocesanReport(filters = {}) {
  const [summary, list] = await Promise.all([getDiocesanSummary(filters), listAllDiocesanContributions(filters)])
  return { summary, items: list }
}
