import { env } from "../config/environment.js"
import { createEmailProvider } from "../services/emailProvider.js"
import { retryFailedNotifications } from "../services/notifications.js"

const { pool } = await import("../config/database.js")
try {
  const provider = createEmailProvider(env.email)
  const result = await retryFailedNotifications(env.email.batchLimit, provider)
  console.log(JSON.stringify({ claimed: result.claimed, sent: result.results.filter((x) => x.status === "sent").length, pending: result.results.filter((x) => x.status === "pending").length, dead: result.results.filter((x) => x.status === "dead").length }))
} finally {
  await pool.end()
}
