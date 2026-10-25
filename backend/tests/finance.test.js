import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { baseFixtures, loggedClient, solde, startServer } from "./helpers.js"
import { createAuditLog } from "../src/services/audit.js"

let srv, c, ids

before(async () => {
  srv = await startServer()
  c = await loggedClient(srv.base)
  ids = await baseFixtures(c)
})
after(async () => srv.close())

const cotisation = (over = {}) => ({
  membreId: ids.membre,
  rubriqueId: ids.cotisation,
  compteId: ids.caisse,
  montant: "25000",
  dateOperation: "2025-06-24",
  periode: "2025-06",
  ...over,
})
const depense = (over = {}) => ({
  rubriqueId: ids.depense,
  compteId: ids.caisse,
  montant: "1000",
  dateOperation: "2025-06-25",
  tiers: "Papeterie",
  ...over,
})
const count = async (table, where = "1=1") => Number((await srv.pool.query(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`))[0][0].n)

describe("Cotisation : opération + mouvement + solde + persistance", () => {
  let op
  it("crée la cotisation, la référence serveur et le mouvement dans la même transaction", async () => {
    const res = await c.post("/cotisations", cotisation())
    assert.equal(res.status, 201)
    op = res.body.data
    assert.match(op.reference, /^CT-2025-\d{6}$/)
    assert.equal(op.montant, 25000)
    assert.equal(op.statut, "valide")
    assert.equal(await solde(c, ids.caisse), 25000)
    const [mv] = (await srv.pool.query("SELECT * FROM financial_movements WHERE source_type='contribution' AND source_id=?", [op.id]))[0]
    assert.equal(mv.sens, "entree")
    assert.equal(mv.montant, "25000.00")
    assert.equal(mv.reference, op.reference)
  })

  it("persiste réellement en base (lecture SQL directe, DECIMAL exact)", async () => {
    const [row] = (await srv.pool.query("SELECT montant, statut, periode FROM contributions WHERE id=?", [op.id]))[0]
    assert.equal(row.montant, "25000.00")
    assert.equal(row.periode, "2025-06")
  })

  it("expose le détail (mouvements, historique, justificatifs)", async () => {
    const res = await c.get(`/cotisations/${op.id}`)
    assert.equal(res.body.data.mouvements.length, 1)
    assert.equal(res.body.data.historique[0].nouveauStatut, "valide")
    assert.equal(res.body.data.membre, "Marie Mballa")
  })

  it("modifie le montant : le mouvement et le solde suivent", async () => {
    const res = await c.put(`/cotisations/${op.id}`, { montant: "30000.50" })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.montant, 30000.5)
    assert.equal(await solde(c, ids.caisse), 30000.5)
    const [mv] = (await srv.pool.query("SELECT montant FROM financial_movements WHERE source_type='contribution' AND source_id=? AND nature='normal'", [op.id]))[0]
    assert.equal(mv.montant, "30000.50")
  })

  it("changer de compte déplace le mouvement et corrige les deux soldes", async () => {
    await c.put(`/cotisations/${op.id}`, { compteId: ids.banque })
    assert.equal(await solde(c, ids.caisse), 0)
    assert.equal(await solde(c, ids.banque), 31000.5)
    await c.put(`/cotisations/${op.id}`, { compteId: ids.caisse })
    assert.equal(await solde(c, ids.banque), 1000)
  })

  it("annulation : motif obligatoire, contre-écriture, solde corrigé, historique conservé", async () => {
    assert.equal((await c.post(`/cotisations/${op.id}/annulation`, {})).status, 422)
    const res = await c.post(`/cotisations/${op.id}/annulation`, { motif: "Saisie en double" })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.statut, "annule")
    assert.equal(await solde(c, ids.caisse), 0)
    const detail = (await c.get(`/cotisations/${op.id}`)).body.data
    assert.equal(detail.mouvements.length, 2)
    assert.deepEqual(detail.mouvements.map((m) => m.nature), ["normal", "contre_ecriture"])
    assert.equal(detail.historique.at(-1).motif, "Saisie en double")
    // la ligne n'est jamais supprimée
    assert.equal(await count("contributions", `id=${op.id}`), 1)
  })

  it("une opération annulée ne peut ni être annulée deux fois ni modifiée", async () => {
    assert.equal((await c.post(`/cotisations/${op.id}/annulation`, { motif: "encore" })).body.error.code, "OPERATION_DEJA_ANNULEE")
    assert.equal((await c.put(`/cotisations/${op.id}`, { montant: "1" })).body.error.code, "OPERATION_ANNULEE")
  })
})

describe("Validation des montants et références", () => {
  for (const montant of ["0", "-5", "abc", "10.999", "", "1e5", "100000000000000"]) {
    it(`refuse le montant « ${montant} »`, async () => {
      const before = await count("contributions")
      const res = await c.post("/cotisations", cotisation({ montant }))
      assert.ok([422].includes(res.status), `statut ${res.status}`)
      assert.equal(await count("contributions"), before)
    })
  }
  it("accepte la virgule décimale et 2 décimales", async () => {
    assert.equal((await c.post("/cotisations", cotisation({ montant: "10,25" }))).body.data.montant, 10.25)
  })
  it("refuse membre, rubrique ou compte inconnus", async () => {
    assert.equal((await c.post("/cotisations", cotisation({ membreId: 99999 }))).body.error.code, "MEMBRE_NOT_FOUND")
    assert.equal((await c.post("/cotisations", cotisation({ rubriqueId: 99999 }))).body.error.code, "RUBRIQUE_NOT_FOUND")
    assert.equal((await c.post("/cotisations", cotisation({ compteId: 99999 }))).body.error.code, "COMPTE_NOT_FOUND")
  })
  it("refuse une date impossible", async () => {
    assert.equal((await c.post("/cotisations", cotisation({ dateOperation: "2025-02-30" }))).status, 422)
  })
  it("la cotisation exige un membre", async () => {
    const { membreId, ...sans } = cotisation()
    assert.equal((await c.post("/cotisations", sans)).status, 422)
  })
  it("les références sont uniques et séquentielles", async () => {
    const a = (await c.post("/recettes", { rubriqueId: ids.recette, compteId: ids.caisse, montant: "1", dateOperation: "2025-01-01" })).body.data
    const b = (await c.post("/recettes", { rubriqueId: ids.recette, compteId: ids.caisse, montant: "1", dateOperation: "2025-01-02" })).body.data
    assert.match(a.reference, /^RC-2025-\d{6}$/)
    assert.equal(Number(b.reference.slice(-6)), Number(a.reference.slice(-6)) + 1)
  })
})

describe("Précision décimale", () => {
  it("0,10 + 0,20 = 0,30 exactement (pas d'erreur de flottant)", async () => {
    const compte = (await c.post("/comptes", { code: "PREC", nom: "Compte précision", type: "caisse" })).body.data.id
    await c.post("/recettes", { rubriqueId: ids.recette, compteId: compte, montant: "0.10", dateOperation: "2025-03-01" })
    await c.post("/recettes", { rubriqueId: ids.recette, compteId: compte, montant: "0.20", dateOperation: "2025-03-02" })
    assert.equal(await solde(c, compte), 0.3)
    const [r] = (await srv.pool.query("SELECT solde_initial + (SELECT SUM(montant) FROM financial_movements WHERE account_id=?) AS s FROM financial_accounts WHERE id=?", [compte, compte]))[0]
    assert.equal(r.s, "0.30")
  })
  it("gère de grands montants", async () => {
    const compte = (await c.post("/comptes", { code: "GROS", nom: "Gros montants", type: "banque" })).body.data.id
    await c.post("/recettes", { rubriqueId: ids.recette, compteId: compte, montant: "9999999999999.99", dateOperation: "2025-03-01" })
    assert.equal(await solde(c, compte), 9999999999999.99)
  })
})

describe("Dépenses : solde insuffisant, rollback et cohérence", () => {
  let compte
  before(async () => {
    compte = (await c.post("/comptes", { code: "CAISSE2", nom: "Caisse test", type: "caisse", soldeInitial: "100" })).body.data.id
  })

  it("refuse une dépense supérieure au solde et ne laisse AUCUNE trace (rollback)", async () => {
    const depBefore = await count("expenses")
    const mvBefore = await count("financial_movements")
    const res = await c.post("/depenses", depense({ compteId: compte, montant: "100.01" }))
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, "SOLDE_INSUFFISANT")
    assert.equal(await count("expenses"), depBefore)
    assert.equal(await count("financial_movements"), mvBefore)
    assert.equal(await solde(c, compte), 100)
  })

  it("accepte une dépense égale au solde (solde 0) puis refuse la suivante", async () => {
    assert.equal((await c.post("/depenses", depense({ compteId: compte, montant: "100" }))).status, 201)
    assert.equal(await solde(c, compte), 0)
    assert.equal((await c.post("/depenses", depense({ compteId: compte, montant: "0.01" }))).status, 422)
  })

  it("la modification d'une dépense au-delà du solde est refusée et rien ne change", async () => {
    const compte3 = (await c.post("/comptes", { code: "CAISSE3", nom: "Caisse 3", type: "caisse", soldeInitial: "500" })).body.data.id
    const d = (await c.post("/depenses", depense({ compteId: compte3, montant: "200" }))).body.data
    const res = await c.put(`/depenses/${d.id}`, { montant: "600" })
    assert.equal(res.status, 422)
    assert.equal((await c.get(`/depenses/${d.id}`)).body.data.montant, 200)
    assert.equal(await solde(c, compte3), 300)
    assert.equal((await c.put(`/depenses/${d.id}`, { montant: "450" })).status, 200)
    assert.equal(await solde(c, compte3), 50)
  })

  it("annuler une dépense restitue le solde ; annuler une recette qui créerait un découvert est refusé", async () => {
    const compte4 = (await c.post("/comptes", { code: "CAISSE4", nom: "Caisse 4", type: "caisse" })).body.data.id
    const r = (await c.post("/recettes", { rubriqueId: ids.recette, compteId: compte4, montant: "100", dateOperation: "2025-04-01" })).body.data
    const d = (await c.post("/depenses", depense({ compteId: compte4, montant: "80" }))).body.data
    const refus = await c.post(`/recettes/${r.id}/annulation`, { motif: "Erreur" })
    assert.equal(refus.status, 422)
    assert.equal((await c.get(`/recettes/${r.id}`)).body.data.statut, "valide")
    assert.equal((await c.post(`/depenses/${d.id}/annulation`, { motif: "Dépense annulée" })).status, 200)
    assert.equal(await solde(c, compte4), 100)
    assert.equal((await c.post(`/recettes/${r.id}/annulation`, { motif: "Erreur" })).status, 200)
    assert.equal(await solde(c, compte4), 0)
  })

  it("un compte avec découvert autorisé accepte le solde négatif", async () => {
    const cd = (await c.post("/comptes", { code: "DECOUVERT", nom: "Avec découvert", type: "banque", autoriserSoldeNegatif: true })).body.data.id
    assert.equal((await c.post("/depenses", depense({ compteId: cd, montant: "50" }))).status, 201)
    assert.equal(await solde(c, cd), -50)
  })

  it("refuse une opération sur un compte ou une rubrique désactivés", async () => {
    const cc = (await c.post("/comptes", { code: "OFF", nom: "Compte fermé", type: "caisse", soldeInitial: "10" })).body.data.id
    await c.patch(`/comptes/${cc}/statut`, { actif: false })
    assert.equal((await c.post("/depenses", depense({ compteId: cc, montant: "1" }))).body.error.code, "COMPTE_INACTIF")
    const rub = (await c.post("/rubriques/depenses", { libelle: "Rubrique temporaire" })).body.data.id
    await c.patch(`/rubriques/depenses/${rub}/statut`, { actif: false })
    assert.equal((await c.post("/depenses", depense({ rubriqueId: rub }))).body.error.code, "RUBRIQUE_INACTIVE")
  })
})

describe("Concurrence", () => {
  it("10 dépenses simultanées de 40 sur un solde de 100 : exactement 2 réussissent, jamais de découvert", async () => {
    const compte = (await c.post("/comptes", { code: "CONC", nom: "Concurrence", type: "caisse", soldeInitial: "100" })).body.data.id
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => c.post("/depenses", depense({ compteId: compte, montant: "40", libelle: `parallèle ${i}` }))),
    )
    const ok = results.filter((r) => r.status === 201)
    assert.equal(ok.length, 2, results.map((r) => r.status).join(","))
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.body.error.code === "SOLDE_INSUFFISANT"))
    assert.equal(await solde(c, compte), 20)
    assert.equal(await count("expenses", "libelle LIKE 'parallèle%'"), 2)
  })

  it("20 créations simultanées donnent 20 références distinctes et un solde exact", async () => {
    const compte = (await c.post("/comptes", { code: "CONC2", nom: "Concurrence 2", type: "banque" })).body.data.id
    const results = await Promise.all(
      Array.from({ length: 20 }, () => c.post("/recettes", { rubriqueId: ids.recette, compteId: compte, montant: "5.25", dateOperation: "2025-07-01" })),
    )
    assert.ok(results.every((r) => r.status === 201), results.map((r) => r.status).join(","))
    assert.equal(new Set(results.map((r) => r.body.data.reference)).size, 20)
    assert.equal(await solde(c, compte), 105)
  })

  it("annulations simultanées de la même opération : une seule contre-écriture", async () => {
    const compte = (await c.post("/comptes", { code: "CONC3", nom: "Concurrence 3", type: "banque" })).body.data.id
    const r = (await c.post("/recettes", { rubriqueId: ids.recette, compteId: compte, montant: "70", dateOperation: "2025-07-02" })).body.data
    const results = await Promise.all(Array.from({ length: 6 }, () => c.post(`/recettes/${r.id}/annulation`, { motif: "Doublon" })))
    assert.equal(results.filter((x) => x.status === 200).length, 1)
    assert.equal(results.filter((x) => x.status === 409).length, 5)
    assert.equal(await count("financial_movements", `source_type='revenue' AND source_id=${r.id} AND nature='contre_ecriture'`), 1)
    assert.equal(await solde(c, compte), 0)
  })
})

describe("Idempotence", () => {
  it("la même Idempotency-Key ne crée qu'une opération et rejoue la réponse", async () => {
    const key = "test-key-123"
    const before = await count("contributions")
    const first = await c.post("/cotisations", cotisation({ montant: "77" }), { "Idempotency-Key": key })
    const second = await c.post("/cotisations", cotisation({ montant: "77" }), { "Idempotency-Key": key })
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.equal(second.headers.get("idempotent-replay"), "true")
    assert.equal(second.body.data.id, first.body.data.id)
    assert.equal(await count("contributions"), before + 1)
  })
  it("deux requêtes simultanées avec la même clé ne créent qu'une opération", async () => {
    const before = await count("contributions")
    const results = await Promise.all(
      Array.from({ length: 5 }, () => c.post("/cotisations", cotisation({ montant: "88" }), { "Idempotency-Key": "parallel-key" })),
    )
    assert.ok(results.every((r) => r.status === 201))
    assert.equal(new Set(results.map((r) => r.body.data.id)).size, 1)
    assert.equal(await count("contributions"), before + 1)
  })
  it("refuse de réutiliser une clé pour une autre route métier", async () => {
    const key = "cross-route-key"
    const created = await c.post("/recettes", { rubriqueId: ids.recette, compteId: ids.caisse, montant: "3", dateOperation: "2025-07-03" }, { "Idempotency-Key": key })
    assert.equal(created.status, 201)
    const reused = await c.post("/dons", { rubriqueId: ids.don, compteId: ids.caisse, montant: "3", dateOperation: "2025-07-03" }, { "Idempotency-Key": key })
    assert.equal(reused.status, 409)
    assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUTILISEE")
  })
  it("refuse de réutiliser une clé pour un payload différent sur la même route", async () => {
    const key = "changed-payload-key"
    const base = { rubriqueId: ids.recette, compteId: ids.caisse, dateOperation: "2025-07-03" }
    const created = await c.post("/recettes", { ...base, montant: "3" }, { "Idempotency-Key": key })
    assert.equal(created.status, 201)
    const reused = await c.post("/recettes", { ...base, montant: "300" }, { "Idempotency-Key": key })
    assert.equal(reused.status, 409)
    assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUTILISEE")
    assert.equal(await count("revenues", "montant=300"), 0)
  })
  it("accepte deux intentions sans clé comme deux opérations indépendantes", async () => {
    const before = await count("revenues")
    const payload = { rubriqueId: ids.recette, compteId: ids.caisse, montant: "2", dateOperation: "2025-07-04" }
    const first = await c.post("/recettes", payload)
    const second = await c.post("/recettes", payload)
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.notEqual(first.body.data.id, second.body.data.id)
    assert.equal(await count("revenues"), before + 2)
  })
})

describe("Dons, recettes, distinction des natures", () => {
  it("distingue don et offrande par la rubrique, et recette de cotisation", async () => {
    const don = (await c.post("/dons", { rubriqueId: ids.don, compteId: ids.caisse, montant: "100", dateOperation: "2025-05-01", tiers: "Anonyme" })).body.data
    const off = (await c.post("/dons", { rubriqueId: ids.offrande, compteId: ids.caisse, montant: "40", dateOperation: "2025-05-02" })).body.data
    assert.equal(don.nature, "don")
    assert.equal(off.nature, "offrande")
    assert.match(don.reference, /^DN-/)
    const offrandes = (await c.get("/dons?nature=offrande")).body.data
    assert.ok(offrandes.length >= 1 && offrandes.every((d) => d.nature === "offrande"))
  })
  it("liste avec filtres, tri, pagination et somme des opérations valides", async () => {
    const res = await c.get("/cotisations?limit=2&page=1&sort=montant&order=desc&statut=valide")
    assert.equal(res.status, 200)
    assert.ok(res.body.data.length <= 2)
    assert.ok(res.body.meta.total >= 1 && res.body.meta.totalPages >= 1)
    const montants = res.body.data.map((x) => x.montant)
    assert.deepEqual(montants, [...montants].sort((a, b) => b - a))
    assert.ok(res.body.meta.sommeValide > 0)
  })
  it("filtre par période (bornes incluses) et par montant", async () => {
    const res = await c.get("/cotisations?dateDebut=2025-06-24&dateFin=2025-06-24&montantMin=10&montantMax=100000")
    assert.ok(res.body.data.every((x) => x.dateOperation === "2025-06-24"))
    assert.equal((await c.get("/cotisations?dateDebut=2025-07-01&dateFin=2025-06-01")).status, 422)
  })
  it("refuse un tri non autorisé (pas d'injection de colonne)", async () => {
    assert.equal((await c.get("/cotisations?sort=montant;DROP TABLE contributions")).status, 422)
    assert.equal((await c.get("/cotisations?sort=montant&order=desc;--")).status, 422)
  })
})

describe("Comptes et mouvements", () => {
  it("recherche un compte par code ou nom", async () => {
    const result = await c.get("/comptes?q=BANQUE-1")
    assert.equal(result.status, 200)
    assert.equal(result.body.data.filter((account) => account.code === "BANQUE-1").length, 1)
  })

  it("le solde à une date et les mouvements paginés sont cohérents", async () => {
    const compte = (await c.post("/comptes", { code: "HISTO", nom: "Historique", type: "banque", soldeInitial: "10" })).body.data.id
    await c.post("/recettes", { rubriqueId: ids.recette, compteId: compte, montant: "100", dateOperation: "2025-01-10" })
    await c.post("/recettes", { rubriqueId: ids.recette, compteId: compte, montant: "50", dateOperation: "2025-02-10" })
    const jan = (await c.get(`/comptes/${compte}/solde?date=2025-01-31`)).body.data
    assert.equal(jan.solde, 110)
    assert.equal((await c.get(`/comptes/${compte}/solde`)).body.data.solde, 160)
    const mv = await c.get(`/comptes/${compte}/mouvements?limit=1`)
    assert.equal(mv.body.meta.total, 2)
    assert.equal(mv.body.data[0].dateOperation, "2025-02-10")
  })
  it("refuse un code de compte en double et un solde initial négatif non autorisé", async () => {
    assert.equal((await c.post("/comptes", { code: "HISTO", nom: "Doublon", type: "caisse" })).status, 409)
    assert.equal((await c.post("/comptes", { code: "NEG", nom: "Neg", type: "caisse", soldeInitial: "-5" })).status, 422)
  })
  it("préserve solde initial et mouvements lors de la modification des métadonnées", async () => {
    const account = (await c.post("/comptes", { code: "METADATA", nom: "Compte avant", type: "banque", banque: "Banque A", soldeInitial: "125.50" })).body.data
    await c.post("/recettes", { rubriqueId: ids.recette, compteId: account.id, montant: "10", dateOperation: "2025-01-01" })
    const updated = await c.put(`/comptes/${account.id}`, { nom: "Compte après", banque: "Banque B", numeroCompte: "12345" })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.soldeInitial, 125.5)
    assert.equal(updated.body.data.solde, 135.5)
    assert.equal((await c.get(`/comptes/${account.id}/mouvements`)).body.meta.total, 1)
  })
  it("conserve la consultation d’un compte désactivé mais refuse les nouvelles écritures", async () => {
    const account = (await c.post("/comptes", { code: "ARCHIVE-ACC", nom: "Compte historique", type: "caisse", soldeInitial: "20" })).body.data
    const revenue = await c.post("/recettes", { rubriqueId: ids.recette, compteId: account.id, montant: "5", dateOperation: "2025-01-01" })
    await c.patch(`/comptes/${account.id}/statut`, { actif: false })
    assert.equal((await c.get(`/comptes/${account.id}/solde`)).body.data.solde, 25)
    assert.equal((await c.get(`/comptes/${account.id}/mouvements`)).body.meta.total, 1)
    const refused = await c.post("/recettes", { rubriqueId: ids.recette, compteId: account.id, montant: "1", dateOperation: "2025-01-02" })
    assert.equal(refused.body.error.code, "COMPTE_INACTIF")
    assert.equal((await c.get(`/recettes/${revenue.body.data.id}`)).status, 200)
  })
  it("la synthèse de trésorerie sépare caisse, banque et consolidé", async () => {
    const res = await c.get("/tresorerie/synthese")
    assert.equal(res.status, 200)
    const { caisse, banque, consolidee } = res.body.data
    assert.equal(Math.round((caisse.totaux.soldeFinal + banque.totaux.soldeFinal) * 100), Math.round(consolidee.totaux.soldeFinal * 100))
  })
  it("INVARIANT : solde de chaque compte = solde initial + Σ mouvements, et mouvements = opérations", async () => {
    const [bad] = (
      await srv.pool.query(`
        SELECT a.code FROM financial_accounts a`)
    )[0].map((x) => x)
    assert.ok(bad)
    const [orphans] = await srv.pool.query(`
      SELECT 'contribution' t, o.id FROM contributions o WHERE o.statut='valide' AND NOT EXISTS (SELECT 1 FROM financial_movements m WHERE m.source_type='contribution' AND m.source_id=o.id AND m.nature='normal' AND m.montant=o.montant AND m.account_id=o.account_id)
      UNION ALL SELECT 'expense', o.id FROM expenses o WHERE o.statut='valide' AND NOT EXISTS (SELECT 1 FROM financial_movements m WHERE m.source_type='expense' AND m.source_id=o.id AND m.nature='normal' AND m.montant=o.montant AND m.account_id=o.account_id)
      UNION ALL SELECT 'revenue', o.id FROM revenues o WHERE o.statut='valide' AND NOT EXISTS (SELECT 1 FROM financial_movements m WHERE m.source_type='revenue' AND m.source_id=o.id AND m.nature='normal' AND m.montant=o.montant AND m.account_id=o.account_id)`)
    assert.deepEqual(orphans, [])
    const [negatives] = await srv.pool.query(`
      SELECT a.code, a.solde_initial + COALESCE(SUM(CASE m.sens WHEN 'entree' THEN m.montant ELSE -m.montant END),0) AS solde
      FROM financial_accounts a LEFT JOIN financial_movements m ON m.account_id=a.id
      WHERE a.autoriser_solde_negatif=0 GROUP BY a.id HAVING solde < 0`)
    assert.deepEqual(negatives, [])
    // l'API de solde donne la même valeur que le calcul SQL indépendant
    const accounts = (await c.get("/comptes")).body.data
    for (const a of accounts) {
      const [[sql]] = await srv.pool.query(
        `SELECT a.solde_initial + COALESCE(SUM(CASE m.sens WHEN 'entree' THEN m.montant ELSE -m.montant END),0) AS s FROM financial_accounts a LEFT JOIN financial_movements m ON m.account_id=a.id WHERE a.id=? GROUP BY a.id`,
        [a.id],
      )
      assert.equal(a.solde, Number(sql.s), `compte ${a.code}`)
    }
  })
})

describe("Journal d'audit", () => {
  it("trace création, modification et annulation avec l'utilisateur", async () => {
    const [logs] = await srv.pool.query("SELECT action, user_id FROM audit_logs WHERE entite_type='contribution' ORDER BY id")
    const actions = logs.map((l) => l.action)
    assert.ok(actions.includes("CREATE") && actions.includes("UPDATE") && actions.includes("CANCEL"))
    assert.ok(logs.every((l) => l.user_id))
  })
  it("ne journalise jamais de mot de passe", async () => {
    const [rows] = await srv.pool.query("SELECT COUNT(*) n FROM audit_logs WHERE anciennes_valeurs LIKE '%password%' OR nouvelles_valeurs LIKE '%password%' OR nouvelles_valeurs LIKE '%MotDePasse%'")
    assert.equal(Number(rows[0].n), 0)
  })
  it("expurge récursivement les secrets et conserve le request ID", async () => {
    await createAuditLog(null, {
      ctx: { user: { id: 1 }, requestId: "audit-request-1", ip: "127.0.0.1" },
      action: "TEST_SCRUB",
      entityType: "test-scrub",
      after: { commentaire: "sûr", nested: [{ password_hash: "hash-secret", apiKey: "api-secret", contenuFichier: "bytes", valeur: 2 }] },
    })
    const [[log]] = await srv.pool.query("SELECT nouvelles_valeurs, request_id FROM audit_logs WHERE entite_type='test-scrub' ORDER BY id DESC LIMIT 1")
    const payload = typeof log.nouvelles_valeurs === "string" ? JSON.parse(log.nouvelles_valeurs) : log.nouvelles_valeurs
    assert.equal(log.request_id, "audit-request-1")
    assert.equal(payload.commentaire, "sûr")
    assert.equal(payload.nested[0].password_hash, "[redacted]")
    assert.equal(payload.nested[0].apiKey, "[redacted]")
    assert.equal(payload.nested[0].contenuFichier, "[redacted]")
  })
})
