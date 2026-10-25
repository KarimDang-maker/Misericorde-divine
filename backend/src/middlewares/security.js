import rateLimit from "express-rate-limit"
import { env } from "../config/environment.js"
import { sendError } from "../utils/http.js"

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Défense CSRF complémentaire à SameSite : une requête qui modifie l'état doit venir
 * d'une origine autorisée lorsque l'en-tête Origin est présent.
 */
export function checkOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next()
  const origin = req.headers.origin
  if (!origin) return next()
  const host = req.headers.host
  const sameHost = (() => {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  })()
  if (sameHost || env.allowedOrigins.includes(origin)) return next()
  return sendError(res, 403, "ORIGINE_REFUSEE", "Origine de la requête non autorisée.", {}, req.id)
}

export function cors(req, res, next) {
  const origin = req.headers.origin
  if (origin && env.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Vary", "Origin")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Request-Id")
  }
  if (req.method === "OPTIONS") return res.sendStatus(204)
  next()
}

export const rateLimitAuthentication = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.nodeEnv === "test" ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    sendError(res, 429, "TROP_DE_TENTATIVES", "Trop de tentatives de connexion. Réessayez plus tard.", {}, req.id),
})

export const rateLimitPasswordReset = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.nodeEnv === "test" ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) =>
    sendError(res, 429, "TROP_DE_TENTATIVES", "Trop de tentatives. Réessayez plus tard.", {}, req.id),
})
