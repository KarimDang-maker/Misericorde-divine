import { randomInt, randomUUID } from "node:crypto"
import { createDecipheriv } from "node:crypto"
import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { createAuditLog } from "./audit.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { paginationMeta } from "../utils/pagination.js"
import { renderPasswordChangedEmail, renderPasswordResetEmail } from "./emailTemplates.js"
import { env } from "../config/environment.js"

export const NOTIFICATION_EVENTS = ["PASSWORD_CHANGED", "PASSWORD_RESET"]
export const MANDATORY_NOTIFICATION_EVENTS = ["PASSWORD_CHANGED", "PASSWORD_RESET"]
export const notificationPreferencesSchema = z.object({ notificationsOptionnelles: z.boolean() }).strict()
const passwordChangedPayloadSchema = z.object({ userName: z.string().max(190), occurredAt: z.string().datetime() }).strict()
const passwordResetPayloadSchema = z.object({ userName: z.string().max(190), encryptedToken: z.string().min(20).max(500), expiresAt: z.string().datetime() }).strict()
export const notificationEventSchema = z.object({
  eventType: z.enum(NOTIFICATION_EVENTS),
  aggregateType: z.literal("user"),
  aggregateId: z.union([z.string().min(1).max(40), z.number().int().positive()]).transform(String),
  recipient: z.string().trim().email().max(254),
  payload: z.union([passwordChangedPayloadSchema, passwordResetPayloadSchema]),
  dedupeKey: z.string().min(1).max(190),
}).strict().superRefine((item, context) => {
  if (item.eventType === "PASSWORD_CHANGED" && !("occurredAt" in item.payload)) context.addIssue({ code: "custom", message: "Payload PASSWORD_CHANGED invalide." })
  if (item.eventType === "PASSWORD_RESET" && !("encryptedToken" in item.payload)) context.addIssue({ code: "custom", message: "Payload PASSWORD_RESET invalide." })
})

const MAX_ATTEMPTS = 5
const MAX_MANUAL_RETRIES = 10
const LEASE_MINUTES = 5
const safeErrorCode = (error) => String(error?.code || "EMAIL_DELIVERY_FAILED").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80)
const maskEmail = (email) => {
  const [local, domain] = String(email).split("@")
  if (!domain) return "***"
  return `${local.slice(0, 1)}***@${domain}`
}

const outboxFilterSchema = z.object({
  status: z.enum(["pending", "processing", "sent", "dead"]).optional(),
})

const defaultNotificationPreferences = {
  notificationsOptionnelles: true,
  evenementsObligatoires: MANDATORY_NOTIFICATION_EVENTS,
  evenementsOptionnelsDisponibles: [],
}

export async function getNotificationPreferences(userId) {
  const row = await one(null, "SELECT preferences FROM user_preferences WHERE user_id=?", [userId])
  const preferences = row ? (typeof row.preferences === "string" ? JSON.parse(row.preferences) : row.preferences) : {}
  return { ...defaultNotificationPreferences, notificationsOptionnelles: preferences.notificationsOptionnelles ?? true }
}

/** Stocke le choix pour les futurs e-mails d’information; les deux alertes de sécurité restent obligatoires. */
export async function updateNotificationPreferences(userId, patch, ctx) {
  const input = notificationPreferencesSchema.parse(patch)
  return withTransaction(async (conn) => {
    await run(conn,
      "INSERT INTO user_preferences (user_id,preferences) VALUES (?, '{}') ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)",
      [userId],
    )
    const row = await one(conn, "SELECT preferences FROM user_preferences WHERE user_id=? FOR UPDATE", [userId])
    const current = typeof row.preferences === "string" ? JSON.parse(row.preferences) : row.preferences
    const before = getNotificationPreferencesFromJson(current)
    const next = { ...current, notificationsOptionnelles: input.notificationsOptionnelles }
    await run(conn, "UPDATE user_preferences SET preferences=? WHERE user_id=?", [JSON.stringify(next), userId])
    const after = getNotificationPreferencesFromJson(next)
    await createAuditLog(conn, { ctx, action: "UPDATE", entityType: "notification_preferences", entityId: userId, before, after })
    return after
  })
}

