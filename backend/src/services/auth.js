import bcrypt from "bcryptjs"
import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import { env } from "../config/environment.js"
import { one, run, withTransaction } from "../config/database.js"
import { unauthorized, unprocessable, forbidden } from "../utils/errors.js"
import { createAuditLog } from "./audit.js"

const hashToken = (token) => createHash("sha256").update(token).digest("hex")

// Hash factice pour que la durée de réponse ne révèle pas l'existence d'un compte.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10)

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(190),
  motDePasse: z.string().min(1).max(200),
})

export const passwordSchema = z
  .object({
    ancienMotDePasse: z.string().min(1).max(200),
    nouveauMotDePasse: z.string().min(8, "8 caractères minimum").max(200),
  })
  .refine((v) => v.ancienMotDePasse !== v.nouveauMotDePasse, {
    message: "Le nouveau mot de passe doit être différent de l'ancien.",
    path: ["nouveauMotDePasse"],
  })

export const publicUser = (user) => ({ id: user.id, email: user.email, nom: user.nom })

export async function login({ email, motDePasse }, meta = {}) {
  const user = await one(null, "SELECT * FROM users WHERE email = ?", [email])
  const valid = await bcrypt.compare(motDePasse, user?.password_hash ?? DUMMY_HASH)
  if (!user || !valid) throw unauthorized("Identifiants invalides.")
  if (!user.actif) throw forbidden("Ce compte est désactivé.")

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + env.session.durationHours * 3600 * 1000)
  await run(null, "INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)", [
    hashToken(token),
    user.id,
    expiresAt.toISOString().slice(0, 19).replace("T", " "),
    meta.ip ?? null,
    (meta.userAgent ?? "").slice(0, 255) || null,
  ])
  await createAuditLog(null, { ctx: { user, ...meta }, action: "LOGIN", entityType: "user", entityId: user.id })
  return { token, expiresAt, user: publicUser(user) }
}

export async function logout(token) {
  if (!token) return
  await run(null, "DELETE FROM sessions WHERE id = ?", [hashToken(token)])
}

/** Retourne l'utilisateur de la session valide, sinon null. */
export async function getCurrentUser(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const row = await one(
    null,
    `SELECT u.id, u.email, u.nom, u.actif FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > UTC_TIMESTAMP()`,
    [hashToken(token)],
  )
  return row ?? null
}

export async function changePassword(userId, { ancienMotDePasse, nouveauMotDePasse }, ctx, currentToken) {
  return withTransaction(async (conn) => {
    const user = await one(conn, "SELECT * FROM users WHERE id = ? FOR UPDATE", [userId])
    if (!user || !(await bcrypt.compare(ancienMotDePasse, user.password_hash))) {
      throw unprocessable("ANCIEN_MOT_DE_PASSE_INCORRECT", "L'ancien mot de passe est incorrect.", {
        ancienMotDePasse: "Incorrect",
      })
    }
    const hash = await bcrypt.hash(nouveauMotDePasse, 12)
    await run(conn, "UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId])
    // Révoque toutes les autres sessions de l'utilisateur.
    await run(conn, "DELETE FROM sessions WHERE user_id = ? AND id <> ?", [
      userId,
      currentToken ? hashToken(currentToken) : "",
    ])
    await createAuditLog(conn, { ctx, action: "CHANGE_PASSWORD", entityType: "user", entityId: userId })
    return { updated: true }
  })
}

export async function revokeExpiredSessions() {
  const result = await run(null, "DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()")
  return result.affectedRows
}

export async function createUser({ email, nom, password }) {
  const hash = await bcrypt.hash(password, 12)
  const result = await run(null, "INSERT INTO users (email, nom, password_hash) VALUES (?, ?, ?)", [
    email.toLowerCase(),
    nom,
    hash,
  ])
  return result.insertId
}
