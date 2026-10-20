import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { dateRangeClause, normalizeDateRange } from "../utils/dates.js"
import { likePattern, normalizeSearchTerm, paginationMeta, parseSort } from "../utils/pagination.js"
import { nextReference } from "../utils/references.js"
import { money } from "../utils/money.js"
import { createAuditLog } from "./audit.js"

const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null)
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format AAAA-MM-JJ")
  .nullish()
  .transform((v) => v || null)

export const MEMBER_STATUSES = ["actif", "inactif", "archive"]

// Champs obligatoires retenus : nom et prénom. Unicité : e-mail et téléphone lorsqu'ils sont renseignés.
const memberBase = z.object({
  nom: z.string().trim().min(1, "Obligatoire").max(120),
  prenom: z.string().trim().min(1, "Obligatoire").max(120),
  sexe: z.enum(["M", "F"]).nullish().transform((v) => v || null),
  telephone: text(30),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(190)
    .email("E-mail invalide")
    .nullish()
    .or(z.literal(""))
    .transform((v) => v || null),
  adresse: text(255),
  dateNaissance: isoDate,
  dateAdhesion: isoDate,
  statut: z.enum(MEMBER_STATUSES),
  notes: text(2000),
})
export const memberSchema = memberBase.extend({ statut: z.enum(MEMBER_STATUSES).default("actif") })
export const memberUpdateSchema = memberBase.partial()
export const memberStatusSchema = z.object({ statut: z.enum(MEMBER_STATUSES) })

