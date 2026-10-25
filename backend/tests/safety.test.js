import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { assertSafeTestTarget, TEST_DATABASE_NAME } from "./safety.js"

const localTarget = { nodeEnv: "test", databaseName: TEST_DATABASE_NAME, host: "127.0.0.1" }

describe("Garde-fous de la base de tests", () => {
  it("autorise uniquement le schéma de test dédié sur localhost", () => {
    assert.deepEqual(assertSafeTestTarget(localTarget, {}), { host: "127.0.0.1", remote: false })
  })

  it("refuse un environnement autre que test", () => {
    assert.throws(() => assertSafeTestTarget({ ...localTarget, nodeEnv: "production" }), /NODE_ENV/)
  })

  it("refuse tout nom de base différent du schéma réservé", () => {
    assert.throws(() => assertSafeTestTarget({ ...localTarget, databaseName: "misericorde_divine" }), /DB_NAME/)
  })

  it("refuse une base distante sans confirmation explicite", () => {
    assert.throws(() => assertSafeTestTarget({ ...localTarget, host: "mysql.example.net" }, {}), /base distante/)
  })

  it("refuse une confirmation distante dont l'hôte ne correspond pas exactement", () => {
    const target = { ...localTarget, host: "mysql-test.example.net" }
    const confirmation = {
      TEST_ALLOW_REMOTE_DATABASE: "I_UNDERSTAND_THIS_IS_A_DISPOSABLE_TEST_DATABASE",
      TEST_DB_HOST_CONFIRMATION: "mysql-production.example.net",
      TEST_DB_NAME_CONFIRMATION: TEST_DATABASE_NAME,
    }
    assert.throws(() => assertSafeTestTarget(target, confirmation), /base distante/)
  })

  it("accepte une base distante seulement avec les trois confirmations exactes", () => {
    const target = { ...localTarget, host: "mysql-test.example.net" }
    const confirmation = {
      TEST_ALLOW_REMOTE_DATABASE: "I_UNDERSTAND_THIS_IS_A_DISPOSABLE_TEST_DATABASE",
      TEST_DB_HOST_CONFIRMATION: target.host,
      TEST_DB_NAME_CONFIRMATION: TEST_DATABASE_NAME,
    }
    assert.deepEqual(assertSafeTestTarget(target, confirmation), { host: target.host, remote: true })
  })
})
