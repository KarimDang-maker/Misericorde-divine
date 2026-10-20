import { createApp } from "./app.js"
import { checkDatabaseConnection, pool } from "./config/database.js"
import { env } from "./config/environment.js"
import { logger } from "./config/logger.js"
import { revokeExpiredSessions } from "./services/auth.js"
import { runMigrations } from "./scripts/migrate.js"

try {
  await checkDatabaseConnection()
} catch (error) {
  // Aucun identifiant n'est journalisé.
  logger.error("MySQL indisponible : vérifiez DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.", { code: error.code })
  process.exit(1)
}
await runMigrations(pool)

const app = createApp()
const server = app.listen(env.port, () => logger.info("API démarrée", { port: env.port, env: env.nodeEnv }))

const sessionJob = setInterval(() => revokeExpiredSessions().catch(() => {}), 60 * 60 * 1000)
sessionJob.unref()

async function shutdown() {
  clearInterval(sessionJob)
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