export const memberFromRow = (r) => ({
  id: r.id,
  reference: r.reference,
  nom: r.nom,
  prenom: r.prenom,
  nomComplet: `${r.prenom} ${r.nom}`.trim(),
  sexe: r.sexe,
  telephone: r.telephone,
  email: r.email,
  adresse: r.adresse,
  dateNaissance: r.date_naissance,
  dateAdhesion: r.date_adhesion,
  statut: r.statut,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const SORTS = {
  reference: "m.reference",
  nom: "m.nom",
  prenom: "m.prenom",
  dateAdhesion: "m.date_adhesion",
  statut: "m.statut",
  createdAt: "m.created_at",
}

function buildFilters(filters) {
  const where = []
  const params = []
  const term = normalizeSearchTerm(filters.q)
  if (term) {
    const like = likePattern(term)
    where.push(
      "(m.reference LIKE ? OR m.nom LIKE ? OR m.prenom LIKE ? OR CONCAT(m.prenom,' ',m.nom) LIKE ? OR m.email LIKE ? OR m.telephone LIKE ?)",
    )
    params.push(like, like, like, like, like, like)
  }
  if (filters.statut) {
    if (!MEMBER_STATUSES.includes(filters.statut)) {
      throw unprocessable("STATUT_INVALIDE", "Statut de membre invalide.", { statut: "Valeur inconnue" })
    }
    where.push("m.statut = ?")
    params.push(filters.statut)
  } else if (!filters.inclureArchives || filters.inclureArchives === "false") {
    where.push("m.statut <> 'archive'")
  }
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
}

export async function countMembers(filters = {}) {
  const { where, params } = buildFilters(filters)
  const row = await one(null, `SELECT COUNT(*) AS total FROM members m ${where}`, params)
  return Number(row.total)
}

export async function listMembers(filters, pagination, sortQuery) {
  const { where, params } = buildFilters(filters)
  const sort = parseSort(sortQuery, SORTS, { field: "nom", direction: "asc" })
  const total = await countMembers(filters)
  const list = await rows(
    null,
    `SELECT m.* FROM members m ${where} ORDER BY ${sort.column} ${sort.direction}, m.id ASC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  )
  return { items: list.map(memberFromRow), meta: paginationMeta(pagination, total) }
}

export async function listAllMembers(filters = {}) {
  const { where, params } = buildFilters(filters)
  const list = await rows(null, `SELECT m.* FROM members m ${where} ORDER BY m.reference ASC LIMIT 50000`, params)
  return list.map(memberFromRow)
}

export async function getMemberById(memberId, executor = null) {
  const row = await one(executor, "SELECT * FROM members WHERE id = ?", [memberId])
  if (!row) throw notFound("MEMBRE_NOT_FOUND", "Le membre demandé est introuvable.")
  return memberFromRow(row)
}

async function assertUnique(executor, data, excludeId = null) {
  const fields = {}
  if (data.email) {
    const found = await one(executor, "SELECT id FROM members WHERE email = ? AND id <> ?", [data.email, excludeId ?? 0])
    if (found) fields.email = "Déjà utilisé par un autre membre"
  }
  if (data.telephone) {
    const found = await one(executor, "SELECT id FROM members WHERE telephone = ? AND id <> ?", [
      data.telephone,
      excludeId ?? 0,
    ])
    if (found) fields.telephone = "Déjà utilisé par un autre membre"
  }
  if (Object.keys(fields).length) {
    throw conflict("MEMBRE_DOUBLON", "Un membre avec les mêmes coordonnées existe déjà.", fields)
  }
}

export async function createMember(data, ctx, executor = null) {
  const work = async (conn) => {
    await assertUnique(conn, data)
    const reference = await nextReference(conn, "MB", "", { withYear: false })
    const result = await run(
      conn,
      `INSERT INTO members (reference, nom, prenom, sexe, telephone, email, adresse, date_naissance, date_adhesion, statut, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference,
        data.nom,
        data.prenom,
        data.sexe,
        data.telephone,
        data.email,
        data.adresse,
        data.dateNaissance,
        data.dateAdhesion,
        data.statut,
        data.notes,
        ctx?.user?.id ?? null,
      ],
    )
    const member = await getMemberById(result.insertId, conn)
    await createAuditLog(conn, { ctx, action: "CREATE", entityType: "member", entityId: member.id, after: member })
    return member
  }
  return executor ? work(executor) : withTransaction(work)
}

export async function updateMember(memberId, patch, ctx, executor = null) {
  const work = async (conn) => {
    const current = await one(conn, "SELECT * FROM members WHERE id = ? FOR UPDATE", [memberId])
    if (!current) throw notFound("MEMBRE_NOT_FOUND", "Le membre demandé est introuvable.")
    const before = memberFromRow(current)
    const merged = { ...before, ...patch }
    // Une valeur vide explicite efface le champ ; l'absence de clé le conserve.
    await assertUnique(conn, merged, memberId)
    await run(
      conn,
      `UPDATE members SET nom=?, prenom=?, sexe=?, telephone=?, email=?, adresse=?, date_naissance=?, date_adhesion=?, statut=?, notes=? WHERE id=?`,
      [
        merged.nom,
        merged.prenom,
        merged.sexe,
        merged.telephone,
        merged.email,
        merged.adresse,
        merged.dateNaissance,
        merged.dateAdhesion,
        merged.statut,
        merged.notes,
        memberId,
      ],
    )
    const after = await getMemberById(memberId, conn)
    await createAuditLog(conn, { ctx, action: "UPDATE", entityType: "member", entityId: memberId, before, after })
    return after
  }
  return executor ? work(executor) : withTransaction(work)
}

/** Archiver (jamais de suppression physique) : statut `archive` ; `actif`/`inactif` pour réactiver. */
export async function setMemberStatus(memberId, statut, ctx) {
  return withTransaction(async (conn) => {
    const current = await one(conn, "SELECT * FROM members WHERE id = ? FOR UPDATE", [memberId])
    if (!current) throw notFound("MEMBRE_NOT_FOUND", "Le membre demandé est introuvable.")
    await run(conn, "UPDATE members SET statut = ? WHERE id = ?", [statut, memberId])
    const after = await getMemberById(memberId, conn)
    await createAuditLog(conn, {
      ctx,
      action: statut === "archive" ? "ARCHIVE" : "STATUS",
      entityType: "member",
      entityId: memberId,
      before: { statut: current.statut },
      after: { statut },
    })
    return after
  })
}

export const archiveMember = (memberId, ctx) => setMemberStatus(memberId, "archive", ctx)

/** Opérations (cotisations, recettes, dons) rattachées au membre, du plus récent au plus ancien. */
export async function getMemberOperations(memberId, filters, pagination) {
  await getMemberById(memberId)
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const clauses = []
  const params = []
  dateRangeClause("u.date_operation", range, clauses, params)
  const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
  const union = `
    SELECT 'cotisation' AS type, c.id, c.reference, c.date_operation, c.montant, c.statut, c.libelle, c.member_id FROM contributions c
    UNION ALL SELECT 'recette', r.id, r.reference, r.date_operation, r.montant, r.statut, r.libelle, r.member_id FROM revenues r
    UNION ALL SELECT 'don', d.id, d.reference, d.date_operation, d.montant, d.statut, d.libelle, d.member_id FROM donations d`
  const total = await one(null, `SELECT COUNT(*) AS total FROM (${union}) u WHERE u.member_id = ? ${extra}`, [
    memberId,
    ...params,
  ])
  const list = await rows(
    null,
    `SELECT * FROM (${union}) u WHERE u.member_id = ? ${extra}
     ORDER BY u.date_operation DESC, u.id DESC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    [memberId, ...params],
  )
  return {
    items: list.map((r) => ({
      type: r.type,
      id: r.id,
      reference: r.reference,
      dateOperation: r.date_operation,
      montant: money(r.montant),
      statut: r.statut,
      libelle: r.libelle,
    })),
    meta: paginationMeta(pagination, Number(total.total)),
  }
}

export async function getMemberFinancialSummary(memberId, filters = {}) {
  const member = await getMemberById(memberId)
  const range = normalizeDateRange(filters.dateDebut, filters.dateFin)
  const clauses = []
  const params = []
  dateRangeClause("date_operation", range, clauses, params)
  const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : ""
  const sum = async (table) => {
    const row = await one(
      null,
      `SELECT COALESCE(SUM(montant),0) AS total, COUNT(*) AS nombre, MAX(date_operation) AS derniere
       FROM ${table} WHERE member_id = ? AND statut = 'valide' ${extra}`,
      [memberId, ...params],
    )
    return { total: money(row.total), nombre: Number(row.nombre), derniereDate: row.derniere }
  }
  const [cotisations, recettes, dons] = await Promise.all([
    sum("contributions"),
    sum("revenues"),
    sum("donations"),
  ])
  return {
    membre: member,
    periode: range,
    cotisations,
    recettes,
    dons,
    totalGeneral: Math.round((cotisations.total + recettes.total + dons.total) * 100) / 100,
  }
}
