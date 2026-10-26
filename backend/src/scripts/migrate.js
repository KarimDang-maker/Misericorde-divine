import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
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

const migrationLockName = (databaseName) => `md:migrate:${createHash("sha256").update(databaseName).digest("hex").slice(0, 24)}`

async function migrationObjectExists(connection, statement) {
  const alter = statement.match(/^ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+/i)
  if (!alter) return false

  const tableName = alter[1]
  const clause = statement.slice(alter[0].length).trim()
  const constraint = clause.match(/^CONSTRAINT\s+`?([A-Za-z0-9_]+)`?/i)
  if (constraint) {
    const [rows] = await connection.query(
      "SELECT 1 FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? LIMIT 1",
      [tableName, constraint[1]],
    )
    return rows.length > 0
  }

  const index = clause.match(/^(?:(?:UNIQUE|FULLTEXT|SPATIAL)\s+)?(?:KEY|INDEX)\s+`?([A-Za-z0-9_]+)`?/i)
  if (index) {
    const [rows] = await connection.query(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
      [tableName, index[1]],
    )
    return rows.length > 0
  }

  const column = clause.match(/^(?:COLUMN\s+)?`?([A-Za-z0-9_]+)`?/i)
  if (!column) return false
  const [rows] = await connection.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
    [tableName, column[1]],
  )
  return rows.length > 0
}

async function applyMigrationStatement(connection, statement) {
  // CREATE is safe to retry after an interrupted, multi-table initial migration.
  const safeStatement = statement.replace(/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")
  if (await migrationObjectExists(connection, safeStatement)) return
  await connection.query(safeStatement)
}

/** Applique les migrations versionnées une fois, sous verrou MySQL partagé entre déploiements. */
export async function runMigrations(pool, { databaseName = env.db.name, lockTimeoutSeconds = 60 } = {}) {
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool
  const releaseConnection = typeof connection.release === "function" ? () => connection.release() : async () => {}
  const lockName = migrationLockName(databaseName)
  let lockAcquired = false

  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [lockName, lockTimeoutSeconds])
    if (Number(lockRows[0]?.acquired) !== 1) {
      const error = new Error("Impossible d’obtenir le verrou des migrations MySQL.")
      error.code = "MIGRATION_LOCK_TIMEOUT"
      throw error
    }
    lockAcquired = true

    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nom VARCHAR(120) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`)
    const [applied] = await connection.query("SELECT nom FROM schema_migrations")
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
      for (const statement of statements) await applyMigrationStatement(connection, statement)
      await connection.query("INSERT INTO schema_migrations (nom) VALUES (?)", [file])
      executed.push(file)
    }
    return executed
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName])
      } catch {
        // La fermeture de connexion libère aussi un verrou de session.
      }
    }
    await releaseConnection()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pool } = await import("../config/database.js")
  const executed = await runMigrations(pool)
  console.log(executed.length ? `Migrations appliquées : ${executed.join(", ")}` : "Base déjà à jour.")
  await pool.end()
}
