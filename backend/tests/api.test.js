import assert from "node:assert/strict"
import { Readable } from "node:stream"
import { after, before, describe, it } from "node:test"
import ExcelJS from "exceljs"
import { ADMIN, baseFixtures, Client, loggedClient, solde, startServer } from "./helpers.js"

let srv, c, ids

before(async () => {
  srv = await startServer()
  c = await loggedClient(srv.base)
  ids = await baseFixtures(c)
})
after(async () => srv.close())

const q = async (sql, params) => (await srv.pool.query(sql, params))[0]

describe("Authentification et sessions", () => {
  it("refuse les routes sans session (401)", async () => {
    const anon = new Client(srv.base)
    for (const path of ["/membres", "/dashboard", "/cotisations", "/comptes", "/justificatifs", "/echanges", "/rapports/tresorerie", "/anomalies", "/parametres"]) {
      assert.equal((await anon.get(path)).status, 401, path)
    }
    assert.equal((await anon.get("/auth/me")).status, 401)
  })
  it("expose une route de santé publique sans fuite de secrets", async () => {
    const res = await new Client(srv.base).get("/sante")
    assert.equal(res.body.data.baseDeDonnees, "ok")
    assert.ok(!JSON.stringify(res.body).includes("03012002"))
  })
  it("refuse de mauvais identifiants sans révéler si le compte existe", async () => {
    const a = await new Client(srv.base).post("/auth/login", { email: ADMIN.email, motDePasse: "mauvais" })
    const b = await new Client(srv.base).post("/auth/login", { email: "inconnu@x.org", motDePasse: "mauvais" })
    assert.equal(a.status, 401)
    assert.equal(a.body.error.message, b.body.error.message)
  })
  it("connecte avec un cookie HttpOnly SameSite et ne renvoie aucune donnée sensible", async () => {
    const cl = new Client(srv.base)
    const res = await cl.login()
    const cookie = res.headers.get("set-cookie")
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Lax/i)
    assert.equal(res.body.data.user.password_hash, undefined)
    assert.equal((await cl.get("/auth/me")).body.data.user.email, ADMIN.email)
    const [{ n }] = await q("SELECT COUNT(*) n FROM sessions")
    assert.ok(Number(n) >= 1)
  })
  it("le mot de passe est stocké haché (bcrypt)", async () => {
    const [user] = await q("SELECT password_hash FROM users WHERE email=?", [ADMIN.email])
    assert.match(user.password_hash, /^\$2[aby]\$/)
  })
  it("la déconnexion invalide la session côté serveur", async () => {
    const cl = new Client(srv.base)
    await cl.login()
    const stolen = cl.cookie
    await cl.post("/auth/logout")
    const replay = new Client(srv.base)
    replay.cookie = stolen
    assert.equal((await replay.get("/auth/me")).status, 401)
  })
  it("une session expirée est refusée", async () => {
    const cl = new Client(srv.base)
    await cl.login()
    await srv.pool.query("UPDATE sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)")
    assert.equal((await cl.get("/auth/me")).status, 401)
    c = await loggedClient(srv.base)
  })
  it("un compte désactivé ne peut pas se connecter", async () => {
    await srv.pool.query("UPDATE users SET actif=0")
    assert.equal((await new Client(srv.base).post("/auth/login", ADMIN)).status, 403)
    await srv.pool.query("UPDATE users SET actif=1")
  })
  it("changement de mot de passe : ancien vérifié, sessions révoquées, nouveau hash", async () => {
    const cl = await loggedClient(srv.base)
    const other = await loggedClient(srv.base)
    assert.equal((await cl.put("/auth/password", { ancienMotDePasse: "faux", nouveauMotDePasse: "NouveauMotDePasse1" })).status, 422)
    assert.equal((await cl.put("/auth/password", { ancienMotDePasse: ADMIN.motDePasse, nouveauMotDePasse: "court" })).status, 422)
    assert.equal((await cl.put("/auth/password", { ancienMotDePasse: ADMIN.motDePasse, nouveauMotDePasse: "NouveauMotDePasse1" })).status, 200)
    assert.equal((await other.get("/auth/me")).status, 401)
    assert.equal((await cl.get("/auth/me")).status, 200)
    assert.equal((await new Client(srv.base).post("/auth/login", ADMIN)).status, 401)
    assert.equal((await new Client(srv.base).post("/auth/login", { email: ADMIN.email, motDePasse: "NouveauMotDePasse1" })).status, 200)
    await cl.put("/auth/password", { ancienMotDePasse: "NouveauMotDePasse1", nouveauMotDePasse: ADMIN.motDePasse })
    c = await loggedClient(srv.base)
  })
  it("rejette une requête d'écriture venant d'une origine étrangère (CSRF)", async () => {
    const res = await c.json("POST", "/membres", { body: { nom: "Pirate", prenom: "X" }, headers: { origin: "https://evil.example" } })
    assert.equal(res.status, 403)
    assert.equal((await q("SELECT COUNT(*) n FROM members WHERE nom='Pirate'"))[0].n, 0)
  })
})

