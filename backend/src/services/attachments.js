import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import { env } from "../config/environment.js"
import { one, rows, run, withTransaction } from "../config/database.js"
import { AppError, notFound, unprocessable } from "../utils/errors.js"
import { likePattern, normalizeSearchTerm, paginationMeta } from "../utils/pagination.js"
import { createAuditLog } from "./audit.js"
import { getAttachmentStorage } from "../storage/index.js"

/** Types d'opération rattachables (segment d'URL → type + table). */
export const ATTACHABLE = {
  cotisations: { type: "contribution", table: "contributions" },
  recettes: { type: "revenue", table: "revenues" },
  dons: { type: "donation", table: "donations" },
  depenses: { type: "expense", table: "expenses" },
  "contribution-diocesaine": { type: "diocesan", table: "diocesan_contributions" },
}
const TYPE_TO_TABLE = Object.fromEntries(Object.values(ATTACHABLE).map((v) => [v.type, v.table]))

const ALLOWED = {
  "application/pdf": { ext: ".pdf", magic: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  "image/png": { ext: ".png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { ext: ".jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": {
    ext: ".webp",
    magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
}

const fromRow = (r) => ({
  id: r.id,
  nom: r.nom_original,
  mimeType: r.mime_type,
  taille: r.taille,
  description: r.description,
  createdAt: r.created_at,
  ...(r.operations ? { operations: r.operations } : {}),
})

async function assertOperationExists(conn, operationType, operationId) {
  const table = TYPE_TO_TABLE[operationType]
  if (!table) throw unprocessable("OPERATION_TYPE_INCONNU", "Type d'opération inconnu.", { operationType: "Inconnu" })
  const found = await one(conn, `SELECT id FROM ${table} WHERE id = ?`, [operationId])
  if (!found) throw notFound("OPERATION_NOT_FOUND", "L'opération à lier est introuvable.")
}

export async function linkAttachmentToOperation(attachmentId, operationType, operationId, ctx, executor = null) {
  const work = async (conn) => {
    const attachment = await one(conn, "SELECT id FROM attachments WHERE id = ?", [attachmentId])
    if (!attachment) throw notFound("JUSTIFICATIF_NOT_FOUND", "Le justificatif est introuvable.")
    await assertOperationExists(conn, operationType, operationId)
    await run(conn, "INSERT IGNORE INTO operation_attachments (attachment_id, operation_type, operation_id) VALUES (?, ?, ?)", [
      attachmentId,
      operationType,
      operationId,
    ])
    await createAuditLog(conn, {
      ctx,
      action: "LINK",
      entityType: "attachment",
      entityId: attachmentId,
      after: { operationType, operationId },
    })
    return { attachmentId, operationType, operationId }
  }
  return executor ? work(executor) : withTransaction(work)
}

export async function uploadAttachment(file, metadata, ctx) {
  if (!file) throw unprocessable("FICHIER_REQUIS", "Aucun fichier reçu.", { fichier: "Obligatoire" })
  const rule = ALLOWED[file.mimetype]
  if (!rule) {
    throw new AppError(415, "TYPE_FICHIER_REFUSE", "Format refusé (PDF, PNG, JPEG ou WebP uniquement).")
  }
  if (!rule.magic(file.buffer)) {
    throw new AppError(415, "CONTENU_FICHIER_INVALIDE", "Le contenu du fichier ne correspond pas à son type.")
  }
  if (file.size > env.upload.maxBytes) {
    throw new AppError(413, "FICHIER_TROP_VOLUMINEUX", "Le fichier dépasse la taille maximale autorisée.")
  }
  const storageKey = `${randomBytes(24).toString("hex")}${rule.ext}`
  const sha256 = createHash("sha256").update(file.buffer).digest("hex")
  const storageProvider = env.upload.storageProvider
  const storage = await getAttachmentStorage(storageProvider)
  try {
    await storage.put(storageKey, file.buffer, file.mimetype)
  } catch {
    throw new AppError(503, "STOCKAGE_INDISPONIBLE", "Le fichier n’a pas pu être enregistré dans le stockage.")
  }
  try {
    return await withTransaction(async (conn) => {
      const originalName = path.basename(file.originalname || "justificatif").replace(/[\r\n"]/g, "_").slice(0, 255)
      const inserted = await run(
        conn,
        `INSERT INTO attachments (storage_key, storage_provider, nom_original, mime_type, taille, sha256, description, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [storageKey, storageProvider, originalName, file.mimetype, file.size, sha256, metadata.description || null, ctx?.user?.id ?? null],
      )
      if (metadata.operationType && metadata.operationId) {
        await linkAttachmentToOperation(inserted.insertId, metadata.operationType, Number(metadata.operationId), ctx, conn)
      }
      const created = await getAttachmentById(inserted.insertId, conn)
      await createAuditLog(conn, { ctx, action: "UPLOAD", entityType: "attachment", entityId: created.id, after: created })
      return created
    })
  } catch (error) {
    await storage.delete(storageKey).catch(() => {})
    throw error
  }
}

export async function getAttachmentById(id, executor = null) {
  const row = await one(executor, "SELECT * FROM attachments WHERE id = ?", [id])
  if (!row) throw notFound("JUSTIFICATIF_NOT_FOUND", "Le justificatif est introuvable.")
  const links = await rows(executor, "SELECT operation_type, operation_id FROM operation_attachments WHERE attachment_id = ?", [id])
  return fromRow({ ...row, operations: links.map((l) => ({ type: l.operation_type, id: l.operation_id })) })
}

export async function listAttachments(filters, pagination) {
  const where = []
  const params = []
  const term = normalizeSearchTerm(filters.q)
  if (term) {
    where.push("(a.nom_original LIKE ? OR a.description LIKE ?)")
    params.push(likePattern(term), likePattern(term))
  }
  if (filters.operationType) {
    where.push("EXISTS (SELECT 1 FROM operation_attachments oa WHERE oa.attachment_id = a.id AND oa.operation_type = ?)")
    params.push(String(filters.operationType))
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const total = await one(null, `SELECT COUNT(*) AS total FROM attachments a ${clause}`, params)
  const list = await rows(
    null,
    `SELECT a.* FROM attachments a ${clause} ORDER BY a.created_at DESC, a.id DESC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  )
  const items = []
  for (const row of list) {
    const links = await rows(null, "SELECT operation_type, operation_id FROM operation_attachments WHERE attachment_id = ?", [row.id])
    items.push(fromRow({ ...row, operations: links.map((l) => ({ type: l.operation_type, id: l.operation_id })) }))
  }
  return { items, meta: paginationMeta(pagination, Number(total.total)) }
}

export async function listOperationAttachments(operationType, operationId) {
  await assertOperationExists(null, operationType, operationId)
  const list = await rows(
    null,
    `SELECT a.* FROM operation_attachments oa JOIN attachments a ON a.id = oa.attachment_id
     WHERE oa.operation_type = ? AND oa.operation_id = ? ORDER BY a.id`,
    [operationType, operationId],
  )
  return list.map(fromRow)
}

/** Récupère les octets via le fournisseur privé après vérification des droits par la route. */
export async function downloadAttachment(id, ctx) {
  const row = await one(null, "SELECT * FROM attachments WHERE id = ?", [id])
  if (!row) throw notFound("JUSTIFICATIF_NOT_FOUND", "Le justificatif est introuvable.")
  const storage = await getAttachmentStorage(row.storage_provider || "local")
  let contents
  try {
    contents = await storage.get(row.storage_key)
  } catch {
    throw new AppError(503, "STOCKAGE_INDISPONIBLE", "Le fichier ne peut pas être récupéré depuis le stockage.")
  }
  if (!contents) throw notFound("FICHIER_INTROUVABLE", "Le fichier du justificatif est introuvable dans le stockage.")
  await createAuditLog(null, { ctx, action: "DOWNLOAD", entityType: "attachment", entityId: id })
  return { contents, nom: row.nom_original, mimeType: row.mime_type }
}

export async function deleteAttachment(id, ctx) {
  const row = await one(null, "SELECT * FROM attachments WHERE id = ?", [id])
  if (!row) throw notFound("JUSTIFICATIF_NOT_FOUND", "Le justificatif est introuvable.")
  const before = await getAttachmentById(id)
  const storage = await getAttachmentStorage(row.storage_provider || "local")
  let contents
  try {
    contents = await storage.get(row.storage_key)
    if (!contents) throw notFound("FICHIER_INTROUVABLE", "Le fichier du justificatif est introuvable dans le stockage.")
    await storage.delete(row.storage_key)
  } catch (error) {
    if (error.status) throw error
    throw new AppError(503, "STOCKAGE_INDISPONIBLE", "Le fichier n’a pas pu être supprimé du stockage.")
  }
  try {
    await withTransaction(async (conn) => {
      await run(conn, "DELETE FROM attachments WHERE id = ?", [id])
      await createAuditLog(conn, { ctx, action: "DELETE", entityType: "attachment", entityId: id, before })
    })
  } catch (error) {
    await storage.put(row.storage_key, contents, row.mime_type).catch(() => {})
    throw error
  }
}
