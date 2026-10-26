import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import mysql from "mysql2/promise"
import { runMigrations } from "./migrate.js"

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const localEnvPath = path.join(backendDir, ".env")
const aivenEnvPath = path.join(backendDir, ".env.production")

// L’ordre respecte les clés étrangères. Les sessions et caches de requêtes restent locaux.
const IMPORT_TABLES = [
  "users",
  "reference_counters",
  "members",
  "financial_accounts",
  "contribution_categories",
  "revenue_categories",
  "donation_categories",
  "expense_categories",
  "diocesan_generation_locks",
  "contributions",
  "revenues",
  "donations",
  "expenses",
  "diocesan_contributions",
  "account_adjustments",
  "financial_movements",
  "operation_status_history",
  "attachments",
  "operation_attachments",
  "anomalies",
  "anomaly_history",
  "settings",
  "user_preferences",
  "audit_logs",
]

const EXCLUDED_TABLES = new Set([
  "schema_migrations",
  "sessions",
  "idempotency_keys",
  "notification_outbox",
  "password_reset_tokens",
  "password_reset_rate_limits",
])

const quoteIdentifier = (identifier) => `\`${String(identifier).replaceAll("`", "``")}\``
const required = (config, keys, label) => {
  const missing = keys.filter((key) => !String(config[key] || "").trim())
  if (missing.length) throw new Error(`${label} incomplet : ${missing.join(", ")}`)
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Fichier absent : ${path.basename(filePath)}`)
  return dotenv.parse(fs.readFileSync(filePath))
}

function connectionOptions(config) {
  return {
    host: config.DB_HOST,
    port: Number(config.DB_PORT || 3306),
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    connectionLimit: 2,
    connectTimeout: 10000,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
    ...(String(config.DB_SSL || "").toLowerCase() === "true" || config.DB_SSL === "1"
      ? { ssl: { ca: String(config.DB_SSL_CA || "").replace(/\\n/g, "\n"), rejectUnauthorized: true } }
      : {}),
  }
}

async function listTables(connection) {
  const [rows] = await connection.query(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = ? ORDER BY TABLE_NAME",
    ["BASE TABLE"],
  )
  return rows.map((row) => row.name)
}

async function readLocalSnapshot(sourceConnection) {
  const tables = await listTables(sourceConnection)
  const known = new Set([...IMPORT_TABLES, ...EXCLUDED_TABLES])
  const unknownTables = tables.filter((table) => !known.has(table))
  const missingTables = IMPORT_TABLES.filter((table) => !tables.includes(table))
  if (unknownTables.length || missingTables.length) {
    throw new Error(`Schéma local inattendu (tables inconnues : ${unknownTables.join(", ") || "aucune"}; manquantes : ${missingTables.join(", ") || "aucune"}).`)
  }

  const [attachmentCountRows] = await sourceConnection.query("SELECT COUNT(*) AS total FROM attachments")
  if (Number(attachmentCountRows[0].total) > 0) {
    throw new Error("Import interrompu : des justificatifs locaux existent. Leurs fichiers doivent être transférés vers Vercel Blob avant l’import de leurs métadonnées.")
  }

  const snapshot = new Map()
  for (const table of IMPORT_TABLES) {
    const [columns] = await sourceConnection.query(
      "SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ORDINAL_POSITION",
      [table],
    )
    const [rows] = await sourceConnection.query(`SELECT * FROM ${quoteIdentifier(table)}`)
    snapshot.set(table, { columns, rows })
  }
  return snapshot
}

async function assertTargetEmpty(targetConnection) {
  const occupied = []
  for (const table of IMPORT_TABLES) {
    const [rows] = await targetConnection.query(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`)
    if (Number(rows[0].total) > 0) occupied.push(table)
  }
  if (occupied.length) {
    const error = new Error(`Import refusé : la base Aiven contient déjà des données dans : ${occupied.join(", ")}. Aucune ligne n’a été modifiée.`)
    error.code = "AIVEN_IMPORT_TARGET_NOT_EMPTY"
    throw error
  }
}

async function assertColumnsCompatible(sourceConnection, targetConnection, snapshot) {
  for (const table of IMPORT_TABLES) {
    const [targetColumns] = await targetConnection.query(
      "SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
      [table],
    )
    const targetNames = new Set(targetColumns.map((column) => column.name))
    const missing = snapshot.get(table).columns.filter((column) => !targetNames.has(column.name)).map((column) => column.name)
    if (missing.length) throw new Error(`Schéma incompatible pour ${table}; colonnes absentes sur Aiven : ${missing.join(", ")}.`)
  }
}

