import mysql from "mysql2/promise"
import { env } from "./environment.js"

/** Pool MySQL : utf8mb4, dates en chaînes (pas de décalage de fuseau), DECIMAL en chaînes exactes. */
export function createDatabasePool(overrides = {}) {
  return mysql.createPool({
    host: env.db.host,
    port: env.db.port,
    database: env.db.name,
    user: env.db.user,
    password: env.db.password,
    connectionLimit: env.db.connectionLimit,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
    ...overrides,
  })
}

export const pool = createDatabasePool()

export async function checkDatabaseConnection() {
  const [result] = await pool.query("SELECT 1 AS ok")
  return result[0].ok === 1
}

/** Exécute le callback dans une transaction (COMMIT / ROLLBACK automatiques). */
export async function withTransaction(callback) {
  const connection = await pool.getConnection()
  try {
    // READ COMMITTED : après le verrou du compte, les soldes lus voient les écritures déjà validées
    // par les transactions concurrentes (sinon le snapshot REPEATABLE READ permettrait un découvert).
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED")
    await connection.beginTransaction()
    const result = await callback(connection)
    await connection.commit()
    return result
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      /* la connexion est peut-être déjà perdue */
    }
    throw error
  } finally {
    connection.release()
  }
}

/** Requête paramétrée : retourne toutes les lignes (connexion de transaction ou pool). */
export async function rows(executor, sql, params = []) {
  const [result] = await (executor || pool).query(sql, params)
  return result
}

export async function one(executor, sql, params = []) {
  const result = await rows(executor, sql, params)
  return result[0] ?? null
}

/** Requête d'écriture : retourne { insertId, affectedRows }. */
export async function run(executor, sql, params = []) {
  const [result] = await (executor || pool).query(sql, params)
  return result
}
