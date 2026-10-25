import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildDatabaseSsl, parseBoolean, parseSameSite } from "../src/config/environment.js"
import app from "../src/index.js"
import vercelHandler from "../api/[...path].js"

describe("Configuration d’exécution et de déploiement", () => {
  it("exporte une application Express serverless sans démarrer de serveur ni migrer", () => {
    assert.equal(typeof app, "function")
    assert.equal(typeof app.handle, "function")
  })

  it("expose les routes /api au travers du handler catch-all Vercel", async () => {
    assert.equal(typeof vercelHandler, "function")
    const server = vercelHandler.listen(0)
    await new Promise((resolve) => server.once("listening", resolve))
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/__route_test__`)
      assert.equal(response.status, 401)
      assert.equal((await response.json()).error.code, "NON_AUTHENTIFIE")
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it("expose le contrat OpenAPI et Swagger UI sans exiger de session", async () => {
    const server = app.listen(0)
    await new Promise((resolve) => server.once("listening", resolve))
    try {
      const base = `http://127.0.0.1:${server.address().port}/api`
      const specResponse = await fetch(`${base}/openapi.json`)
      assert.equal(specResponse.status, 200)
      const spec = await specResponse.json()
      assert.equal(spec.openapi, "3.0.3")
      assert.ok(spec.paths["/comptes/{id}/ajustements"])
      assert.ok(spec.paths["/auth/password-reset/request"])

      const docsResponse = await fetch(`${base}/docs/`)
      assert.equal(docsResponse.status, 200)
      assert.match(docsResponse.headers.get("content-type"), /text\/html/)
      assert.match(docsResponse.headers.get("content-security-policy"), /unsafe-inline/)
      assert.match(await docsResponse.text(), /id="swagger-ui"/)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it("active TLS MySQL avec validation du certificat et interprète un CA multiligne", () => {
    assert.equal(buildDatabaseSsl(false, "CA"), undefined)
    assert.deepEqual(buildDatabaseSsl(true, "-----BEGIN\\nCERTIFICATE-----"), {
      ca: "-----BEGIN\nCERTIFICATE-----",
      rejectUnauthorized: true,
    })
    assert.deepEqual(buildDatabaseSsl(true), { rejectUnauthorized: true })
  })

  it("valide les options SameSite et les booléens d’environnement", () => {
    assert.equal(parseSameSite("None"), "none")
    assert.equal(parseSameSite("strict"), "strict")
    assert.throws(() => parseSameSite("invalid"), /SESSION_COOKIE_SAME_SITE/)
    assert.equal(parseBoolean("true"), true)
    assert.equal(parseBoolean("false", true), false)
  })
})
