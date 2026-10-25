import { timingSafeEqual } from "node:crypto"
import { Router } from "express"
import { env } from "../config/environment.js"
import { createEmailProvider } from "../services/emailProvider.js"
import { getNotificationPreferences, notificationPreferencesSchema, retryFailedNotifications, updateNotificationPreferences } from "../services/notifications.js"
import { sendSuccess } from "../utils/http.js"
import { validateBody } from "../middlewares/validate.js"

export function isValidCronAuthorization(secret, authorization) {
  if (typeof secret !== "string" || secret.length < 32 || typeof authorization !== "string") return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(authorization)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export const notificationsCronRouter = Router()
notificationsCronRouter.get("/notifications", async (req, res) => {
  if (!isValidCronAuthorization(env.cronSecret, req.get("authorization"))) {
    return res.status(401).json({ success: false, error: { code: "CRON_NON_AUTORISE", message: "Authentification requise." } })
  }
  const provider = createEmailProvider(env.email)
  const result = await retryFailedNotifications(env.email.batchLimit, provider)
  sendSuccess(res, {
    claimed: result.claimed,
    sent: result.results.filter((item) => item.status === "sent").length,
    pending: result.results.filter((item) => item.status === "pending").length,
    dead: result.results.filter((item) => item.status === "dead").length,
  })
})

export const notificationsUserRouter = Router()
notificationsUserRouter.get("/preferences", async (req, res) =>
  sendSuccess(res, await getNotificationPreferences(req.user.id)),
)
notificationsUserRouter.put("/preferences", validateBody(notificationPreferencesSchema), async (req, res) =>
  sendSuccess(res, await updateNotificationPreferences(req.user.id, req.body, req.ctx)),
)