describe("Membres : CRUD, unicité, archivage, persistance", () => {
  let id
  it("crée un membre avec référence serveur", async () => {
    const res = await c.post("/membres", { nom: "  Ndongo ", prenom: "Paul", sexe: "M", email: "PAUL@Example.org", telephone: "+237611111111", dateAdhesion: "2024-01-15" })
    assert.equal(res.status, 201)
    id = res.body.data.id
    assert.match(res.body.data.reference, /^MB-\d{6}$/)
    assert.equal(res.body.data.nom, "Ndongo")
    assert.equal(res.body.data.email, "paul@example.org")
    const [row] = await q("SELECT * FROM members WHERE id=?", [id])
    assert.equal(row.statut, "actif")
    assert.equal(row.date_adhesion, "2024-01-15")
  })
  it("valide les champs obligatoires et le format e-mail", async () => {
    const res = await c.post("/membres", { prenom: "Sans nom", email: "pas-un-email" })
    assert.equal(res.status, 422)
    assert.ok(res.body.error.fields.nom && res.body.error.fields.email)
  })
  it("refuse les doublons e-mail / téléphone (409) sans rien insérer", async () => {
    const before = (await q("SELECT COUNT(*) n FROM members"))[0].n
    const res = await c.post("/membres", { nom: "Autre", prenom: "Paul", email: "paul@example.org" })
    assert.equal(res.status, 409)
    assert.ok(res.body.error.fields.email)
    assert.equal((await c.post("/membres", { nom: "Autre", prenom: "Paul", telephone: "+237611111111" })).status, 409)
    assert.equal((await q("SELECT COUNT(*) n FROM members"))[0].n, before)
  })
  it("modifie partiellement sans écraser les autres champs", async () => {
    const res = await c.put(`/membres/${id}`, { adresse: "Douala" })
    assert.equal(res.status, 200)
    assert.equal(res.body.data.adresse, "Douala")
    assert.equal(res.body.data.email, "paul@example.org")
    assert.equal(res.body.data.statut, "actif")
    assert.equal((await c.put(`/membres/${id}`, { email: null })).body.data.email, null)
  })
  it("lit, recherche, filtre, trie et pagine", async () => {
    assert.equal((await c.get(`/membres/${id}`)).body.data.nomComplet, "Paul Ndongo")
    assert.equal((await c.get("/membres/99999")).body.error.code, "MEMBRE_NOT_FOUND")
    assert.equal((await c.get("/membres/abc")).status, 400)
    for (let i = 0; i < 5; i++) await c.post("/membres", { nom: `Test${i}`, prenom: "Liste" })
    const page = await c.get("/membres?q=Liste&limit=2&page=2&sort=nom&order=asc")
    assert.equal(page.body.meta.total, 5)
    assert.equal(page.body.meta.totalPages, 3)
    assert.deepEqual(page.body.data.map((m) => m.nom), ["Test2", "Test3"])
    assert.equal((await c.get("/membres?sort=password")).status, 422)
    assert.equal((await c.get("/membres?limit=100000")).body.meta.limit, 200)
  })
  it("archive (jamais de suppression) et masque les archivés par défaut", async () => {
    const res = await c.patch(`/membres/${id}/statut`, { statut: "archive" })
    assert.equal(res.body.data.statut, "archive")
    assert.ok(!(await c.get("/membres?q=Ndongo")).body.data.some((m) => m.id === id))
    assert.ok((await c.get("/membres?q=Ndongo&statut=archive")).body.data.some((m) => m.id === id))
    assert.equal((await q("SELECT COUNT(*) n FROM members WHERE id=?", [id]))[0].n, 1)
    assert.equal((await c.patch(`/membres/${id}/statut`, { statut: "inconnu" })).status, 422)
    const refus = await c.post("/cotisations", { membreId: id, rubriqueId: ids.cotisation, compteId: ids.caisse, montant: "10", dateOperation: "2025-01-01" })
    assert.equal(refus.body.error.code, "MEMBRE_ARCHIVE")
  })
  it("opérations et synthèse financière d'un membre", async () => {
    await c.post("/cotisations", { membreId: ids.membre, rubriqueId: ids.cotisation, compteId: ids.caisse, montant: "100", dateOperation: "2025-02-01", periode: "2025-02" })
    await c.post("/cotisations", { membreId: ids.membre, rubriqueId: ids.cotisation, compteId: ids.caisse, montant: "50.50", dateOperation: "2025-03-01", periode: "2025-03" })
    await c.post("/dons", { membreId: ids.membre, rubriqueId: ids.don, compteId: ids.caisse, montant: "20", dateOperation: "2025-03-05" })
    const annulee = (await c.post("/cotisations", { membreId: ids.membre, rubriqueId: ids.cotisation, compteId: ids.caisse, montant: "999", dateOperation: "2025-03-06" })).body.data
    await c.post(`/cotisations/${annulee.id}/annulation`, { motif: "Erreur de saisie" })
    const ops = await c.get(`/membres/${ids.membre}/operations`)
    assert.equal(ops.body.meta.total, 4)
    const s = (await c.get(`/membres/${ids.membre}/synthese-financiere`)).body.data
    assert.equal(s.cotisations.total, 150.5)
    assert.equal(s.dons.total, 20)
    assert.equal(s.totalGeneral, 170.5)
    const filtered = (await c.get(`/membres/${ids.membre}/synthese-financiere?dateDebut=2025-03-01&dateFin=2025-03-31`)).body.data
    assert.equal(filtered.cotisations.total, 50.5)
    assert.equal((await c.get(`/membres/${ids.membre}/cotisations`)).body.data.length, 3)
  })
})

