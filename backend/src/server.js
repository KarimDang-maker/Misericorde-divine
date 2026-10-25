import { createApp } from "./app.js"
import { checkDatabaseConnection, pool } from "./config/database.js"
import { env } from "./config/environment.js"
import { logger } from "./config/logger.js"

try {
  await checkDatabaseConnection()
} catch (error) {
  // Aucun identifiant n'est journalisé.
  logger.error("MySQL indisponible : vérifiez DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.", { code: error.code })
  process.exit(1)
}
const app = createApp()
const server = app.listen(env.port, () => logger.info("API démarrée", { port: env.port, env: env.nodeEnv }))

async function shutdown() {
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
