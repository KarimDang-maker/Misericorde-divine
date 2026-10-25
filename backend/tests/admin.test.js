import assert from "node:assert/strict"
import { createDecipheriv } from "node:crypto"
import { after, before, describe, it } from "node:test"
import "./env.js"
import { ADMIN, Client, loggedClient, startServer } from "./helpers.js"
import { deliverNotification, enqueueNotification } from "../src/services/notifications.js"

let srv
before(async () => { srv = await startServer() })
after(async () => srv.close())

const q = async (sql, params = []) => (await srv.pool.query(sql, params))[0]

describe("Administration — rôles, utilisateurs et ajustements", () => {
  it("réserve les routes admin et l'ajustement financier au rôle admin", async () => {
    const admin = await loggedClient(srv.base)
    const account = (await admin.get("/comptes")).body.data.find((item) => item.code === "CAISSE")
    const created = await admin.post("/admin/users", {
      email: "gestionnaire@example.org", nom: "Gestionnaire Test", motDePasse: "MotDePasseGestionnaire123", role: "gestionnaire",
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.role, "gestionnaire")
    assert.equal(created.body.data.password_hash, undefined)

    const manager = new Client(srv.base)
    await manager.login({ email: "gestionnaire@example.org", motDePasse: "MotDePasseGestionnaire123" })
    assert.equal((await manager.get("/admin/users")).status, 403)
    const adjustment = { sens: "entree", montant: "10.00", dateOperation: "2026-10-25", motif: "Correction après inventaire", justificatifReference: "PV-2026-10" }
    assert.equal((await manager.post(`/comptes/${account.id}/ajustements`, adjustment)).status, 403)

    const result = await admin.post(`/comptes/${account.id}/ajustements`, adjustment)
    assert.equal(result.status, 201)
    assert.equal(result.body.data.montant, 10)
    const [{ total }] = await q("SELECT COUNT(*) total FROM financial_movements WHERE source_type='ajustement' AND source_id=?", [result.body.data.id])
    assert.equal(Number(total), 1)
    const balance = await admin.get(`/comptes/${account.id}/solde`)
    assert.equal(balance.body.data.solde, 10)

    const rejected = await admin.post(`/comptes/${account.id}/ajustements`, {
      sens: "sortie", montant: "20", dateOperation: "2026-10-25", motif: "Sortie excédant le solde disponible",
    })
    assert.equal(rejected.status, 422)
    const [{ count }] = await q("SELECT COUNT(*) count FROM account_adjustments")
    assert.equal(Number(count), 1, "l'écriture rejetée doit rollback l'ajustement")
  })

  it("empêche la désactivation du dernier administrateur actif", async () => {
    const admin = await loggedClient(srv.base)
    const me = await admin.get("/auth/me")
    assert.equal(me.body.data.user.role, "admin")
    const result = await admin.patch(`/admin/users/${me.body.data.user.id}/statut`, { actif: false })
    assert.equal(result.status, 422)
    assert.equal(result.body.error.code, "DERNIER_ADMIN")
  })

  it("supervise la file e-mail sans exposer de payload et relance un échec mort avec audit", async () => {
    const admin = await loggedClient(srv.base)
    const id = await enqueueNotification(srv.pool, {
      eventType: "PASSWORD_CHANGED", aggregateType: "user", aggregateId: 1,
      recipient: "destinataire.secret@example.org",
      payload: { userName: "Test", occurredAt: new Date().toISOString() },
      dedupeKey: "admin-outbox-retry-test",
    })
    await q("UPDATE notification_outbox SET status='dead', attempts=5, last_error_code='TEST_PROVIDER_FAILURE' WHERE id=?", [id])

    const listing = await admin.get("/admin/notifications/outbox?status=dead")
    assert.equal(listing.status, 200)
    const item = listing.body.data.find((entry) => entry.id === id)
    assert.ok(item)
    assert.equal(item.recipientMasked, "d***@example.org")
    assert.equal(item.lastErrorCode, "TEST_PROVIDER_FAILURE")
    assert.equal("recipient" in item, false)
    assert.equal("payload" in item, false)
    assert.equal("dedupeKey" in item, false)

    await admin.post("/admin/users", { email: "outbox-manager@example.org", nom: "Outbox Manager", motDePasse: "MotDePasseOutbox123", role: "gestionnaire" })
    const manager = new Client(srv.base)
    await manager.login({ email: "outbox-manager@example.org", motDePasse: "MotDePasseOutbox123" })
    assert.equal((await manager.get("/admin/notifications/outbox")).status, 403)
    assert.equal((await manager.post(`/admin/notifications/outbox/${id}/retry`)).status, 403)
    assert.equal((await admin.post("/admin/notifications/outbox/" + id + "/retry")).status, 200)
    const [retried] = await q("SELECT status,attempts,manual_retry_count FROM notification_outbox WHERE id=?", [id])
    assert.equal(retried.status, "pending")
    assert.equal(Number(retried.attempts), 0)
    assert.equal(Number(retried.manual_retry_count), 1)
    assert.equal((await admin.post("/admin/notifications/outbox/" + id + "/retry")).status, 409)

    const [audit] = await q("SELECT action,entite_type,entite_id FROM audit_logs WHERE entite_type='notification' AND entite_id=? ORDER BY id DESC LIMIT 1", [String(id)])
    assert.equal(audit.action, "RETRY")
    assert.equal(audit.entite_type, "notification")

    let sent
    await q("UPDATE notification_outbox SET status='processing',locked_by='admin-retry-test' WHERE id=?", [id])
    await deliverNotification({ id, event_type: "PASSWORD_CHANGED", recipient: "destinataire.secret@example.org", payload: { userName: "Test", occurredAt: new Date().toISOString() }, attempts: 0, manual_retry_count: 1, locked_by: "admin-retry-test" }, {
      from: "test@example.org", send: async (message) => { sent = message },
    })
    assert.equal(sent.idempotencyKey, `notification-${id}-manual-1`)
  })

  it("retourne une réponse neutre au reset et ne stocke pas le token en clair", async () => {
    const client = new Client(srv.base)
    const known = await client.post("/auth/password-reset/request", { email: ADMIN.email })
    const unknown = await client.post("/auth/password-reset/request", { email: "absent@example.org" })
    assert.equal(known.status, 202)
    assert.deepEqual(known.body, unknown.body)
    for (let i = 0; i < 3; i++) await client.post("/auth/password-reset/request", { email: ADMIN.email })
    await client.post("/auth/password-reset/request", { email: ADMIN.email })
    const [{ tokenCount }] = await q("SELECT COUNT(*) tokenCount FROM password_reset_tokens")
    assert.equal(Number(tokenCount), 4, "la sixième demande depuis la même IP est limitée")
    const [token] = await q("SELECT token_hash FROM password_reset_tokens ORDER BY id DESC LIMIT 1")
    assert.match(token.token_hash, /^[a-f0-9]{64}$/)
    const [notice] = await q("SELECT id,payload FROM notification_outbox WHERE event_type='PASSWORD_RESET' ORDER BY id DESC LIMIT 1")
    const payload = typeof notice.payload === "string" ? JSON.parse(notice.payload) : notice.payload
    assert.match(payload.encryptedToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    assert.equal(JSON.stringify(payload).includes(token.token_hash), false)
    const [iv, tag, ciphertext] = payload.encryptedToken.split(".")
    const decipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 7), Buffer.from(iv, "base64url"))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    const rawToken = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString()
    let sentEmail
    await srv.pool.query("UPDATE notification_outbox SET status='processing',locked_by='reset-test' WHERE id=?", [notice.id])
    await deliverNotification({ id: notice.id, event_type: "PASSWORD_RESET", recipient: ADMIN.email, payload, attempts: 0, locked_by: "reset-test" }, {
      from: "test@example.org", send: async (message) => { sentEmail = message },
    })
    assert.match(sentEmail.text, new RegExp(rawToken))
    assert.match(sentEmail.text, /reinitialiser-mot-de-passe/)
    const password = "MotDePasseNouveau123"
    await srv.pool.query("UPDATE password_reset_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE token_hash=?", [token.token_hash])
    assert.equal((await client.post("/auth/password-reset/confirm", { token: rawToken, nouveauMotDePasse: password })).status, 422)
    await srv.pool.query("UPDATE password_reset_tokens SET expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE token_hash=?", [token.token_hash])
    assert.equal((await client.post("/auth/password-reset/confirm", { token: rawToken, nouveauMotDePasse: password })).status, 200)
    assert.equal((await client.post("/auth/password-reset/confirm", { token: rawToken, nouveauMotDePasse: "AutreMotDePasse123" })).status, 422)
    assert.equal((await new Client(srv.base).post("/auth/login", { email: ADMIN.email, motDePasse: password })).status, 200)
  })
})
