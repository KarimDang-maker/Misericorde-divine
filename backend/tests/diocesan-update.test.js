import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import "./env.js"
import { loggedClient, startServer, solde } from "./helpers.js"

let srv
let client
before(async () => {
  srv = await startServer()
  client = await loggedClient(srv.base)
})
after(async () => srv.close())

describe("Correction des contributions diocésaines", () => {
  it("ajoute les contre-écritures, garde la période et rollback un solde insuffisant", async () => {
    const oldAccount = (await client.post("/comptes", {
      code: "DIO-EDIT-A", nom: "Compte diocèse A", type: "banque", soldeInitial: "1000",
    })).body.data.id
    const newAccount = (await client.post("/comptes", {
      code: "DIO-EDIT-B", nom: "Compte diocèse B", type: "banque", soldeInitial: "1000",
    })).body.data.id
    const created = await client.post("/contribution-diocesaine", {
      compteId: oldAccount, montant: "100", dateOperation: "2025-09-10",
      periodeDebut: "2025-08-01", periodeFin: "2025-08-31", libelle: "Versement initial",
    })
    assert.equal(created.status, 201)
    const original = created.body.data

    const changed = await client.put(`/contribution-diocesaine/${original.id}`, {
      compteId: newAccount, montant: "150", dateOperation: "2025-09-11", libelle: "Versement corrigé",
    })
    assert.equal(changed.status, 200)
    assert.equal(changed.body.data.compteId, newAccount)
    assert.equal(changed.body.data.montant, 150)
    assert.equal(changed.body.data.periodeDebut, "2025-08-01")
    assert.equal(changed.body.data.periodeFin, "2025-08-31")
    assert.equal(await solde(client, oldAccount), 1000)
    assert.equal(await solde(client, newAccount), 850)

    const [movementRows] = await srv.pool.query(
      "SELECT sens,montant,nature FROM financial_movements WHERE source_type='diocesan' AND source_id=? ORDER BY id",
      [original.id],
    )
    assert.equal(movementRows.length, 3)
    assert.deepEqual(movementRows.map((row) => [row.sens, Number(row.montant), row.nature]), [
      ["sortie", 100, "normal"],
      ["entree", 100, "contre_ecriture"],
      ["sortie", 150, "normal"],
    ])

    const rejected = await client.put(`/contribution-diocesaine/${original.id}`, { montant: "2000" })
    assert.equal(rejected.status, 422)
    assert.equal((await client.get(`/contribution-diocesaine/${original.id}`)).body.data.montant, 150)
    const [[count]] = await srv.pool.query(
      "SELECT COUNT(*) AS total FROM financial_movements WHERE source_type='diocesan' AND source_id=?",
      [original.id],
    )
    assert.equal(Number(count.total), 3, "un ajustement refusé ne doit laisser aucune écriture partielle")

    const immutablePeriod = await client.put(`/contribution-diocesaine/${original.id}`, { periodeDebut: "2025-09-01" })
    assert.equal(immutablePeriod.status, 422)
    assert.equal((await client.post(`/contribution-diocesaine/${original.id}/annulation`, { motif: "Correction terminée" })).status, 200)
    assert.equal((await client.put(`/contribution-diocesaine/${original.id}`, { montant: "120" })).status, 409)
  })
})
