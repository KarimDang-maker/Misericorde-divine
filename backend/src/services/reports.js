import { one } from "../config/database.js"
import { unprocessable, notFound } from "../utils/errors.js"
import { dateRangeClause, normalizeDateRange } from "../utils/dates.js"
import { fromCents, money, toCents } from "../utils/money.js"
import { getAccountBalance, listAccounts } from "./accounts.js"
import { getDashboardSummary, getRecentOperations } from "./dashboard.js"
import { getDiocesanReport } from "./diocese.js"
import { getResource } from "./exchange.js"
import { OPERATION_TYPES } from "./operations.js"
import { buildCsv, buildPdf, buildWorkbook } from "./tabular.js"

/**
 * Les écrans de rapport et les exports utilisent exactement les mêmes services de données :
 * un rapport est { titre, periode, colonnes, lignes, totaux }.
 */

const fmt = (value) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)

async function operationReport(key, filters) {
  const resource = getResource(key)
  const config = OPERATION_TYPES[key]
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const lignes = await resource.exportRows(filters)
  const valid = lignes.filter((l) => l.statut === "valide")
  const total = valid.reduce((sum, l) => sum + toCents(String(l.montant)), 0)
  const byCategory = new Map()
  for (const l of valid) byCategory.set(l.rubrique, (byCategory.get(l.rubrique) ?? 0) + toCents(String(l.montant)))
  return {
    id: key,
    titre: `Rapport des ${key === "depenses" ? "dépenses" : key === "dons" ? "dons et offrandes" : key}`,
    periode: range,
    colonnes: resource.colonnes,
    lignes,
    totaux: [
      { label: `Total ${config.label}s validées`, valeur: money(fromCents(total)) },
      { label: "Nombre d'opérations validées", valeur: valid.length },
      { label: "Nombre d'opérations annulées", valeur: lignes.length - valid.length },
      ...[...byCategory].map(([label, cents]) => ({ label: `Rubrique : ${label}`, valeur: money(fromCents(cents)) })),
    ],
    pdfColonnes: ["reference", "dateOperation", config.member !== "none" ? "membre" : "tiers", "rubrique", "compte", "montant", "statut"],
  }
}

export const getContributionReport = (f) => operationReport("cotisations", f)
export const getRevenueReport = (f) => operationReport("recettes", f)
export const getDonationReport = (f) => operationReport("dons", f)
export const getExpenseReport = (f) => operationReport("depenses", f)

