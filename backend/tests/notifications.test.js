import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import "./env.js"
import { createEmailProvider } from "../src/services/emailProvider.js"
import { renderPasswordChangedEmail } from "../src/services/emailTemplates.js"
import { claimPendingNotifications, deliverNotification, enqueueNotification } from "../src/services/notifications.js"
import { withTransaction } from "../src/config/database.js"
import { isValidCronAuthorization } from "../src/routes/notifications.js"
import { loggedClient, startServer } from "./helpers.js"

let srv
before(async () => { srv = await startServer() })
after(async () => srv.close())

const event = (dedupeKey) => ({
  eventType: "PASSWORD_CHANGED",
  aggregateType: "user",
  aggregateId: 7,
  recipient: "owner@example.org",
  payload: { userName: "<Admin>", occurredAt: "2026-10-25T12:00:00.000Z" },
  dedupeKey,
})

describe("Notifications e-mail", () => {
  it("rend le message texte/HTML et échappe les données du compte", () => {
    const rendered = renderPasswordChangedEmail(event("render-test").payload)
    assert.match(rendered.subject, /mot de passe modifié/i)
    assert.match(rendered.text, /<Admin>/)
    assert.match(rendered.html, /&lt;Admin&gt;/)
    assert.doesNotMatch(rendered.html, /<Admin>/)
    assert.doesNotMatch(rendered.html, /password|token|cookie/i)
  })

  it("désactive explicitement le fournisseur et refuse une configuration incomplète", () => {
    assert.throws(() => createEmailProvider({ provider: "disabled" }), { code: "EMAIL_DESACTIVE" })
    assert.throws(() => createEmailProvider({ provider: "resend", apiKey: "", from: "" }), { code: "EMAIL_NON_CONFIGURE" })
    assert.throws(() => createEmailProvider({ provider: "smtp" }), { code: "EMAIL_PROVIDER_INVALIDE" })
  })

  it("envoie au fournisseur HTTP avec idempotence et conserve un code d’erreur expurgé", async () => {
    const calls = []
    const provider = createEmailProvider(
      { provider: "resend", apiKey: "api-secret", from: "Misericorde <test@example.org>", replyTo: "help@example.org" },
      { fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return { ok: true, async json() { return { id: "provider-id" } } }
      } },
    )
    const sent = await provider.send({ to: "owner@example.org", subject: "Test", html: "<p>ok</p>", text: "ok", idempotencyKey: "notification-1" })
    assert.equal(sent.id, "provider-id")
    assert.equal(calls[0].url, "https://api.resend.com/emails")
    assert.equal(calls[0].options.headers.Authorization, "Bearer api-secret")
    assert.equal(calls[0].options.headers["Idempotency-Key"], "notification-1")
    assert.equal(JSON.parse(calls[0].options.body).reply_to, "help@example.org")
    const failing = createEmailProvider(
      { provider: "resend", apiKey: "api-secret", from: "test@example.org" },
      { fetchImpl: async () => ({ ok: false, status: 422 }) },
    )
    await assert.rejects(failing.send({ to: "bad@example.org", subject: "Test", html: "", text: "", idempotencyKey: "n-2" }), (error) => error.permanent && error.code === "EMAIL_PROVIDER_422")
  })

  it("vérifie le secret de cron avec comparaison constante et refuse les valeurs courtes", () => {
    const secret = "a-long-random-cron-secret-with-32-chars"
    assert.equal(isValidCronAuthorization(secret, `Bearer ${secret}`), true)
    assert.equal(isValidCronAuthorization(secret, "Bearer wrong"), false)
    assert.equal(isValidCronAuthorization("short", "Bearer short"), false)
    assert.equal(isValidCronAuthorization(secret, undefined), false)
  })

  it("ne permet pas d’appeler le cron sans son secret", async () => {
    const response = await fetch(`${srv.base}/cron/notifications`)
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, "CRON_NON_AUTORISE")
  })

  it("persiste le choix des futurs e-mails optionnels et garde les deux avis de sécurité obligatoires", async () => {
    const response = await fetch(`${srv.base}/notifications/preferences`)
    assert.equal(response.status, 401)
    const client = await loggedClient(srv.base)
    const initial = await client.get("/notifications/preferences")
    assert.equal(initial.status, 200)
    assert.equal(initial.body.data.notificationsOptionnelles, true)
    assert.deepEqual(initial.body.data.evenementsObligatoires, ["PASSWORD_CHANGED", "PASSWORD_RESET"])
    assert.deepEqual(initial.body.data.evenementsOptionnelsDisponibles, [])

    const changed = await client.put("/notifications/preferences", { notificationsOptionnelles: false })
    assert.equal(changed.status, 200)
    assert.equal(changed.body.data.notificationsOptionnelles, false)
    assert.deepEqual((await client.get("/notifications/preferences")).body.data.evenementsObligatoires, ["PASSWORD_CHANGED", "PASSWORD_RESET"])
    assert.equal((await client.put("/notifications/preferences", { notificationsOptionnelles: false, PASSWORD_RESET: false })).status, 422)
  })

  it("valide les événements, déduplique la clé et annule l'outbox avec la transaction métier", async () => {
    const first = await enqueueNotification(null, event("test:dedupe:1"))
    const replay = await enqueueNotification(null, event("test:dedupe:1"))
    assert.equal(first, replay)
    const [[count]] = await srv.pool.query("SELECT COUNT(*) AS n FROM notification_outbox WHERE dedupe_key='test:dedupe:1'")
    assert.equal(Number(count.n), 1)

    await assert.rejects(withTransaction(async (conn) => {
      await enqueueNotification(conn, event("test:rollback"))
      throw new Error("rollback")
    }), /rollback/)
    const [[rolledBack]] = await srv.pool.query("SELECT COUNT(*) AS n FROM notification_outbox WHERE dedupe_key='test:rollback'")
    assert.equal(Number(rolledBack.n), 0)
    await assert.rejects(enqueueNotification(null, { ...event("test:invalid"), eventType: "FREE_EMAIL" }))
  })

  it("réserve un lot sans attribuer deux fois le même message à deux workers", async () => {
    await enqueueNotification(null, event("test:claim:1"))
    const [first, second] = await Promise.all([
      claimPendingNotifications(10, "test-worker-one"),
      claimPendingNotifications(10, "test-worker-two"),
    ])
    const ids = [...first, ...second].filter((item) => item.dedupe_key === "test:claim:1")
    assert.equal(ids.length, 1)
    assert.ok(["test-worker-one", "test-worker-two"].includes(ids[0].locked_by))
  })

  it("marque un succès envoyé et un échec permanent comme dead sans conserver le message d'erreur", async () => {
    await enqueueNotification(null, event("test:delivery:ok"))
    const [success] = (await claimPendingNotifications(10, "test-worker-success")).filter((item) => item.dedupe_key === "test:delivery:ok")
    const messages = []
    const provider = { from: "Misericorde <test@example.org>", async send(message) { messages.push(message) } }
    assert.deepEqual(await deliverNotification(success, provider), { id: Number(success.id), status: "sent" })
    assert.match(messages[0].html, /&lt;Admin&gt;/)
    assert.equal(messages[0].idempotencyKey, `notification-${success.id}`)
    const [[sent]] = await srv.pool.query("SELECT status, sent_at FROM notification_outbox WHERE id=?", [success.id])
    assert.equal(sent.status, "sent")
    assert.ok(sent.sent_at)

    await enqueueNotification(null, event("test:delivery:dead"))
    const [failed] = (await claimPendingNotifications(10, "test-worker-failure")).filter((item) => item.dedupe_key === "test:delivery:dead")
    const result = await deliverNotification(failed, { async send() { const error = new Error("private response body"); error.code = "EMAIL_INVALID_RECIPIENT"; error.permanent = true; throw error } })
    assert.equal(result.status, "dead")
    const [[dead]] = await srv.pool.query("SELECT status, attempts, last_error_code FROM notification_outbox WHERE id=?", [failed.id])
    assert.equal(dead.status, "dead")
    assert.equal(Number(dead.attempts), 1)
    assert.equal(dead.last_error_code, "EMAIL_INVALID_RECIPIENT")
    assert.doesNotMatch(dead.last_error_code, /private response body/)
  })

  it("reprogramme un échec temporaire avec un délai croissant", async () => {
    await enqueueNotification(null, event("test:delivery:retry"))
    const [item] = (await claimPendingNotifications(5, "test-worker-retry")).filter((row) => row.dedupe_key === "test:delivery:retry")
    const result = await deliverNotification(item, { async send() { const error = new Error("timeout"); error.code = "EMAIL_PROVIDER_UNAVAILABLE"; throw error } })
    assert.equal(result.status, "pending")
    const [[retry]] = await srv.pool.query("SELECT status, attempts, available_at, available_at > UTC_TIMESTAMP() AS is_future, last_error_code FROM notification_outbox WHERE id=?", [item.id])
    assert.equal(retry.status, "pending")
    assert.equal(Number(retry.attempts), 1)
    assert.equal(retry.last_error_code, "EMAIL_PROVIDER_UNAVAILABLE")
    assert.equal(Number(retry.is_future), 1)
  })
})
