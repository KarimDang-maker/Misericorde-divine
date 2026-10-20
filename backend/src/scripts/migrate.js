import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import mysql from "mysql2/promise"
import { env } from "../config/environment.js"

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations")

/** Crée la base et l'utilisateur applicatif si besoin (nécessite le compte administrateur MySQL). */
export async function createDatabaseIfMissing() {
  const admin = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.rootUser,
    password: env.db.rootPassword,
  })
  try {
    const name = admin.escapeId(env.db.name)
    await admin.query(`CREATE DATABASE IF NOT EXISTS ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
    await admin.query("CREATE USER IF NOT EXISTS ?@'localhost' IDENTIFIED BY ?", [env.db.user, env.db.password])
    await admin.query(`GRANT ALL PRIVILEGES ON ${name}.* TO ?@'localhost'`, [env.db.user])
  } finally {
    await admin.end()
  }
}

/** Applique les migrations SQL versionnées non encore appliquées. */
export async function runMigrations(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nom VARCHAR(120) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`)
  const [applied] = await pool.query("SELECT nom FROM schema_migrations")
  const done = new Set(applied.map((row) => row.nom))
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort()
  const executed = []
  for (const file of files) {
    if (done.has(file)) continue
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8")
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean)
    for (const statement of statements) await pool.query(statement)
    await pool.query("INSERT INTO schema_migrations (nom) VALUES (?)", [file])
    executed.push(file)
  }
  return executed
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pool } = await import("../config/database.js")
  await createDatabaseIfMissing()
  const executed = await runMigrations(pool)
  console.log(executed.length ? `Migrations appliquées : ${executed.join(", ")}` : "Base déjà à jour.")
  await pool.end()
}
