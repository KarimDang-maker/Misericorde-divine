import { unprocessable } from "./errors.js"

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidIsoDate(value) {
  if (typeof value !== "string") return false
  const match = ISO.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function requireDate(value, field) {
  if (!isValidIsoDate(value)) {
    throw unprocessable("DATE_INVALIDE", `La date « ${field} » est invalide (format AAAA-MM-JJ).`, {
      [field]: "Date invalide",
    })
  }
  return value
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Normalise une période : bornes INCLUSIVES, dates facultatives.
 * Aucune période par défaut n'est choisie arbitrairement.
 */
export function normalizeDateRange(dateDebut, dateFin) {
  const start = dateDebut || null
  const end = dateFin || null
  if (start && !isValidIsoDate(start)) {
    throw unprocessable("DATE_INVALIDE", "dateDebut invalide (AAAA-MM-JJ).", { dateDebut: "Date invalide" })
  }
  if (end && !isValidIsoDate(end)) {
    throw unprocessable("DATE_INVALIDE", "dateFin invalide (AAAA-MM-JJ).", { dateFin: "Date invalide" })
  }
  if (start && end && start > end) {
    throw unprocessable("PERIODE_INVALIDE", "La date de début doit précéder la date de fin.", {
      dateDebut: "Postérieure à la date de fin",
    })
  }
  return { dateDebut: start, dateFin: end }
}

/** Ajoute les conditions « col >= debut » et « col <= fin » (bornes inclusives). */
export function dateRangeClause(column, range, where, params) {
  if (range.dateDebut) {
    where.push(`${column} >= ?`)
    params.push(range.dateDebut)
  }
  if (range.dateFin) {
    where.push(`${column} <= ?`)
    params.push(range.dateFin)
  }
}

/** Normalise une valeur Date/texte venant d'Excel en AAAA-MM-JJ, ou null. */
export function excelDateToIso(value) {
  if (value === null || value === undefined || value === "") return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  const text = String(value).trim()
  if (isValidIsoDate(text)) return text
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (fr) {
    const iso = `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`
    return isValidIsoDate(iso) ? iso : null
  }
  return null
}
