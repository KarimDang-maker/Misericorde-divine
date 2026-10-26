import { createApp } from "./app.js"
import { checkDatabaseConnection, pool } from "./config/database.js"
import { env } from "./config/environment.js"
import { logger } from "./config/logger.js"
import { runMigrations } from "./scripts/migrate.js"

try {
  const migrations = await runMigrations(pool, { databaseName: env.db.name })
  logger.info(migrations.length ? "Migrations locales appliquées" : "Schéma local déjà à jour", { count: migrations.length })
  await checkDatabaseConnection()
} catch (error) {
  // Aucun identifiant ni détail SQL n'est journalisé.
  logger.error("Initialisation de la base impossible : vérifiez la connexion MySQL et les migrations.", { code: error.code })
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
