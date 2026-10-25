import { createHash } from "node:crypto"
import { one, run } from "../config/database.js"
import { conflict, badRequest } from "../utils/errors.js"

/** Requêtes en cours par clé (processus unique) : une seconde requête identique attend la première. */
const inFlight = new Map()

/**
 * Middleware optionnel : si l'en-tête Idempotency-Key est fourni, la première réponse de succès
 * est mémorisée puis rejouée à l'identique pour toute répétition (double clic, retry réseau).
 */
export async function idempotent(req, res, next) {
  const key = req.headers["idempotency-key"]
  if (!key) return next()
  if (typeof key !== "string" || key.length > 100) {
    throw badRequest("IDEMPOTENCY_KEY_INVALIDE", "Idempotency-Key invalide (100 caractères max).")
  }
  const routeId = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`
  const requestHash = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex")
  const lockId = `${req.user.id}:${key}`

  const replay = async () => {
    const stored = await one(null, "SELECT * FROM idempotency_keys WHERE user_id = ? AND cle = ?", [req.user.id, key])
    if (!stored) return false
    if (stored.route !== routeId) {
      throw conflict("IDEMPOTENCY_KEY_REUTILISEE", "Cette clé d'idempotence a déjà servi pour une autre route.")
    }
    if (!stored.request_hash || stored.request_hash !== requestHash) {
      throw conflict("IDEMPOTENCY_KEY_REUTILISEE", "Cette clé d'idempotence a déjà servi pour une autre requête.")
    }
    const body = typeof stored.corps === "string" ? JSON.parse(stored.corps) : stored.corps
    res.setHeader("Idempotent-Replay", "true")
    res.status(stored.statut_http).json(body)
    return true
  }

  // Le verrou est posé de façon synchrone après l'attente : deux requêtes ne peuvent pas le prendre ensemble.
  let release
  for (;;) {
    const pending = inFlight.get(lockId)
    if (!pending) break
    await pending
  }
  inFlight.set(lockId, new Promise((resolve) => (release = resolve)))
  try {
    if (await replay()) {
      inFlight.delete(lockId)
      release()
      return
    }
  } catch (error) {
    inFlight.delete(lockId)
    release()
    throw error
  }
  const originalJson = res.json.bind(res)
  res.json = (body) => {
    const status = res.statusCode
    const finish = () => {
      inFlight.delete(lockId)
      release()
    }
    if (status >= 200 && status < 300) {
      run(null, "INSERT IGNORE INTO idempotency_keys (cle, user_id, route, request_hash, statut_http, corps) VALUES (?, ?, ?, ?, ?, ?)", [
        key,
        req.user.id,
        routeId,
        requestHash,
        status,
        JSON.stringify(body),
      ])
        .catch(() => {})
        .finally(() => {
          finish()
          originalJson(body)
        })
      return res
    }
    finish()
    return originalJson(body)
  }
  res.on("close", () => {
    if (inFlight.has(lockId)) {
      inFlight.delete(lockId)
      release()
    }
  })
  next()
}
