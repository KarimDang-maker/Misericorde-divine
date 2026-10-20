import { one, rows } from "../config/database.js"
import { dateRangeClause, normalizeDateRange } from "../utils/dates.js"
import { fromCents, money, toCents } from "../utils/money.js"
import { getAccountBalance, listAccounts } from "./accounts.js"
import { getDiocesanSummary } from "./diocese.js"

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"]

async function sumValid(table, range) {
  const where = ["statut = 'valide'"]
  const params = []
  dateRangeClause("date_operation", range, where, params)
  const row = await one(
    null,
    `SELECT COALESCE(SUM(montant),0) AS total, COUNT(*) AS nombre FROM ${table} WHERE ${where.join(" AND ")}`,
    params,
  )
  return { total: toCents(row.total), nombre: Number(row.nombre) }
}

export const countActiveMembers = async () =>
  Number((await one(null, "SELECT COUNT(*) AS n FROM members WHERE statut = 'actif'")).n)
export const sumContributions = (range) => sumValid("contributions", range)
export const sumRevenues = (range) => sumValid("revenues", range)
export const sumDonations = (range) => sumValid("donations", range)
export const sumExpenses = (range) => sumValid("expenses", range)

/** Soldes des comptes, éventuellement arrêtés à dateFin. */
export async function getAccountBalances(range) {
  const accounts = await listAccounts({ actif: "true" })
  const result = []
  for (const account of accounts) {
    const balance = range.dateFin ? (await getAccountBalance(account.id, range.dateFin)).solde : account.solde
    result.push({ id: account.id, code: account.code, nom: account.nom, type: account.type, solde: balance })
  }
  return result
}

function lastSixMonths() {
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))
  return { dateDebut: start.toISOString().slice(0, 10), dateFin: end.toISOString().slice(0, 10) }
}

/** Série mensuelle recettes (cotisations + recettes + dons) / dépenses (hors contribution diocésaine, suivie à part). */
export async function getFinancialEvolution(range) {
  const effective = range.dateDebut || range.dateFin ? range : lastSixMonths()
  const monthly = async (table) => {
    const where = ["statut = 'valide'"]
    const params = []
    dateRangeClause("date_operation", effective, where, params)
    const list = await rows(
      null,
      `SELECT DATE_FORMAT(date_operation, '%Y-%m') AS mois, SUM(montant) AS total FROM ${table}
       WHERE ${where.join(" AND ")} GROUP BY mois`,
      params,
    )
    return new Map(list.map((r) => [r.mois, toCents(r.total)]))
  }
  const [contributions, revenues, donations, expenses] = await Promise.all([
    monthly("contributions"),
    monthly("revenues"),
    monthly("donations"),
    monthly("expenses"),
  ])
  const months = new Set([...contributions.keys(), ...revenues.keys(), ...donations.keys(), ...expenses.keys()])
  if (!range.dateDebut && !range.dateFin) {
    const cursor = new Date(`${effective.dateDebut}T00:00:00Z`)
    for (let i = 0; i < 6; i++) {
      months.add(cursor.toISOString().slice(0, 7))
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }
  const points = [...months].sort().map((mois) => {
    const entrees = (contributions.get(mois) ?? 0) + (revenues.get(mois) ?? 0) + (donations.get(mois) ?? 0)
    const sorties = expenses.get(mois) ?? 0
    return {
      mois,
      libelle: `${MONTHS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(2, 4)}`,
      recettes: money(fromCents(entrees)),
      depenses: money(fromCents(sorties)),
    }
  })
  return { periode: effective, points }
}

export async function getRevenueBreakdown(range) {
  const [c, r, d] = await Promise.all([sumContributions(range), sumRevenues(range), sumDonations(range)])
  const total = c.total + r.total + d.total
  const part = (cents) => (total === 0 ? 0 : Math.round((cents / total) * 1000) / 10)
  return [
    { nom: "Cotisations", valeur: money(fromCents(c.total)), pourcentage: part(c.total) },
    { nom: "Dons et offrandes", valeur: money(fromCents(d.total)), pourcentage: part(d.total) },
    { nom: "Autres recettes", valeur: money(fromCents(r.total)), pourcentage: part(r.total) },
  ]
}

async function breakdownByCategory(table, categoryTable, range) {
  const where = ["o.statut = 'valide'"]
  const params = []
  dateRangeClause("o.date_operation", range, where, params)
  const list = await rows(
    null,
    `SELECT c.libelle, SUM(o.montant) AS total FROM ${table} o JOIN ${categoryTable} c ON c.id = o.category_id
     WHERE ${where.join(" AND ")} GROUP BY c.id, c.libelle ORDER BY total DESC`,
    params,
  )
  return list.map((r) => ({ nom: r.libelle, valeur: money(r.total) }))
}

export const getExpenseBreakdown = (range) => breakdownByCategory("expenses", "expense_categories", range)

export async function getRecentOperations(range, limit = 10) {
  const where = []
  const params = []
  dateRangeClause("u.date_operation", range, where, params)
  const list = await rows(
    null,
    `SELECT * FROM (
       SELECT 'cotisation' AS type, 'entree' AS sens, id, reference, date_operation, montant, statut, libelle, created_at FROM contributions
       UNION ALL SELECT 'recette', 'entree', id, reference, date_operation, montant, statut, libelle, created_at FROM revenues
       UNION ALL SELECT 'don', 'entree', id, reference, date_operation, montant, statut, libelle, created_at FROM donations
       UNION ALL SELECT 'depense', 'sortie', id, reference, date_operation, montant, statut, libelle, created_at FROM expenses
       UNION ALL SELECT 'diocese', 'sortie', id, reference, date_operation, montant, statut, libelle, created_at FROM diocesan_contributions
     ) u ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY u.date_operation DESC, u.created_at DESC, u.id DESC LIMIT ${Number(limit)}`,
    params,
  )
  return list.map((r) => ({
    type: r.type,
    sens: r.sens,
    id: r.id,
    reference: r.reference,
    dateOperation: r.date_operation,
    montant: money(r.montant),
    statut: r.statut,
    libelle: r.libelle,
  }))
}

export async function getDashboardSummary(filters = {}) {
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const [membres, cotisations, recettes, dons, depenses, soldes, diocese, operations, evolution, repartition, repartitionDepenses] =
    await Promise.all([
      countActiveMembers(),
      sumContributions(range),
      sumRevenues(range),
      sumDonations(range),
      sumExpenses(range),
      getAccountBalances(range),
      getDiocesanSummary(range),
      getRecentOperations(range),
      getFinancialEvolution(range),
      getRevenueBreakdown(range),
      getExpenseBreakdown(range),
    ])
  const cents = (value) => money(fromCents(value))
  const solde = (type) => soldes.filter((s) => s.type === type).reduce((sum, s) => sum + toCents(String(s.solde)), 0)
  const totalEntrees = cotisations.total + recettes.total + dons.total
  return {
    periode: range,
    membresActifs: membres,
    totalCotisations: cents(cotisations.total),
    totalRecettes: cents(recettes.total),
    totalDons: cents(dons.total),
    totalDepenses: cents(depenses.total),
    totalEntrees: cents(totalEntrees),
    resultat: cents(totalEntrees - depenses.total),
    soldeCaisse: cents(solde("caisse")),
    soldeBanque: cents(solde("banque")),
    soldeTotal: cents(solde("caisse") + solde("banque")),
    comptes: soldes,
    situationDiocesaine: diocese,
    dernieresOperations: operations,
    evolution,
    repartitionRecettes: repartition,
    repartitionDepenses,
  }
}
