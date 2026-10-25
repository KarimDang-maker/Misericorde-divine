import { pool } from "../config/database.js"
import { revokeExpiredSessions } from "../services/auth.js"

try {
  const count = await revokeExpiredSessions()
  console.log(`Sessions expirées supprimées : ${count}`)
} finally {
  await pool.end()
}
