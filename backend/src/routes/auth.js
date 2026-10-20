import { Router } from "express"
import { env } from "../config/environment.js"
import { authenticate, cookieOptions, requireActiveAccount } from "../middlewares/auth.js"
import { rateLimitAuthentication } from "../middlewares/security.js"
import { validateBody } from "../middlewares/validate.js"
import { changePassword, login, loginSchema, logout, passwordSchema, publicUser } from "../services/auth.js"
import { sendSuccess } from "../utils/http.js"

export const authRouter = Router()

authRouter.post("/login", rateLimitAuthentication, validateBody(loginSchema), async (req, res) => {
  const session = await login(req.body, { ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.id })
  res.cookie(env.session.cookieName, session.token, cookieOptions(session.expiresAt))
  sendSuccess(res, { user: session.user, expiresAt: session.expiresAt })
})

authRouter.post("/logout", async (req, res) => {
  await logout(req.cookies?.[env.session.cookieName])
  res.clearCookie(env.session.cookieName, cookieOptions())
  sendSuccess(res, { loggedOut: true })
})

authRouter.get("/me", authenticate, requireActiveAccount, (req, res) => {
  sendSuccess(res, { user: publicUser(req.user) })
})

authRouter.put("/password", authenticate, requireActiveAccount, validateBody(passwordSchema), async (req, res) => {
  const result = await changePassword(req.user.id, req.body, req.ctx, req.sessionToken)
  sendSuccess(res, result)
})
