import { one, run } from "../config/database.js"

/**
 * Génère une référence unique (ex. CT-2025-000148) de façon atomique : le compteur est
 * incrémenté par INSERT ... ON DUPLICATE KEY UPDATE et verrouillé jusqu'à la fin de la transaction.
 */
export async function nextReference(connection, prefix, isoDate, { withYear = true } = {}) {
  const year = withYear ? Number(String(isoDate).slice(0, 4)) : 0
  await run(
    connection,
    `INSERT INTO reference_counters (prefix, annee, derniere_valeur) VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE derniere_valeur = LAST_INSERT_ID(derniere_valeur + 1)`,
    [prefix, year],
  )
  const row = await one(connection, "SELECT LAST_INSERT_ID() AS value")
  const sequence = String(row.value).padStart(6, "0")
  return withYear ? `${prefix}-${year}-${sequence}` : `${prefix}-${sequence}`
}
