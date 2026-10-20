import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { likePattern, normalizeSearchTerm } from "../utils/pagination.js"
import { createAuditLog } from "./audit.js"

/** Une table et une famille de rubriques par type d'opération. */
export const CATEGORY_KINDS = {
  cotisations: { table: "contribution_categories", usedBy: "contributions", label: "cotisation" },
  recettes: { table: "revenue_categories", usedBy: "revenues", label: "recette" },
  dons: { table: "donation_categories", usedBy: "donations", label: "don", hasNature: true },
  depenses: { table: "expense_categories", usedBy: "expenses", label: "dépense" },
}

const optionalText = (max) =>
  z.string().trim().max(max).nullish().transform((v) => v || null)

export const categorySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,40}$/, "2 à 40 caractères : lettres, chiffres, - ou _")
    .optional(),
  libelle: z.string().trim().min(2, "Obligatoire").max(150),
  description: optionalText(255),
  nature: z.enum(["don", "offrande", "autre"]).optional(),
})
export const categoryUpdateSchema = categorySchema.partial()
export const activeStatusSchema = z.object({ actif: z.boolean() })

export function kindOf(kind) {
  const config = CATEGORY_KINDS[kind]
  if (!config) throw notFound("RUBRIQUE_TYPE_INCONNU", "Type de rubrique inconnu.")
  return config
}

const fromRow = (r) => ({
  id: r.id,
  code: r.code,
  libelle: r.libelle,
  description: r.description,
  ...(r.nature !== undefined ? { nature: r.nature } : {}),
  actif: Boolean(r.actif),
  utilisations: r.utilisations !== undefined ? Number(r.utilisations) : undefined,
  createdAt: r.created_at,
})

function slugCode(libelle) {
  return libelle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 34)
}

export async function listCategories(kind, filters = {}) {
  const { table, usedBy } = kindOf(kind)
  const where = []
  const params = []
  const term = normalizeSearchTerm(filters.q)
  if (term) {
    where.push("(c.code LIKE ? OR c.libelle LIKE ?)")
    params.push(likePattern(term), likePattern(term))
  }
  if (filters.actif !== undefined && filters.actif !== "") {
    where.push("c.actif = ?")
    params.push(filters.actif === true || filters.actif === "true" || filters.actif === "1" ? 1 : 0)
  }
  const list = await rows(
    null,
    `SELECT c.*, (SELECT COUNT(*) FROM ${usedBy} o WHERE o.category_id = c.id) AS utilisations
     FROM ${table} c ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.libelle ASC`,
    params,
  )
  return list.map(fromRow)
}

export async function getCategory(kind, id, executor = null) {
  const { table } = kindOf(kind)
  const row = await one(executor, `SELECT * FROM ${table} WHERE id = ?`, [id])
  if (!row) throw notFound("RUBRIQUE_NOT_FOUND", "La rubrique demandée est introuvable.")
  return fromRow(row)
}

export async function findCategoryByCode(kind, code, executor = null) {
  const { table } = kindOf(kind)
  return one(executor, `SELECT * FROM ${table} WHERE code = ?`, [code])
}

export async function createCategory(kind, data, ctx, executor = null) {
  const config = kindOf(kind)
  const work = async (conn) => {
    let code = data.code ?? slugCode(data.libelle)
    if (code.length < 2) throw unprocessable("CODE_INVALIDE", "Impossible de générer un code.", { code: "Invalide" })
    if (!data.code) {
      let suffix = 1
      const base = code
      while (await findCategoryByCode(kind, code, conn)) code = `${base.slice(0, 36)}-${++suffix}`
    } else if (await findCategoryByCode(kind, code, conn)) {
      throw conflict("RUBRIQUE_DOUBLON", "Ce code de rubrique existe déjà.", { code: "Déjà utilisé" })
    }
    const result = config.hasNature
      ? await run(conn, `INSERT INTO ${config.table} (code, libelle, description, nature) VALUES (?, ?, ?, ?)`, [
          code,
          data.libelle,
          data.description,
          data.nature ?? "don",
        ])
      : await run(conn, `INSERT INTO ${config.table} (code, libelle, description) VALUES (?, ?, ?)`, [
          code,
          data.libelle,
          data.description,
        ])
    const created = await getCategory(kind, result.insertId, conn)
    await createAuditLog(conn, { ctx, action: "CREATE", entityType: `category:${kind}`, entityId: created.id, after: created })
    return created
  }
  return executor ? work(executor) : withTransaction(work)
}

export async function updateCategory(kind, id, patch, ctx, executor = null) {
  const config = kindOf(kind)
  const work = async (conn) => {
    const row = await one(conn, `SELECT * FROM ${config.table} WHERE id = ? FOR UPDATE`, [id])
    if (!row) throw notFound("RUBRIQUE_NOT_FOUND", "La rubrique demandée est introuvable.")
    const before = fromRow(row)
    const next = { ...before, ...patch }
    if (patch.code && patch.code !== before.code) {
      const used = await one(conn, `SELECT COUNT(*) AS n FROM ${config.usedBy} WHERE category_id = ?`, [id])
      if (Number(used.n) > 0) {
        throw conflict("RUBRIQUE_UTILISEE", "Le code d'une rubrique déjà utilisée ne peut plus être modifié.", {
          code: "Rubrique utilisée",
        })
      }
      if (await findCategoryByCode(kind, patch.code, conn)) {
        throw conflict("RUBRIQUE_DOUBLON", "Ce code de rubrique existe déjà.", { code: "Déjà utilisé" })
      }
    }
    if (config.hasNature) {
      await run(conn, `UPDATE ${config.table} SET code=?, libelle=?, description=?, nature=? WHERE id=?`, [
        next.code,
        next.libelle,
        next.description,
        next.nature ?? "don",
        id,
      ])
    } else {
      await run(conn, `UPDATE ${config.table} SET code=?, libelle=?, description=? WHERE id=?`, [
        next.code,
        next.libelle,
        next.description,
        id,
      ])
    }
    const after = await getCategory(kind, id, conn)
    await createAuditLog(conn, { ctx, action: "UPDATE", entityType: `category:${kind}`, entityId: id, before, after })
    return after
  }
  return executor ? work(executor) : withTransaction(work)
}

/** Désactiver (jamais supprimer) : une rubrique historique doit rester lisible. */
export async function setCategoryActive(kind, id, actif, ctx, executor = null) {
  const config = kindOf(kind)
  const work = async (conn) => {
    const row = await one(conn, `SELECT * FROM ${config.table} WHERE id = ? FOR UPDATE`, [id])
    if (!row) throw notFound("RUBRIQUE_NOT_FOUND", "La rubrique demandée est introuvable.")
    await run(conn, `UPDATE ${config.table} SET actif = ? WHERE id = ?`, [actif ? 1 : 0, id])
    await createAuditLog(conn, {
      ctx,
      action: actif ? "ENABLE" : "DISABLE",
      entityType: `category:${kind}`,
      entityId: id,
      before: { actif: Boolean(row.actif) },
      after: { actif },
    })
    return getCategory(kind, id, conn)
  }
  return executor ? work(executor) : withTransaction(work)
}

export const disableCategory = (kind, id, ctx) => setCategoryActive(kind, id, false, ctx)

/** Une rubrique est utilisable pour une nouvelle opération si elle existe et est active. */
export async function isCategoryUsable(kind, id, executor = null) {
  const { table } = kindOf(kind)
  const row = await one(executor, `SELECT actif FROM ${table} WHERE id = ?`, [id])
  return Boolean(row?.actif)
}