/** Positions par compte sur la période ; le solde final est arrêté à dateFin (ou actuel). */
export async function getPositions(filters = {}, type) {
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const accounts = await listAccounts({ actif: "true", ...(type ? { type } : {}) })
  const items = []
  for (const account of accounts) {
    const where = ["account_id = ?"]
    const params = [account.id]
    dateRangeClause("date_operation", range, where, params)
    const flow = await one(
      null,
      `SELECT COALESCE(SUM(CASE sens WHEN 'entree' THEN montant END),0) AS entrees,
              COALESCE(SUM(CASE sens WHEN 'sortie' THEN montant END),0) AS sorties
       FROM financial_movements WHERE ${where.join(" AND ")}`,
      params,
    )
    const before = range.dateDebut
      ? await getAccountBalance(account.id, new Date(new Date(`${range.dateDebut}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10))
      : { solde: account.soldeInitial }
    const end = await getAccountBalance(account.id, range.dateFin ?? undefined)
    items.push({
      compteId: account.id,
      code: account.code,
      nom: account.nom,
      type: account.type,
      soldeOuverture: money(before.solde),
      entrees: money(flow.entrees),
      sorties: money(flow.sorties),
      soldeFinal: money(end.solde),
    })
  }
  const sum = (field) => money(fromCents(items.reduce((s, i) => s + toCents(String(i[field])), 0)))
  return {
    periode: range,
    items,
    totaux: { soldeOuverture: sum("soldeOuverture"), entrees: sum("entrees"), sorties: sum("sorties"), soldeFinal: sum("soldeFinal") },
  }
}

export const getCashPosition = (f) => getPositions(f, "caisse")
export const getBankPosition = (f) => getPositions(f, "banque")
export const getConsolidatedPosition = (f) => getPositions(f)

export async function getTreasuryReport(filters) {
  const position = await getConsolidatedPosition(filters)
  return {
    id: "tresorerie",
    titre: "Rapport de trésorerie",
    periode: position.periode,
    colonnes: [
      { key: "code", header: "Code", type: "text" },
      { key: "nom", header: "Compte", type: "text", width: 26 },
      { key: "type", header: "Type", type: "text" },
      { key: "soldeOuverture", header: "Solde d'ouverture", type: "amount", width: 18 },
      { key: "entrees", header: "Entrées", type: "amount" },
      { key: "sorties", header: "Sorties", type: "amount" },
      { key: "soldeFinal", header: "Solde final", type: "amount" },
    ],
    lignes: position.items,
    totaux: [
      { label: "Solde d'ouverture total", valeur: position.totaux.soldeOuverture },
      { label: "Total entrées", valeur: position.totaux.entrees },
      { label: "Total sorties", valeur: position.totaux.sorties },
      { label: "Solde final total", valeur: position.totaux.soldeFinal },
    ],
    pdfColonnes: ["code", "nom", "type", "soldeOuverture", "entrees", "sorties", "soldeFinal"],
  }
}

export async function getDiocesanContributionReport(filters) {
  const resource = getResource("contribution-diocesaine")
  const { summary, items } = await getDiocesanReport(filters)
  return {
    id: "contribution-diocesaine",
    titre: "Rapport de la contribution diocésaine",
    periode: summary.periode,
    colonnes: resource.colonnes,
    lignes: items,
    totaux: [
      { label: "Total versé (validé)", valeur: summary.totalVerse },
      { label: "Nombre de versements", valeur: summary.nombre },
      ...(summary.calcul ? [{ label: "Montant dû selon la règle configurée", valeur: summary.calcul.montantDu }] : []),
    ],
    pdfColonnes: ["reference", "dateOperation", "compte", "periodeDebut", "periodeFin", "montant", "statut"],
  }
}

export async function getFinancialSummaryReport(filters) {
  const s = await getDashboardSummary(filters)
  const lignes = [
    { poste: "Cotisations", montant: s.totalCotisations },
    { poste: "Recettes", montant: s.totalRecettes },
    { poste: "Dons et offrandes", montant: s.totalDons },
    { poste: "Total des entrées", montant: s.totalEntrees },
    { poste: "Dépenses", montant: s.totalDepenses },
    { poste: "Résultat (entrées − dépenses)", montant: s.resultat },
    { poste: "Contribution diocésaine versée", montant: s.situationDiocesaine.totalVerse },
    { poste: "Solde de caisse", montant: s.soldeCaisse },
    { poste: "Soldes bancaires", montant: s.soldeBanque },
    { poste: "Solde total", montant: s.soldeTotal },
  ]
  return {
    id: "synthese-financiere",
    titre: "Synthèse financière",
    periode: s.periode,
    colonnes: [
      { key: "poste", header: "Poste", type: "text", width: 40 },
      { key: "montant", header: "Montant", type: "amount", width: 18 },
    ],
    lignes,
    totaux: s.repartitionDepenses.map((d) => ({ label: `Dépenses — ${d.nom}`, valeur: d.valeur })),
    pdfColonnes: ["poste", "montant"],
  }
}

export async function getOperationHistoryReport(filters) {
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const lignes = await getRecentOperations(range, 5000)
  return {
    id: "historique-operations",
    titre: "Historique des opérations",
    periode: range,
    colonnes: [
      { key: "dateOperation", header: "Date", type: "date" },
      { key: "reference", header: "Référence", type: "text", width: 18 },
      { key: "type", header: "Type", type: "text" },
      { key: "sens", header: "Sens", type: "text" },
      { key: "montant", header: "Montant", type: "amount" },
      { key: "statut", header: "Statut", type: "text" },
      { key: "libelle", header: "Libellé", type: "text", width: 36 },
    ],
    lignes,
    totaux: [{ label: "Nombre d'opérations", valeur: lignes.length }],
    pdfColonnes: ["dateOperation", "reference", "type", "sens", "montant", "statut", "libelle"],
  }
}

export const REPORTS = {
  cotisations: getContributionReport,
  recettes: getRevenueReport,
  dons: getDonationReport,
  depenses: getExpenseReport,
  tresorerie: getTreasuryReport,
  "contribution-diocesaine": getDiocesanContributionReport,
  "synthese-financiere": getFinancialSummaryReport,
  "historique-operations": getOperationHistoryReport,
}

export function getReport(type, filters = {}) {
  const builder = REPORTS[type]
  if (!builder) throw notFound("RAPPORT_INCONNU", "Ce rapport n'existe pas.")
  return builder(filters)
}

const MIMES = {
  csv: ["text/csv; charset=utf-8", "csv"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  pdf: ["application/pdf", "pdf"],
}

export async function exportReport(type, filters, format) {
  const target = MIMES[format]
  if (!target) throw unprocessable("FORMAT_INVALIDE", "Format d'export inconnu (csv, xlsx ou pdf).", { format: "csv, xlsx ou pdf" })
  const report = await getReport(type, filters)
  const periodText = `${report.periode.dateDebut ?? "début"} → ${report.periode.dateFin ?? "aujourd'hui"}`
  let buffer
  if (format === "csv") {
    buffer = buildCsv(report)
  } else if (format === "xlsx") {
    buffer = await buildWorkbook({
      titre: report.titre,
      feuille: "Données",
      colonnes: report.colonnes,
      lignes: report.lignes,
      informations: [{ label: "Période", valeur: periodText }, ...report.totaux.map((t) => ({ label: t.label, valeur: t.valeur }))],
    })
  } else {
    const pdfCols = report.colonnes.filter((c) => report.pdfColonnes.includes(c.key))
    const lignes = report.lignes.map((l) =>
      Object.fromEntries(pdfCols.map((c) => [c.key, c.type === "amount" && l[c.key] !== null && l[c.key] !== undefined ? fmt(l[c.key]) : l[c.key]])),
    )
    buffer = await buildPdf({
      titre: report.titre,
      sousTitre: `Période : ${periodText}`,
      colonnes: pdfCols,
      lignes,
      totaux: report.totaux.map((t) => ({ label: t.label, valeur: typeof t.valeur === "number" ? fmt(t.valeur) : t.valeur })),
    })
  }
  return { buffer, mime: target[0], filename: `rapport-${type}-${new Date().toISOString().slice(0, 10)}.${target[1]}` }
}

export const exportReportToCsv = (type, filters) => exportReport(type, filters, "csv")
export const exportReportToExcel = (type, filters) => exportReport(type, filters, "xlsx")
export const exportReportToPdf = (type, filters) => exportReport(type, filters, "pdf")
