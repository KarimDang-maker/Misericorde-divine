import { run } from "../config/database.js"

const SENSITIVE = new Set(["password", "password_hash", "motDePasse", "ancienMotDePasse", "nouveauMotDePasse"])

function scrub(value) {
  if (value === null || value === undefined) return null
  const copy = {}
  for (const [key, val] of Object.entries(value)) {
    if (!SENSITIVE.has(key)) copy[key] = val
  }
  return JSON.stringify(copy)
}

/**
 * Journal d'audit : exécuté avec la connexion de la transaction métier afin que
 * l'audit soit validé ou annulé avec l'opération.
 */
export async function createAuditLog(executor, { ctx, action, entityType, entityId, before, after }) {
  await run(
    executor,
    `INSERT INTO audit_logs (user_id, action, entite_type, entite_id, anciennes_valeurs, nouvelles_valeurs, request_id, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ctx?.user?.id ?? null,
      action,
      entityType,
      entityId === undefined || entityId === null ? null : String(entityId),
      scrub(before),
      scrub(after),
      ctx?.requestId ?? null,
      ctx?.ip ?? null,
    ],
  )
}