function getNotificationPreferencesFromJson(preferences = {}) {
  return { ...defaultNotificationPreferences, notificationsOptionnelles: preferences.notificationsOptionnelles ?? true }
}

/** Liste admin expurgée : aucun payload d’e-mail, token, clé de déduplication ou lease n’est exposé. */
export async function listNotificationOutbox(filters = {}, pagination = { page: 1, limit: 25, offset: 0 }) {
  const input = outboxFilterSchema.parse(filters)
  const where = input.status ? "WHERE status = ?" : ""
  const params = input.status ? [input.status] : []
  const total = await one(null, `SELECT COUNT(*) AS total FROM notification_outbox ${where}`, params)
  const items = await rows(
    null,
    `SELECT id,event_type,aggregate_type,aggregate_id,recipient,status,attempts,manual_retry_count,
            available_at,sent_at,last_error_code,created_at
     FROM notification_outbox ${where} ORDER BY id DESC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  )
  return {
    items: items.map((item) => ({
      id: Number(item.id), eventType: item.event_type, aggregateType: item.aggregate_type,
      aggregateId: item.aggregate_id, recipientMasked: maskEmail(item.recipient), status: item.status,
      attempts: Number(item.attempts), manualRetryCount: Number(item.manual_retry_count),
      availableAt: item.available_at, sentAt: item.sent_at, lastErrorCode: item.last_error_code,
      createdAt: item.created_at,
    })),
    meta: paginationMeta(pagination, Number(total.total)),
  }
}

/** Remet en file un message mort, avec une nouvelle clé provider et une trace d’audit atomique. */
export async function retryDeadNotification(id, ctx) {
  return withTransaction(async (conn) => {
    const before = await one(conn, "SELECT id,status,attempts,manual_retry_count,last_error_code FROM notification_outbox WHERE id=? FOR UPDATE", [id])
    if (!before) throw notFound("NOTIFICATION_INTROUVABLE", "Notification introuvable.")
    if (before.status !== "dead") throw conflict("NOTIFICATION_NON_RELANCABLE", "Seules les notifications en échec définitif peuvent être relancées.")
    if (Number(before.manual_retry_count) >= MAX_MANUAL_RETRIES) {
      throw unprocessable("LIMITE_RELANCES_ATTEINTE", "La limite de relances manuelles est atteinte.")
    }
    await run(conn,
      `UPDATE notification_outbox
       SET status='pending', attempts=0, manual_retry_count=manual_retry_count+1,
           available_at=UTC_TIMESTAMP(), locked_at=NULL, locked_by=NULL, last_error_code=NULL
       WHERE id=?`,
      [id],
    )
    const after = { status: "pending", manualRetryCount: Number(before.manual_retry_count) + 1 }
    await createAuditLog(conn, { ctx, action: "RETRY", entityType: "notification", entityId: id, before, after })
    return { id: Number(id), ...after }
  })
}

export async function enqueueNotification(executor, event) {
  const item = notificationEventSchema.parse(event)
  const result = await run(
    executor,
    `INSERT IGNORE INTO notification_outbox
       (event_type, aggregate_type, aggregate_id, recipient, payload, dedupe_key, available_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [item.eventType, item.aggregateType, item.aggregateId, item.recipient, JSON.stringify(item.payload), item.dedupeKey],
  )
  if (result.insertId) return Number(result.insertId)
  const existing = await one(executor, "SELECT id FROM notification_outbox WHERE dedupe_key = ?", [item.dedupeKey])
  return Number(existing.id)
}

export function enqueuePasswordChangedNotification(executor, user) {
  return enqueueNotification(executor, {
    eventType: "PASSWORD_CHANGED",
    aggregateType: "user",
    aggregateId: user.id,
    recipient: user.email,
    payload: { userName: user.nom || "", occurredAt: new Date().toISOString() },
    dedupeKey: `password-changed:${user.id}:${randomUUID()}`,
  })
}

export async function claimPendingNotifications(limit = 10, workerId = randomUUID()) {
  const safeLimit = Math.max(1, Math.min(5, Math.trunc(Number(limit) || 3)))
  const owner = String(workerId).slice(0, 64)
  return withTransaction(async (conn) => {
    const available = await rows(
      conn,
      `SELECT * FROM notification_outbox
       WHERE (status='pending' AND available_at <= UTC_TIMESTAMP())
          OR (status='processing' AND locked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${LEASE_MINUTES} MINUTE))
       ORDER BY id LIMIT ${safeLimit} FOR UPDATE SKIP LOCKED`,
    )
    const claimed = []
    for (const item of available) {
      await run(conn, "UPDATE notification_outbox SET status='processing', locked_at=UTC_TIMESTAMP(), locked_by=? WHERE id=?", [owner, item.id])
      const payload = typeof item.payload === "string" ? JSON.parse(item.payload) : item.payload
      claimed.push({ ...item, payload, status: "processing", locked_by: owner })
    }
    return claimed
  })
}

export async function deliverNotification(item, provider) {
  if (!provider || typeof provider.send !== "function") throw new Error("EMAIL_PROVIDER_REQUIRED")
  try {
    let content
    if (item.event_type === "PASSWORD_CHANGED") content = renderPasswordChangedEmail(item.payload)
    else if (item.event_type === "PASSWORD_RESET") {
      const key = Buffer.from(env.passwordResetEncryptionKey, "base64")
      if (key.length !== 32) throw new Error("PASSWORD_RESET_ENCRYPTION_KEY_INVALID")
      const [ivPart, tagPart, encryptedPart] = item.payload.encryptedToken.split(".")
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"))
      decipher.setAuthTag(Buffer.from(tagPart, "base64url"))
      const token = Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString()
      const url = new URL("/reinitialiser-mot-de-passe", env.frontendUrl)
      url.searchParams.set("token", token)
      content = renderPasswordResetEmail({ userName: item.payload.userName, resetUrl: url.toString() })
    } else throw new Error("NOTIFICATION_EVENT_UNSUPPORTED")
    await provider.send({
      to: item.recipient,
      from: provider.from,
      replyTo: provider.replyTo,
      ...content,
      idempotencyKey: Number(item.manual_retry_count || 0)
        ? `notification-${item.id}-manual-${item.manual_retry_count}`
        : `notification-${item.id}`,
    })
    const updated = await run(
      null,
      `UPDATE notification_outbox SET status='sent', sent_at=UTC_TIMESTAMP(), locked_at=NULL, locked_by=NULL,
         last_error_code=NULL WHERE id=? AND status='processing' AND locked_by=?`,
      [item.id, item.locked_by],
    )
    if (!updated.affectedRows) throw new Error("NOTIFICATION_LEASE_LOST")
    return { id: Number(item.id), status: "sent" }
  } catch (error) {
    if (error?.code === "NOTIFICATION_LEASE_LOST") throw error
    const attempts = Number(item.attempts || 0) + 1
    const dead = Boolean(error?.permanent) || attempts >= MAX_ATTEMPTS
    const delaySeconds = Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1) + randomInt(0, 6))
    await run(
      null,
      `UPDATE notification_outbox
       SET status=?, attempts=?, available_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
           locked_at=NULL, locked_by=NULL, last_error_code=?
       WHERE id=? AND status='processing' AND locked_by=?`,
      [dead ? "dead" : "pending", attempts, delaySeconds, safeErrorCode(error), item.id, item.locked_by],
    )
    return { id: Number(item.id), status: dead ? "dead" : "pending", attempts }
  }
}

export async function retryFailedNotifications(limit = 10, provider, workerId = randomUUID()) {
  const claimed = await claimPendingNotifications(limit, workerId)
  const results = []
  for (const item of claimed) results.push(await deliverNotification(item, provider))
  return { claimed: claimed.length, results }
}
