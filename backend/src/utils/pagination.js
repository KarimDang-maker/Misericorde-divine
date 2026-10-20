import { unprocessable } from "./errors.js"

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 25

export function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT))
  return { page, limit, offset: (page - 1) * limit }
}

export function paginationMeta({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
}

/** allowed : { champApi: "colonne SQL" }. Les noms de colonne ne viennent jamais du client. */
export function parseSort(query = {}, allowed, fallback) {
  const field = query.sort || fallback.field
  const column = allowed[field]
  if (!column) {
    throw unprocessable("TRI_INVALIDE", `Tri non autorisé : « ${field} ».`, { sort: "Champ non autorisé" })
  }
  const rawDirection = String(query.order || fallback.direction).toLowerCase()
  if (!["asc", "desc"].includes(rawDirection)) {
    throw unprocessable("TRI_INVALIDE", "Direction de tri invalide.", { order: "asc ou desc" })
  }
  return { column, direction: rawDirection === "asc" ? "ASC" : "DESC", field }
}

export function normalizeSearchTerm(value) {
  if (value === undefined || value === null) return null
  const cleaned = String(value).replace(/\s+/g, " ").trim().slice(0, 100)
  return cleaned || null
}

/** Échappe % et _ afin que le terme soit cherché littéralement dans un LIKE. */
export function likePattern(term) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