describe("Rubriques", () => {
  it("CRUD complet, désactivation et protection de l'historique", async () => {
    const created = await c.post("/rubriques/cotisations", { libelle: "Cotisation spéciale été", description: "Été" })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.code, "COTISATION-SPECIALE-ETE")
    const id = created.body.data.id
    assert.equal((await c.post("/rubriques/cotisations", { code: "COTISATION-SPECIALE-ETE", libelle: "Doublon" })).status, 409)
    assert.equal((await c.put(`/rubriques/cotisations/${id}`, { libelle: "Cotisation été 2025" })).body.data.libelle, "Cotisation été 2025")
    await c.post("/cotisations", { membreId: ids.membre, rubriqueId: id, compteId: ids.caisse, montant: "10", dateOperation: "2025-01-01" })
    assert.equal((await c.put(`/rubriques/cotisations/${id}`, { code: "AUTRE-CODE" })).body.error.code, "RUBRIQUE_UTILISEE")
    const list = (await c.get("/rubriques/cotisations")).body.data
    assert.equal(list.find((r) => r.id === id).utilisations, 1)
    assert.equal((await c.patch(`/rubriques/cotisations/${id}/statut`, { actif: false })).body.data.actif, false)
    assert.ok(!(await c.get("/rubriques/cotisations?actif=true")).body.data.some((r) => r.id === id))
    assert.equal((await c.del(`/rubriques/cotisations/${id}`)).status, 404, "pas de suppression physique exposée")
  })
  it("les 4 familles de rubriques sont gérées, les dons ont une nature", async () => {
    for (const kind of ["cotisations", "recettes", "dons", "depenses"]) {
      assert.equal((await c.get(`/rubriques/${kind}`)).status, 200)
    }
    const r = await c.post("/rubriques/dons", { libelle: "Dîme", nature: "offrande" })
    assert.equal(r.body.data.nature, "offrande")
    assert.equal((await c.post("/rubriques/depenses", { libelle: "x" })).status, 422)
  })
})

describe("Tableau de bord", () => {
  let compte
  before(async () => {
    compte = (await c.post("/comptes", { code: "DASH", nom: "Compte dashboard", type: "banque", soldeInitial: "1000" })).body.data.id
    const op = (kind, body) => c.post(`/${kind}`, { compteId: compte, dateOperation: "2025-04-10", ...body })
    await op("cotisations", { membreId: ids.membre, rubriqueId: ids.cotisation, montant: "300" })
    await op("recettes", { rubriqueId: ids.recette, montant: "200" })
    await op("dons", { rubriqueId: ids.don, montant: "100" })
    await op("depenses", { rubriqueId: ids.depense, montant: "150" })
    const cancel = (await op("recettes", { rubriqueId: ids.recette, montant: "5000" })).body.data
    await c.post(`/recettes/${cancel.id}/annulation`, { motif: "Annulée pour test" })
  })
  it("calcule les totaux côté serveur sur une période, hors opérations annulées", async () => {
    const d = (await c.get("/dashboard?dateDebut=2025-04-01&dateFin=2025-04-30")).body.data
    assert.equal(d.totalCotisations, 300)
    assert.equal(d.totalRecettes, 200)
    assert.equal(d.totalDons, 100)
    assert.equal(d.totalDepenses, 150)
    assert.equal(d.totalEntrees, 600)
    assert.equal(d.resultat, 450)
    assert.equal(d.situationDiocesaine.regleConfiguree, false)
    assert.equal(d.evolution.points.find((p) => p.mois === "2025-04").recettes, 600)
    assert.equal(d.repartitionRecettes.find((r) => r.nom === "Cotisations").pourcentage, 50)
    assert.ok(d.dernieresOperations.length > 0)
    assert.equal(d.repartitionDepenses[0].valeur, 150)
  })
  it("les totaux du tableau de bord correspondent à un calcul SQL indépendant", async () => {
    const d = (await c.get("/dashboard")).body.data
    const [[sql]] = await srv.pool.query(`SELECT
      (SELECT COALESCE(SUM(montant),0) FROM contributions WHERE statut='valide') AS cot,
      (SELECT COALESCE(SUM(montant),0) FROM revenues WHERE statut='valide') AS rec,
      (SELECT COALESCE(SUM(montant),0) FROM donations WHERE statut='valide') AS don,
      (SELECT COALESCE(SUM(montant),0) FROM expenses WHERE statut='valide') AS dep,
      (SELECT COALESCE(SUM(a.solde_initial),0) + (SELECT COALESCE(SUM(CASE sens WHEN 'entree' THEN montant ELSE -montant END),0) FROM financial_movements) FROM financial_accounts a) AS solde`)
    assert.equal(d.totalCotisations, Number(sql.cot))
    assert.equal(d.totalRecettes, Number(sql.rec))
    assert.equal(d.totalDons, Number(sql.don))
    assert.equal(d.totalDepenses, Number(sql.dep))
    assert.equal(d.soldeTotal, Number(sql.solde))
  })
  it("sépare solde de caisse et soldes bancaires et supporte une date de fin", async () => {
    const d = (await c.get("/dashboard")).body.data
    assert.equal(d.soldeCaisse + d.soldeBanque, d.soldeTotal)
    const past = (await c.get("/dashboard?dateFin=2000-01-01")).body.data
    assert.equal(past.comptes.find((a) => a.code === "DASH").solde, 1000)
  })
  it("refuse une période incohérente", async () => {
    assert.equal((await c.get("/dashboard?dateDebut=2025-05-01&dateFin=2025-04-01")).status, 422)
    assert.equal((await c.get("/dashboard?dateDebut=pas-une-date")).status, 422)
  })
})