function normalizeValue(value, type) {
  if (value == null || type !== "json" || typeof value === "string") return value
  if (Buffer.isBuffer(value)) return value.toString("utf8")
  return JSON.stringify(value)
}

async function insertSnapshot(targetConnection, snapshot) {
  const imported = {}
  for (const table of IMPORT_TABLES) {
    const { columns, rows } = snapshot.get(table)
    imported[table] = rows.length
    if (!rows.length) continue
    const names = columns.map((column) => column.name)
    const types = columns.map((column) => column.type)
    const columnSql = names.map(quoteIdentifier).join(", ")
    const tuple = `(${names.map(() => "?").join(", ")})`
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100)
      const sql = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES ${batch.map(() => tuple).join(", ")}`
      const values = batch.flatMap((row) => names.map((name, index) => normalizeValue(row[name], types[index])))
      await targetConnection.query(sql, values)
    }
  }
  return imported
}

async function main() {
  const local = readEnvFile(localEnvPath)
  const aiven = readEnvFile(aivenEnvPath)
  required(local, ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"], "Connexion locale")
  required(aiven, ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL_CA"], "Connexion Aiven")
  if (!["127.0.0.1", "localhost"].includes(local.DB_HOST)) throw new Error("La source doit être une base locale (localhost ou 127.0.0.1).")
  if (!String(aiven.DB_HOST).toLowerCase().endsWith(".aivencloud.com")) throw new Error("La destination doit être un hôte Aiven.")
  if (!(String(aiven.DB_SSL).toLowerCase() === "true" || aiven.DB_SSL === "1")) throw new Error("DB_SSL=true est requis pour l’import Aiven.")

  const sourcePool = mysql.createPool(connectionOptions(local))
  const targetPool = mysql.createPool(connectionOptions(aiven))
  let sourceConnection
  let targetConnection
  let importLockAcquired = false
  let localTransactionOpen = false
  let targetTransactionOpen = false
  const importLock = `md:initial-import:${createHash("sha256").update(`${aiven.DB_HOST}/${aiven.DB_NAME}`).digest("hex").slice(0, 24)}`

  try {
    // Met aussi la source au dernier schéma local disponible, sans effacer ses données.
    const sourceMigrations = await runMigrations(sourcePool, { databaseName: local.DB_NAME })
    sourceConnection = await sourcePool.getConnection()
    await sourceConnection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    await sourceConnection.beginTransaction()
    localTransactionOpen = true
    const snapshot = await readLocalSnapshot(sourceConnection)
    await sourceConnection.commit()
    localTransactionOpen = false

    const targetMigrations = await runMigrations(targetPool, { databaseName: aiven.DB_NAME })
    targetConnection = await targetPool.getConnection()
    const [lockRows] = await targetConnection.query("SELECT GET_LOCK(?, 60) AS acquired", [importLock])
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error("Impossible d’obtenir le verrou de l’import initial Aiven.")
    importLockAcquired = true

    await assertTargetEmpty(targetConnection)
    await assertColumnsCompatible(sourceConnection, targetConnection, snapshot)
    await targetConnection.beginTransaction()
    targetTransactionOpen = true
    const imported = await insertSnapshot(targetConnection, snapshot)
    await targetConnection.commit()
    targetTransactionOpen = false

    // Vérifie les volumes persistés après le commit; les données métier ne sont pas imprimées.
    const verified = {}
    for (const table of IMPORT_TABLES) {
      const [rows] = await targetConnection.query(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`)
      verified[table] = Number(rows[0].total)
      if (verified[table] !== imported[table]) throw new Error(`Vérification après import échouée pour ${table}.`)
    }
    console.log(JSON.stringify({
      result: "imported",
      sourceMigrationsApplied: sourceMigrations.length,
      aivenMigrationsApplied: targetMigrations.length,
      imported,
      excludedOperationalTables: [...EXCLUDED_TABLES],
      verified: true,
    }))
  } catch (error) {
    if (targetTransactionOpen) await targetConnection.rollback().catch(() => {})
    if (localTransactionOpen) await sourceConnection.rollback().catch(() => {})
    console.error("Import local vers Aiven échoué.", { code: error.code || "IMPORT_ERROR", message: error.message })
    process.exitCode = 1
  } finally {
    if (importLockAcquired) await targetConnection.query("SELECT RELEASE_LOCK(?)", [importLock]).catch(() => {})
    targetConnection?.release()
    sourceConnection?.release()
    await Promise.all([sourcePool.end(), targetPool.end()])
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
