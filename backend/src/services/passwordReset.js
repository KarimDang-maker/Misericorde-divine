import bcrypt from "bcryptjs"
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto"
import { z } from "zod"
import { env } from "../config/environment.js"
import { one, run, withTransaction } from "../config/database.js"
import { unprocessable } from "../utils/errors.js"
import { createAuditLog } from "./audit.js"
import { enqueueNotification, enqueuePasswordChangedNotification } from "./notifications.js"

const hash = (value) => createHash("sha256").update(value).digest("hex")
export const passwordResetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(190) })
export const passwordResetConfirmSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  nouveauMotDePasse: z.string().min(8).max(200),
})

function encryptToken(token) {
  const key = Buffer.from(env.passwordResetEncryptionKey, "base64")
  if (key.length !== 32) throw new Error("PASSWORD_RESET_ENCRYPTION_KEY_INVALID")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(token), cipher.final()])
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`
}

async function bumpRateLimit(conn, key) {
  const keyHash = hash(key)
  await run(conn,
    `INSERT INTO password_reset_rate_limits (key_hash,window_started_at,request_count)
     VALUES (?,UTC_TIMESTAMP(),1)
     ON DUPLICATE KEY UPDATE
       request_count=IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),1,request_count+1),
       window_started_at=IF(window_started_at < DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),UTC_TIMESTAMP(),window_started_at)`,
    [keyHash],
  )
  const row = await one(conn, "SELECT request_count FROM password_reset_rate_limits WHERE key_hash=?", [keyHash])
  return Number(row.request_count) <= 5
}

/** Retour toujours neutre : présence, activité et adresse du compte ne sont jamais révélées. */
export async function requestPasswordReset(rawEmail, ctx = {}) {
  const email = rawEmail.trim().toLowerCase()
  // Sans chiffrement configuré, ne distingue pas les comptes mais n'émet pas de jeton inexploitable.
  if (Buffer.from(env.passwordResetEncryptionKey, "base64").length !== 32 || !env.frontendUrl) return { accepted: true }
  const ipKey = `ip:${ctx.ip || "unknown"}`
  const emailKey = `email:${email}:${ctx.ip || "unknown"}`
  return withTransaction(async (conn) => {
    const ipAllowed = await bumpRateLimit(conn, ipKey)
    const emailAllowed = await bumpRateLimit(conn, emailKey)
    if (!ipAllowed || !emailAllowed) return { accepted: true }
    const user = await one(conn, "SELECT id,email,nom,actif FROM users WHERE email=? FOR UPDATE", [email])
    if (!user || !user.actif) return { accepted: true }
    const token = randomBytes(32).toString("hex")
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
    await run(conn, "UPDATE password_reset_tokens SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL", [user.id])
    await run(conn,
      "INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES (?,?,?)",
      [user.id, hash(token), expiresAt.toISOString().slice(0, 19).replace("T", " ")],
    )
    await enqueueNotification(conn, {
      eventType: "PASSWORD_RESET", aggregateType: "user", aggregateId: user.id,
      recipient: user.email,
      payload: { userName: user.nom || "", encryptedToken: encryptToken(token), expiresAt: expiresAt.toISOString() },
      dedupeKey: `password-reset:${user.id}:${randomUUID()}`,
    })
    await createAuditLog(conn, { ctx, action: "REQUEST_PASSWORD_RESET", entityType: "user", entityId: user.id })
    return { accepted: true }
  })
}

export async function confirmPasswordReset(input, ctx = {}) {
  const data = passwordResetConfirmSchema.parse(input)
  return withTransaction(async (conn) => {
    const tokenHash = hash(data.token)
    const reset = await one(conn,
      `SELECT t.id,t.user_id,t.expires_at,t.consumed_at,(t.expires_at > UTC_TIMESTAMP()) AS token_valid,u.email,u.nom,u.actif,u.password_hash
       FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? FOR UPDATE`,
      [tokenHash],
    )
    if (!reset || reset.consumed_at || !Number(reset.token_valid) || !reset.actif) {
      throw unprocessable("JETON_REINITIALISATION_INVALIDE", "Le lien de réinitialisation est invalide ou expiré.")
    }
    const passwordHash = await bcrypt.hash(data.nouveauMotDePasse, 12)
    await run(conn, "UPDATE users SET password_hash=? WHERE id=?", [passwordHash, reset.user_id])
    await run(conn, "UPDATE password_reset_tokens SET consumed_at=UTC_TIMESTAMP() WHERE id=?", [reset.id])
    await run(conn, "DELETE FROM sessions WHERE user_id=?", [reset.user_id])
    const user = { id: reset.user_id, email: reset.email, nom: reset.nom }
    await enqueuePasswordChangedNotification(conn, user)
    await createAuditLog(conn, { ctx, action: "RESET_PASSWORD", entityType: "user", entityId: reset.user_id })
    return { updated: true }
  })
}
