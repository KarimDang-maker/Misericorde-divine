import { env, validateProductionEnvironment } from "../config/environment.js"
import { pool } from "../config/database.js"
import { runMigrations } from "./migrate.js"

// Vercel Preview builds must never apply schema changes to the production database.
if (process.env.VERCEL_ENV !== "production") {
  console.log("Initialisation du schéma ignorée hors déploiement Vercel Production.")
  await pool.end()
} else {
  try {
    if (env.nodeEnv !== "production") throw new Error("NODE_ENV doit valoir production pour cette étape.")
    validateProductionEnvironment(env)
    const migrations = await runMigrations(pool, { databaseName: env.db.name })
    console.log(migrations.length
      ? `Schéma Aiven initialisé. Migrations appliquées : ${migrations.join(", ")}`
      : "Schéma Aiven déjà à jour ; aucune migration à appliquer.")
  } catch (error) {
    console.error("Échec de l’initialisation automatique du schéma.", { code: error.code || "CONFIGURATION_OR_MIGRATION_ERROR" })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