describe("Contribution diocésaine", () => {
  let compte
  before(async () => {
    compte = (await c.post("/comptes", { code: "DIOC", nom: "Compte diocèse", type: "banque", soldeInitial: "100000" })).body.data.id
    await c.post("/cotisations", { membreId: ids.membre, rubriqueId: ids.cotisation, compteId: compte, montant: "1000.50", dateOperation: "2025-08-10" })
    await c.post("/cotisations", { membreId: ids.membre, rubriqueId: ids.cotisation, compteId: compte, montant: "2000", dateOperation: "2025-08-31" })
  })
  it("refuse le calcul tant que le taux et l'assiette ne sont pas configurés (règle métier non inventée)", async () => {
    const res = await c.post("/contribution-diocesaine/calcul", { dateDebut: "2025-08-01", dateFin: "2025-08-31" })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, "REGLE_DIOCESAINE_NON_CONFIGUREE")
  })
  it("calcule avec arrondi entier exact après configuration (bornes de période incluses)", async () => {
    assert.equal((await c.put("/parametres/generaux", { dioceseTaux: 10, dioceseAssiette: "cotisations" })).status, 200)
    const calc = (await c.post("/contribution-diocesaine/calcul", { dateDebut: "2025-08-01", dateFin: "2025-08-31" })).body.data
    assert.equal(calc.baseCalcul, 3000.5)
    assert.equal(calc.montantDu, 300.05)
    assert.equal(calc.resteAVerser, 300.05)
  })
  it("génère, enregistre le mouvement de sortie, empêche le double versement et annule", async () => {
    const period = { dateDebut: "2025-08-01", dateFin: "2025-08-31", compteId: compte, dateOperation: "2025-09-05" }
    const gen = await c.post("/contribution-diocesaine/generation", period)
    assert.equal(gen.status, 201)
    const d = gen.body.data.contribution
    assert.match(d.reference, /^DC-2025-\d{6}$/)
    assert.equal(d.montant, 300.05)
    assert.equal(d.taux, 10)
    assert.equal(await solde(c, compte), 100000 + 3000.5 - 300.05)
    assert.equal((await c.post("/contribution-diocesaine/generation", period)).body.error.code, "RIEN_A_VERSER")
    const related = (await c.get(`/contribution-diocesaine/${d.id}/operations`)).body.data
    assert.equal(related.operations.length, 2)
    assert.ok((await c.get(`/contribution-diocesaine?q=${encodeURIComponent(d.reference)}`)).body.data.some((item) => item.id === d.id))
    const summary = (await c.get("/contribution-diocesaine/synthese?dateDebut=2025-09-01&dateFin=2025-09-30")).body.data
    assert.equal(summary.totalVerse, 300.05)
    assert.equal(summary.nombre, 1)
    assert.equal((await c.get("/contribution-diocesaine")).body.meta.total, 1)
    assert.equal((await c.post(`/contribution-diocesaine/${d.id}/annulation`, { motif: "Erreur de période" })).body.data.statut, "annule")
    assert.equal(await solde(c, compte), 100000 + 3000.5)
    assert.equal((await c.post(`/contribution-diocesaine/${d.id}/annulation`, { motif: "Encore" })).status, 409)
  })
  it("création manuelle, validation de période et de montant", async () => {
    const ok = await c.post("/contribution-diocesaine", { compteId: compte, montant: "500", dateOperation: "2025-09-10", periodeDebut: "2025-07-01", periodeFin: "2025-07-31" })
    assert.equal(ok.status, 201)
    assert.equal((await c.post("/contribution-diocesaine", { compteId: compte, montant: "500", dateOperation: "2025-09-10", periodeDebut: "2025-08-01", periodeFin: "2025-07-31" })).status, 422)
    assert.equal((await c.post("/contribution-diocesaine", { compteId: compte, montant: "0", dateOperation: "2025-09-10", periodeDebut: "2025-07-01", periodeFin: "2025-07-31" })).status, 422)
  })
  it("arrondi commercial : 3 % de 0,50 → 0,02 (0,015 arrondi au supérieur)", async () => {
    const { applyRate } = await import("../src/services/diocese.js")
    assert.equal(applyRate(50, 3), 2)
    assert.equal(applyRate(49, 3), 1)
    assert.equal(applyRate(10000000000, 12.5), 1250000000)
  })
})

