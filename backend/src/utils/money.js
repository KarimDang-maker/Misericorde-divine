import { unprocessable } from "./errors.js"

/** Montants manipulés en centimes entiers côté JS pour éviter les erreurs d'arrondi flottant. */
export function toCents(value) {
  if (value === null || value === undefined || value === "") return null
  const text = String(value).trim().replace(/\s/g, "").replace(",", ".")
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null
  const negative = text.startsWith("-")
  const [whole, fraction = ""] = text.replace("-", "").split(".")
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  return negative ? -cents : cents
}

export function fromCents(cents) {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
  return negative ? `-${text}` : text
}

/** Valide un montant strictement positif, max DECIMAL(15,2). Retourne la chaîne "123.45". */
export function parsePositiveAmount(value, field = "montant") {
  const cents = toCents(value)
  if (cents === null) {
    throw unprocessable("MONTANT_INVALIDE", "Le montant est invalide (2 décimales maximum).", {
      [field]: "Montant invalide",
    })
  }
  if (cents <= 0) {
    throw unprocessable("MONTANT_INVALIDE", "Le montant doit être strictement positif.", {
      [field]: "Doit être supérieur à zéro",
    })
  }
  if (cents > 999_999_999_999_999) {
    throw unprocessable("MONTANT_INVALIDE", "Le montant dépasse la limite autorisée.", {
      [field]: "Trop élevé",
    })
  }
  return fromCents(cents)
}

/** DECIMAL (chaîne MySQL) → nombre JSON, exact à 2 décimales pour les ordres de grandeur gérés. */
export function money(value) {
  if (value === null || value === undefined) return 0
  return Number(value)
}
