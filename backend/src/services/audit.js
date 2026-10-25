import { run } from "../config/database.js"

const SENSITIVE_KEY = /password|mot.?de.?passe|token|secret|cookie|authorization|api.?key|blob|buffer|contenu.?fichier/i

function scrub(value) {
  if (value === null || value === undefined) return null
  const sanitize = (item) => {
    if (Array.isArray(item)) return item.map(sanitize)
    if (!item || typeof item !== "object") return item
    return Object.fromEntries(Object.entries(item).map(([key, val]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(val)]))
  }
  return JSON.stringify(sanitize(value))
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
