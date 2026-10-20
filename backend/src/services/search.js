import { one, rows } from "../config/database.js"
import { unprocessable } from "../utils/errors.js"
import { money } from "../utils/money.js"
import { likePattern, normalizeSearchTerm, paginationMeta } from "../utils/pagination.js"
import { dateRangeClause, normalizeDateRange } from "../utils/dates.js"

export const SEARCH_CATEGORIES = ["membres", "cotisations", "recettes", "dons", "depenses", "justificatifs"]

const OPERATION_TABLES = {
  cotisations: { table: "contributions", categoryTable: "contribution_categories", type: "cotisation", member: true, tiers: false },
  recettes: { table: "revenues", categoryTable: "revenue_categories", type: "recette", member: true, tiers: true },
  dons: { table: "donations", categoryTable: "donation_categories", type: "don", member: true, tiers: true },
  depenses: { table: "expenses", categoryTable: "expense_categories", type: "depense", member: false, tiers: true },
}

/** Chaque recherche renvoie les `limit + offset` meilleurs résultats et le total de sa catégorie. */
export async function searchMembers(term, _filters, pagination) {
  const like = likePattern(term)
  const where =
    "(reference LIKE ? OR nom LIKE ? OR prenom LIKE ? OR CONCAT(prenom,' ',nom) LIKE ? OR email LIKE ? OR telephone LIKE ?)"
  const params = [like, like, like, like, like, like]
  const total = await one(null, `SELECT COUNT(*) AS n FROM members WHERE ${where}`, params)
  const list = await rows(
    null,
    `SELECT * FROM members WHERE ${where} ORDER BY nom, prenom LIMIT ${pagination.offset + pagination.limit}`,
    params,
  )
  return {
    total: Number(total.n),
    items: list.map((m) => ({
      categorie: "membres",
      type: "membre",
      id: m.id,
      reference: m.reference,
      titre: `${m.prenom} ${m.nom}`,
      detail: [m.telephone, m.email].filter(Boolean).join(" · "),
      date: m.date_adhesion,
      montant: null,
      statut: m.statut,
    })),
  }
}

async function searchOperations(key, term, filters, pagination) {
  const config = OPERATION_TABLES[key]
  const like = likePattern(term)
  const parts = ["o.reference LIKE ?", "o.libelle LIKE ?"]
  const params = [like, like]
  if (config.tiers) {
    parts.push("o.tiers LIKE ?")
    params.push(like)
  }
  if (config.member) {
    parts.push("CONCAT(m.prenom,' ',m.nom) LIKE ?")
    params.push(like)
  }
  const where = [`(${parts.join(" OR ")})`]
  dateRangeClause("o.date_operation", normalizeDateRange(filters.dateDebut, filters.dateFin), where, params)
  const from = `FROM ${config.table} o JOIN ${config.categoryTable} c ON c.id = o.category_id
    ${config.member ? "LEFT JOIN members m ON m.id = o.member_id" : ""} WHERE ${where.join(" AND ")}`
  const total = await one(null, `SELECT COUNT(*) AS n ${from}`, params)
  const list = await rows(
    null,
    `SELECT o.id, o.reference, o.date_operation, o.montant, o.statut, o.libelle, c.libelle AS rubrique
     ${config.member ? ", CONCAT(m.prenom,' ',m.nom) AS membre_nom" : ""} ${from}
     ORDER BY o.date_operation DESC, o.id DESC LIMIT ${pagination.offset + pagination.limit}`,
    params,
  )
  return {
    total: Number(total.n),
    items: list.map((o) => ({
      categorie: key,
      type: config.type,
      id: o.id,
      reference: o.reference,
      titre: o.libelle || o.rubrique,
      detail: [o.rubrique, o.membre_nom].filter(Boolean).join(" · "),
      date: o.date_operation,
      montant: money(o.montant),
      statut: o.statut,
    })),
  }
}

export const searchContributions = (q, f, p) => searchOperations("cotisations", q, f, p)
export const searchRevenues = (q, f, p) => searchOperations("recettes", q, f, p)
export const searchDonations = (q, f, p) => searchOperations("dons", q, f, p)
export const searchExpenses = (q, f, p) => searchOperations("depenses", q, f, p)

export async function searchAttachments(term, _filters, pagination) {
  const like = likePattern(term)
  const where = "(nom_original LIKE ? OR description LIKE ?)"
  const total = await one(null, `SELECT COUNT(*) AS n FROM attachments WHERE ${where}`, [like, like])
  const list = await rows(
    null,
    `SELECT * FROM attachments WHERE ${where} ORDER BY created_at DESC LIMIT ${pagination.offset + pagination.limit}`,
    [like, like],
  )
  return {
    total: Number(total.n),
    items: list.map((a) => ({
      categorie: "justificatifs",
      type: "justificatif",
      id: a.id,
      reference: `JU-${String(a.id).padStart(6, "0")}`,
      titre: a.nom_original,
      detail: a.description ?? a.mime_type,
      date: a.created_at.slice(0, 10),
      montant: null,
      statut: null,
    })),
  }
}

/** Recherche globale : un seul utilisateur/rôle, donc toutes les catégories sont accessibles. */
export async function globalSearch(query, categories, filters, pagination) {
  const term = normalizeSearchTerm(query)
  if (!term || term.length < 2) {
    throw unprocessable("RECHERCHE_TROP_COURTE", "Saisissez au moins 2 caractères.", { q: "2 caractères minimum" })
  }
  const wanted = categories?.length ? categories : SEARCH_CATEGORIES
  const unknown = wanted.filter((c) => !SEARCH_CATEGORIES.includes(c))
  if (unknown.length) {
    throw unprocessable("CATEGORIE_INVALIDE", `Catégorie inconnue : ${unknown.join(", ")}.`, { categories: "Valeur inconnue" })
  }
  const runners = {
    membres: searchMembers,
    cotisations: searchContributions,
    recettes: searchRevenues,
    dons: searchDonations,
    depenses: searchExpenses,
    justificatifs: searchAttachments,
  }
  const results = await Promise.all(wanted.map(async (c) => [c, await runners[c](term, filters, pagination)]))
  const merged = results
    .flatMap(([, r]) => r.items)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) || a.reference.localeCompare(b.reference))
    .slice(pagination.offset, pagination.offset + pagination.limit)
  const total = results.reduce((sum, [, r]) => sum + r.total, 0)
  return {
    items: merged,
    meta: { ...paginationMeta(pagination, total), parCategorie: Object.fromEntries(results.map(([c, r]) => [c, r.total])) },
  }
}