describe("Justificatifs", () => {
  let att, op
  const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
  const upload = (buffer, { name = "facture.pdf", type = "application/pdf", fields = {} } = {}) => {
    const form = new FormData()
    form.append("fichier", new Blob([buffer], { type }), name)
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return c.json("POST", "/justificatifs", { form })
  }
  before(async () => {
    op = (await c.post("/depenses", { rubriqueId: ids.depense, compteId: ids.banque, montant: "10", dateOperation: "2025-06-01", tiers: "Fournisseur" })).body.data
  })
  it("téléverse un PDF, l'associe à l'opération et stocke un nom non prévisible", async () => {
    const res = await upload(pdf(), { fields: { description: "Facture juin", operationType: "expense", operationId: String(op.id) } })
    assert.equal(res.status, 201)
    att = res.body.data
    assert.equal(att.nom, "facture.pdf")
    assert.deepEqual(att.operations, [{ type: "expense", id: op.id }])
    const [row] = await q("SELECT * FROM attachments WHERE id=?", [att.id])
    assert.match(row.storage_key, /^[a-f0-9]{48}\.pdf$/)
    assert.equal(row.sha256.length, 64)
    assert.equal(JSON.stringify(res.body).includes(row.storage_key), false, "le chemin interne n'est jamais exposé")
  })
  it("liste, lit et retrouve les justificatifs d'une opération", async () => {
    assert.equal((await c.get("/justificatifs?q=facture")).body.meta.total, 1)
    assert.equal((await c.get(`/operations/depenses/${op.id}/justificatifs`)).body.data.length, 1)
    assert.equal((await c.get(`/depenses/${op.id}`)).body.data.justificatifs.length, 1)
  })
  it("télécharge le fichier exact avec les en-têtes de sécurité", async () => {
    const res = await c.bytes(`/justificatifs/${att.id}/telechargement`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.buffer, pdf())
    assert.equal(res.headers.get("x-content-type-options"), "nosniff")
    assert.match(res.headers.get("content-disposition"), /attachment/)
  })
  it("refuse les types dangereux, les faux PDF et les fichiers trop gros", async () => {
    assert.equal((await upload(Buffer.from("<script>alert(1)</script>"), { name: "x.html", type: "text/html" })).status, 415)
    assert.equal((await upload(Buffer.from("MZ exécutable"), { name: "virus.pdf", type: "application/pdf" })).status, 415)
    assert.equal((await upload(Buffer.concat([pdf(), Buffer.alloc(11 * 1024 * 1024)]))).status, 413)
    assert.equal((await c.json("POST", "/justificatifs", { form: new FormData() })).status, 422)
    assert.equal((await q("SELECT COUNT(*) n FROM attachments"))[0].n, 1)
  })
  it("refuse une opération inexistante sans laisser de fichier orphelin", async () => {
    const res = await upload(pdf(), { fields: { operationType: "expense", operationId: "99999" } })
    assert.equal(res.status, 404)
    assert.equal((await q("SELECT COUNT(*) n FROM attachments"))[0].n, 1)
  })
  it("supprime le justificatif (métadonnées + fichier)", async () => {
    assert.equal((await c.del(`/justificatifs/${att.id}`)).status, 204)
    assert.equal((await c.get(`/justificatifs/${att.id}`)).status, 404)
    assert.equal((await c.bytes(`/justificatifs/${att.id}/telechargement`)).status, 404)
  })
})

describe("Recherche globale", () => {
  it("cherche dans toutes les catégories avec pagination et type de résultat", async () => {
    await c.post("/membres", { nom: "Zebulon", prenom: "Recherche" })
    await c.post("/depenses", { rubriqueId: ids.depense, compteId: ids.banque, montant: "1", dateOperation: "2025-06-01", libelle: "Achat zebulon", tiers: "Zebulon SARL" })
    const res = await c.get("/recherche?q=zebulon")
    assert.equal(res.status, 200)
    assert.ok(res.body.data.some((r) => r.type === "membre"))
    assert.ok(res.body.data.some((r) => r.type === "depense"))
    assert.ok(res.body.meta.parCategorie.membres >= 1)
    const only = await c.get("/recherche?q=zebulon&categories=membres")
    assert.ok(only.body.data.every((r) => r.type === "membre"))
  })
  it("valide la requête et résiste aux injections SQL / caractères génériques", async () => {
    assert.equal((await c.get("/recherche?q=a")).status, 422)
    assert.equal((await c.get("/recherche?q=zebulon&categories=secret")).status, 422)
    const inj = await c.get(`/recherche?q=${encodeURIComponent("' OR '1'='1")}`)
    assert.equal(inj.status, 200)
    assert.equal(inj.body.data.length, 0)
    const wild = await c.get(`/recherche?q=${encodeURIComponent("%%")}`)
    assert.equal(wild.body.data.length, 0)
    assert.equal((await c.get(`/membres?q=${encodeURIComponent("'; DROP TABLE members;--")}`)).status, 200)
    assert.ok((await q("SELECT COUNT(*) n FROM members"))[0].n > 0)
  })
})

