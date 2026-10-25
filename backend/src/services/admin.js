import bcrypt from "bcryptjs"
import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { createAuditLog } from "./audit.js"
import { likePattern, normalizeSearchTerm, paginationMeta } from "../utils/pagination.js"

const emailSchema = z.string().trim().toLowerCase().email().max(190)
export const createAdminUserSchema = z.object({
  email: emailSchema,
  nom: z.string().trim().min(2).max(120),
  motDePasse: z.string().min(12).max(200),
  role: z.enum(["admin", "gestionnaire"]).default("gestionnaire"),
})
export const updateAdminUserSchema = z.object({
  email: emailSchema.optional(),
  nom: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["admin", "gestionnaire"]).optional(),
}).refine((data) => Object.keys(data).length > 0, "Au moins un champ doit être fourni.")

const userDto = (user) => ({
  id: Number(user.id), email: user.email, nom: user.nom, role: user.role,
  actif: Boolean(user.actif), createdAt: user.created_at,
})

export async function listUsers({ q, page, limit, offset }) {
  const term = normalizeSearchTerm(q)
  const where = term ? "WHERE email LIKE ? OR nom LIKE ?" : ""
  const search = term ? [likePattern(term), likePattern(term)] : []
  const total = await one(null, `SELECT COUNT(*) total FROM users ${where}`, search)
  const users = await rows(null,
    `SELECT id,email,nom,role,actif,created_at FROM users ${where} ORDER BY nom,email LIMIT ${limit} OFFSET ${offset}`,
    search,
  )
  return { items: users.map(userDto), meta: paginationMeta({ page, limit }, Number(total.total)) }
}

export async function getUserById(id) {
  const user = await one(null, "SELECT id,email,nom,role,actif,created_at FROM users WHERE id=?", [id])
  if (!user) throw notFound("UTILISATEUR_INTROUVABLE", "Utilisateur introuvable.")
  return userDto(user)
}

export async function createUser(data, ctx) {
  const input = createAdminUserSchema.parse(data)
  return withTransaction(async (conn) => {
    if (await one(conn, "SELECT id FROM users WHERE email=? FOR UPDATE", [input.email])) {
      throw conflict("EMAIL_DEJA_UTILISE", "Cette adresse e-mail est déjà utilisée.", { email: "Déjà utilisé" })
    }
    const hash = await bcrypt.hash(input.motDePasse, 12)
    const result = await run(conn,
      "INSERT INTO users (email,nom,role,password_hash) VALUES (?,?,?,?)",
      [input.email, input.nom, input.role, hash],
    )
    const created = await one(conn, "SELECT id,email,nom,role,actif,created_at FROM users WHERE id=?", [result.insertId])
    await createAuditLog(conn, { ctx, action: "CREATE", entityType: "user", entityId: result.insertId, after: created })
    return userDto(created)
  })
}

export async function updateUser(id, patch, ctx) {
  const input = updateAdminUserSchema.parse(patch)
  return withTransaction(async (conn) => {
    const before = await one(conn, "SELECT id,email,nom,role,actif,created_at FROM users WHERE id=? FOR UPDATE", [id])
    if (!before) throw notFound("UTILISATEUR_INTROUVABLE", "Utilisateur introuvable.")
    if (input.role === "gestionnaire" && before.role === "admin" && before.actif) {
      const admins = await rows(conn, "SELECT id FROM users WHERE role='admin' AND actif=1 ORDER BY id FOR UPDATE")
      if (admins.length <= 1) throw unprocessable("DERNIER_ADMIN", "Le dernier administrateur actif ne peut pas être rétrogradé.")
    }
    if (input.email && input.email !== before.email && await one(conn, "SELECT id FROM users WHERE email=? AND id<>?", [input.email, id])) {
      throw conflict("EMAIL_DEJA_UTILISE", "Cette adresse e-mail est déjà utilisée.", { email: "Déjà utilisé" })
    }
    const after = { ...before, ...input }
    await run(conn, "UPDATE users SET email=?,nom=?,role=? WHERE id=?", [after.email, after.nom, after.role, id])
    const updated = await one(conn, "SELECT id,email,nom,role,actif,created_at FROM users WHERE id=?", [id])
    await createAuditLog(conn, { ctx, action: "UPDATE", entityType: "user", entityId: id, before, after: updated })
    return userDto(updated)
  })
}

export async function setUserActive(id, actif, ctx) {
  return withTransaction(async (conn) => {
    const before = await one(conn, "SELECT id,email,nom,role,actif,created_at FROM users WHERE id=? FOR UPDATE", [id])
    if (!before) throw notFound("UTILISATEUR_INTROUVABLE", "Utilisateur introuvable.")
    if (!actif && before.role === "admin" && before.actif) {
      const admins = await rows(conn, "SELECT id FROM users WHERE role='admin' AND actif=1 ORDER BY id FOR UPDATE")
      if (admins.length <= 1) throw unprocessable("DERNIER_ADMIN", "Le dernier administrateur actif ne peut pas être désactivé.")
    }
    await run(conn, "UPDATE users SET actif=? WHERE id=?", [actif ? 1 : 0, id])
    if (!actif) await run(conn, "DELETE FROM sessions WHERE user_id=?", [id])
    const after = await one(conn, "SELECT id,email,nom,role,actif,created_at FROM users WHERE id=?", [id])
    await createAuditLog(conn, { ctx, action: actif ? "ACTIVATE" : "DEACTIVATE", entityType: "user", entityId: id, before, after })
    return userDto(after)
  })
}
