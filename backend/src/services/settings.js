import { z } from "zod"
import { env } from "../config/environment.js"
import { one, run, withTransaction } from "../config/database.js"
import { createAuditLog } from "./audit.js"

export const ASSIETTES = ["cotisations", "cotisations_dons", "recettes_totales"]

const DEFAULT_GENERAL = {
  nomOrganisation: "Miséricorde Divine",
  devise: "F CFA",
  dioceseTaux: null,
  dioceseAssiette: null,
}

export const generalSettingsSchema = z.object({
  nomOrganisation: z.string().trim().min(2).max(150).optional(),
  devise: z.string().trim().min(1).max(10).optional(),
  // Taux en pourcentage (0 à 100, 4 décimales). null = règle non configurée.
  dioceseTaux: z.number().min(0).max(100).nullable().optional(),
  dioceseAssiette: z.enum(ASSIETTES).nullable().optional(),
})

export const preferencesSchema = z.object({
  theme: z.enum(["clair", "sombre"]).optional(),
  langue: z.enum(["fr"]).optional(),
  lignesParPage: z.number().int().min(10).max(100).optional(),
  masquerMontants: z.boolean().optional(),
})

const DEFAULT_PREFERENCES = { theme: "clair", langue: "fr", lignesParPage: 25, masquerMontants: false }

const parse = (value) => (typeof value === "string" ? JSON.parse(value) : value)

export async function getGeneralSettings(executor = null) {
  const row = await one(executor, "SELECT valeur FROM settings WHERE cle = 'general'")
  return { ...DEFAULT_GENERAL, ...(row ? parse(row.valeur) : {}) }
}

export async function updateGeneralSettings(patch, ctx) {
  return withTransaction(async (conn) => {
    const before = await getGeneralSettings(conn)
    const after = { ...before, ...patch }
    await run(
      conn,
      "INSERT INTO settings (cle, valeur) VALUES ('general', ?) ON DUPLICATE KEY UPDATE valeur = VALUES(valeur)",
      [JSON.stringify(after)],
    )
    await createAuditLog(conn, { ctx, action: "UPDATE", entityType: "settings", entityId: "general", before, after })
    return after
  })
}

export async function getDisplayPreferences(userId) {
  const row = await one(null, "SELECT preferences FROM user_preferences WHERE user_id = ?", [userId])
  return { ...DEFAULT_PREFERENCES, ...(row ? parse(row.preferences) : {}) }
}

export async function updateDisplayPreferences(userId, patch) {
  const next = { ...(await getDisplayPreferences(userId)), ...patch }
  await run(
    null,
    "INSERT INTO user_preferences (user_id, preferences) VALUES (?, ?) ON DUPLICATE KEY UPDATE preferences = VALUES(preferences)",
    [userId, JSON.stringify(next)],
  )
  return next
}

export function getSessionSecuritySettings() {
  return {
    dureeSessionHeures: env.session.durationHours,
    cookieHttpOnly: true,
    cookieSecure: env.session.secureCookie,
    cookieSameSite: env.session.sameSite,
    limiteTentativesConnexion: "10 échecs / 15 minutes",
  }
}