describe("Échanges Excel / CSV", () => {
  it("réimporte un export Excel modifié : simulation sans écriture puis mise à jour financière persistante", async () => {
    const balanceBefore = await solde(c, ids.banque)
    const created = (await c.post("/depenses", {
      rubriqueId: ids.depense,
      compteId: ids.banque,
      montant: "25.00",
      dateOperation: "2025-06-11",
      libelle: "Import échange initial",
    })).body.data
    const workbookBytes = await c.bytes(`/echanges/depenses/export?format=xlsx&reference=${encodeURIComponent(created.reference)}`)
    assert.equal(workbookBytes.status, 200)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(workbookBytes.buffer)
    const sheet = workbook.worksheets[0]
    const columns = new Map()
    sheet.getRow(1).eachCell((cell, column) => columns.set(String(cell.value), column))
    const referenceColumn = columns.get("Référence")
    const amountColumn = columns.get("Montant")
    assert.ok(referenceColumn && amountColumn)
    let targetRow
    for (let row = 2; row <= sheet.rowCount; row++) {
      if (sheet.getRow(row).getCell(referenceColumn).text === created.reference) targetRow = sheet.getRow(row)
    }
    assert.ok(targetRow, "la ligne créée est dans l'export")
    targetRow.getCell(amountColumn).value = 40.75
    const editedBuffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const upload = new FormData()
    upload.append("fichier", new Blob([editedBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "recettes-retouche.xlsx")

    const preview = await c.json("POST", "/echanges/depenses/import?simulation=true", { form: upload })
    assert.equal(preview.status, 200)
    assert.equal(preview.body.data.statut, "simulation")
    assert.equal(preview.body.data.misesAJour, 1)
    assert.equal((await c.get(`/depenses?reference=${created.reference}`)).body.data[0].montant, 25)

    const apply = await c.json("POST", "/echanges/depenses/import?simulation=false", { form: upload })
    assert.equal(apply.status, 200)
    assert.equal(apply.body.data.misesAJour, 1)
    assert.equal(apply.body.data.creees, 0)
    const persisted = (await c.get(`/depenses?reference=${created.reference}`)).body.data[0]
    assert.equal(persisted.montant, 40.75)
    const [movement] = await q("SELECT montant FROM financial_movements WHERE source_type='expense' AND source_id=? AND nature='normal'", [created.id])
    assert.equal(Number(movement.montant), 40.75)
    const balanceAfterUpdate = await solde(c, ids.banque)
    assert.equal(balanceAfterUpdate, balanceBefore - 40.75)

    targetRow.getCell(amountColumn).value = 200000
    const invalidWorkbook = Buffer.from(await workbook.xlsx.writeBuffer())
    const invalidUpload = new FormData()
    invalidUpload.append("fichier", new Blob([invalidWorkbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "depenses-solde-insuffisant.xlsx")
    const rejected = await c.json("POST", "/echanges/depenses/import?simulation=false", { form: invalidUpload })
    assert.equal(rejected.status, 422)
    assert.equal(rejected.body.data.statut, "annule")
    assert.equal((await c.get(`/depenses?reference=${created.reference}`)).body.data[0].montant, 40.75)
    assert.equal(await solde(c, ids.banque), balanceAfterUpdate)
  })

  it("importe aussi un export CSV édité en mettant à jour le membre par référence", async () => {
    const member = (await c.post("/membres", { nom: "Avant", prenom: "CSV" })).body.data
    const exported = await c.bytes(`/echanges/membres/export?format=csv&q=${encodeURIComponent(member.reference)}`)
    assert.equal(exported.status, 200)
    const workbook = new ExcelJS.Workbook()
    const exportedCsv = exported.buffer.toString("utf8").replace(/^\uFEFF/, "")
    await workbook.csv.read(Readable.from([exportedCsv]), { parserOptions: { delimiter: ";" } })
    const sheet = workbook.worksheets[0]
    const columns = new Map()
    sheet.getRow(1).eachCell((cell, column) => columns.set(String(cell.value), column))
    const referenceColumn = columns.get("Référence")
    const nameColumn = columns.get("Nom")
    assert.ok(referenceColumn && nameColumn)
    for (let row = 2; row <= sheet.rowCount; row++) {
      if (sheet.getRow(row).getCell(referenceColumn).text === member.reference) sheet.getRow(row).getCell(nameColumn).value = "Après export"
    }
    const editedCsv = Buffer.from(await workbook.csv.writeBuffer())
    const upload = new FormData()
    upload.append("fichier", new Blob([editedCsv], { type: "text/csv" }), "membres-retouche.csv")
    const result = await c.json("POST", "/echanges/membres/import?simulation=false", { form: upload })
    assert.equal(result.status, 200)
    assert.equal(result.body.data.misesAJour, 1)
    assert.equal((await c.get(`/membres/${member.id}`)).body.data.nom, "Après export")
  })

  it("met à jour les comptes et rubriques par code, sans réinitialiser le solde initial", async () => {
    const account = (await c.post("/comptes", { code: "ECHANGE-1", nom: "Compte avant import", type: "banque", soldeInitial: "75.00" })).body.data
    const accountsFile = await c.bytes("/echanges/comptes/export?format=xlsx")
    const accountsBook = new ExcelJS.Workbook()
    await accountsBook.xlsx.load(accountsFile.buffer)
    const accountSheet = accountsBook.worksheets[0]
    const accountColumns = new Map()
    accountSheet.getRow(1).eachCell((cell, column) => accountColumns.set(String(cell.value), column))
    let accountRow
    for (let row = 2; row <= accountSheet.rowCount; row++) {
      if (accountSheet.getRow(row).getCell(accountColumns.get("Code")).text === "ECHANGE-1") accountRow = accountSheet.getRow(row)
    }
    assert.ok(accountRow)
    accountRow.getCell(accountColumns.get("Nom")).value = "Compte modifié par import"
    const accountUpload = new FormData()
    accountUpload.append("fichier", new Blob([Buffer.from(await accountsBook.xlsx.writeBuffer())]), "comptes-retouches.xlsx")
    const accountResult = await c.json("POST", "/echanges/comptes/import?simulation=false", { form: accountUpload })
    assert.equal(accountResult.status, 200)
    assert.ok(accountResult.body.data.misesAJour >= 1)
    const storedAccount = (await c.get(`/comptes/${account.id}`)).body.data
    assert.equal(storedAccount.nom, "Compte modifié par import")
    assert.equal(storedAccount.soldeInitial, 75)
    accountRow.getCell(accountColumns.get("Solde initial")).value = 1000
    const unsafeAccountUpload = new FormData()
    unsafeAccountUpload.append("fichier", new Blob([Buffer.from(await accountsBook.xlsx.writeBuffer())]), "comptes-solde-initial-modifie.xlsx")
    const unsafeAccountImport = await c.json("POST", "/echanges/comptes/import?simulation=false", { form: unsafeAccountUpload })
    assert.equal(unsafeAccountImport.status, 422)
    assert.equal(unsafeAccountImport.body.data.statut, "annule")
    assert.equal((await c.get(`/comptes/${account.id}`)).body.data.soldeInitial, 75)

    const categoryFile = await c.bytes("/echanges/rubriques-recettes/export?format=xlsx&q=REC-EXCEPT")
    const categoryBook = new ExcelJS.Workbook()
    await categoryBook.xlsx.load(categoryFile.buffer)
    const categorySheet = categoryBook.worksheets[0]
    const categoryColumns = new Map()
    categorySheet.getRow(1).eachCell((cell, column) => categoryColumns.set(String(cell.value), column))
    assert.equal(categorySheet.getRow(2).getCell(categoryColumns.get("Code")).text, "REC-EXCEPT")
    categorySheet.getRow(2).getCell(categoryColumns.get("Libellé")).value = "Recette modifiée par import"
    const categoryUpload = new FormData()
    categoryUpload.append("fichier", new Blob([Buffer.from(await categoryBook.xlsx.writeBuffer())]), "rubriques-retouchees.xlsx")
    const categoryResult = await c.json("POST", "/echanges/rubriques-recettes/import?simulation=false", { form: categoryUpload })
    assert.equal(categoryResult.status, 200)
    assert.equal(categoryResult.body.data.misesAJour, 1)
    const category = (await c.get("/rubriques/recettes?q=REC-EXCEPT")).body.data.find((item) => item.code === "REC-EXCEPT")
    assert.equal(category.libelle, "Recette modifiée par import")
  })
})

describe("Rapports et exports", () => {
  it("les rapports JSON reprennent exactement les mêmes données que les écrans", async () => {
    const rapport = (await c.get("/rapports/cotisations")).body.data
    const liste = await c.get("/cotisations?limit=200&statut=valide")
    const totalAffiche = liste.body.meta.sommeValide
    assert.equal(rapport.totaux[0].valeur, totalAffiche)
    assert.equal(rapport.lignes.length, (await c.get("/cotisations?limit=1")).body.meta.total)
  })
  it("exporte chaque rapport en CSV, Excel et PDF", async () => {
    for (const type of ["cotisations", "recettes", "dons", "depenses", "tresorerie", "contribution-diocesaine", "synthese-financiere", "historique-operations"]) {
      const json = await c.get(`/rapports/${type}`)
      assert.equal(json.status, 200, type)
      const csv = await c.bytes(`/rapports/${type}/export?format=csv`)
      assert.equal(csv.status, 200, type)
      assert.equal(csv.buffer.subarray(0, 3).toString("hex"), "efbbbf", "BOM UTF-8")
      const xlsx = await c.bytes(`/rapports/${type}/export?format=xlsx`)
      assert.equal(xlsx.buffer.subarray(0, 2).toString(), "PK", type)
      const pdf = await c.bytes(`/rapports/${type}/export?format=pdf`)
      assert.equal(pdf.buffer.subarray(0, 5).toString(), "%PDF-", type)
    }
    assert.equal((await c.get("/rapports/inconnu")).status, 404)
    assert.equal((await c.get("/rapports/tresorerie/export?format=docx")).status, 422)
  })
  it("la trésorerie : ouverture + entrées − sorties = solde final", async () => {
    const t = (await c.get("/rapports/tresorerie")).body.data
    for (const l of t.lignes) {
      assert.equal(Math.round((l.soldeOuverture + l.entrees - l.sorties) * 100), Math.round(l.soldeFinal * 100), l.code)
    }
  })
})

describe("Anomalies", () => {
  it("n'applique que les contrôles documentés et détecte une incohérence réelle", async () => {
    assert.ok((await c.get("/anomalies/regles")).body.data.length >= 5)
    const first = (await c.post("/anomalies/analyse")).body.data
    const op = (await c.post("/depenses", { rubriqueId: ids.depense, compteId: ids.banque, montant: "3", dateOperation: "2025-06-02" })).body.data
    // Corruption volontaire : on supprime le mouvement directement en base.
    await srv.pool.query("DELETE FROM financial_movements WHERE source_type='expense' AND source_id=?", [op.id])
    const run = (await c.post("/anomalies/analyse")).body.data
    assert.equal(run.creees, first.creees + 1 - first.creees || run.creees, "au moins la nouvelle anomalie")
    const list = (await c.get("/anomalies?statut=ouverte")).body.data
    const found = list.find((a) => a.code === "OPERATION_SANS_MOUVEMENT" && a.entiteId === op.id)
    assert.ok(found, "OPERATION_SANS_MOUVEMENT détectée")
    assert.ok((await c.get("/anomalies?q=OPERATION_SANS_MOUVEMENT")).body.data.some((item) => item.id === found.id))
    assert.equal(found.gravite, "critique")
    // Idempotence de l'analyse : pas de doublon.
    await c.post("/anomalies/analyse")
    assert.equal((await q("SELECT COUNT(*) n FROM anomalies WHERE code='OPERATION_SANS_MOUVEMENT' AND entite_id=?", [op.id]))[0].n, 1)
    // Workflow de statut + historique.
    assert.equal((await c.patch(`/anomalies/${found.id}/statut`, { statut: "en_cours", commentaire: "Analyse" })).body.data.statut, "en_cours")
    assert.equal((await c.patch(`/anomalies/${found.id}/statut`, { statut: "en_cours" })).status, 409)
    // Correction réelle → clôture automatique.
    await srv.pool.query(
      "INSERT INTO financial_movements (account_id, sens, montant, date_operation, source_type, source_id, reference) SELECT account_id,'sortie',montant,date_operation,'expense',id,reference FROM expenses WHERE id=?",
      [op.id],
    )
    await c.post("/anomalies/analyse")
    const after = (await c.get(`/anomalies/${found.id}`)).body.data
    assert.equal(after.statut, "resolue")
    assert.ok(after.historique.length >= 3)
  })
  it("résolution manuelle avec commentaire obligatoire", async () => {
    await srv.pool.query("INSERT INTO anomalies (code, gravite, message, empreinte) VALUES ('TEST','info','Test manuel', SHA2('test-manuel',256))")
    const id = (await q("SELECT id FROM anomalies WHERE code='TEST'"))[0].id
    assert.equal((await c.post(`/anomalies/${id}/resolution`, { resolution: "" })).status, 422)
    const res = await c.post(`/anomalies/${id}/resolution`, { resolution: "Vérifié par le trésorier" })
    assert.equal(res.body.data.statut, "resolue")
    assert.equal(res.body.data.resolution, "Vérifié par le trésorier")
    assert.equal((await c.get("/anomalies/999999")).status, 404)
  })
})

describe("Paramètres et aide", () => {
  it("lit et met à jour les paramètres généraux et préférences de façon persistante", async () => {
    const put = await c.put("/parametres/generaux", { nomOrganisation: "Miséricorde Divine Test", devise: "XAF" })
    assert.equal(put.body.data.nomOrganisation, "Miséricorde Divine Test")
    assert.equal((await c.get("/parametres")).body.data.generaux.devise, "XAF")
    assert.equal((await c.put("/parametres/generaux", { dioceseTaux: 150 })).status, 422)
    assert.equal((await c.put("/parametres/preferences", { theme: "sombre", lignesParPage: 50 })).body.data.lignesParPage, 50)
    assert.equal((await c.get("/parametres/preferences")).body.data.theme, "sombre")
    assert.equal((await c.put("/parametres/preferences", { theme: "fluo" })).status, 422)
    const [row] = await q("SELECT valeur FROM settings WHERE cle='general'")
    assert.ok(JSON.stringify(row.valeur).includes("XAF"))
    assert.equal((await c.get("/parametres")).body.data.securiteSession.cookieHttpOnly, true)
  })
  it("fournit l'aide", async () => {
    const list = (await c.get("/aide")).body.data
    assert.ok(list.length >= 5)
    assert.ok((await c.get(`/aide/${list[0].slug}`)).body.data.contenu.length > 0)
    assert.equal((await c.get("/aide/inconnue")).status, 404)
  })
})

describe("Persistance après redémarrage du serveur", () => {
  it("les données écrites sont relues à l'identique par une nouvelle instance avec une nouvelle session", async () => {
    const before = (await c.get("/dashboard")).body.data
    const soldeAvant = (await c.get("/comptes")).body.data.map((a) => [a.code, a.solde])
    const { createApp } = await import("../src/app.js")
    const second = createApp().listen(0)
    await new Promise((r) => second.once("listening", r))
    const fresh = await loggedClient(`http://127.0.0.1:${second.address().port}/api`)
    const after = (await fresh.get("/dashboard")).body.data
    assert.equal(after.totalCotisations, before.totalCotisations)
    assert.equal(after.soldeTotal, before.soldeTotal)
    assert.deepEqual((await fresh.get("/comptes")).body.data.map((a) => [a.code, a.solde]), soldeAvant)
    await new Promise((r) => second.close(r))
  })
})

describe("Gestion d'erreurs", () => {
  it("renvoie un format d'erreur homogène, sans détail SQL ni stack", async () => {
    const res = await c.get("/n-existe-pas")
    assert.equal(res.status, 404)
    assert.equal(res.body.success, false)
    assert.ok(res.body.error.requestId)
    const bad = await c.json("POST", "/membres", { headers: { "content-type": "application/json" }, body: undefined })
    assert.ok([400, 422].includes(bad.status))
    const raw = await c.raw("POST", "/membres", { headers: { "content-type": "application/json" }, form: "{pas du json" })
    assert.equal(raw.status, 400)
    assert.ok(!JSON.stringify(await raw.json()).match(/SELECT|INSERT|stack|node_modules/i))
  })
})
