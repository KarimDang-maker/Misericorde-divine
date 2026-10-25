import { env } from "../config/environment.js"
import { getCurrentUser } from "../services/auth.js"
import { forbidden, unauthorized } from "../utils/errors.js"

export async function authenticate(req, _res, next) {
  const token = req.cookies?.[env.session.cookieName]
  const user = await getCurrentUser(token)
  if (!user) throw unauthorized("Session absente ou expirée.")
  req.user = user
  req.sessionToken = token
  req.ctx = { user, ip: req.ip, requestId: req.id, userAgent: req.headers["user-agent"] }
  next()
}

export function requireActiveAccount(req, _res, next) {
  if (!req.user?.actif) throw forbidden("Ce compte est désactivé.")
  next()
}

export function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: env.session.secureCookie,
    sameSite: env.session.sameSite,
    path: "/",
    ...(expiresAt ? { expires: expiresAt } : {}),
  }
}
