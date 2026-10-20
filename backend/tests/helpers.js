import "./env.js"
import fs from "node:fs/promises"
import mysql from "mysql2/promise"
import { env } from "../src/config/environment.js"

if (env.db.name !== "misericorde_divine_test") throw new Error("Garde-fou : les tests ne doivent jamais viser une autre base.")

export const ADMIN = { email: env.seed.email, motDePasse: "MotDePasseTest123" }

/** Recrée entièrement la base de test puis applique migrations et données de référence. */
export async function resetDatabase() {
  const root = await mysql.createConnection({ host: env.db.host, port: env.db.port, user: env.db.rootUser, password: env.db.rootPassword })
  await root.query(`DROP DATABASE IF EXISTS \`${env.db.name}\``)
  await root.query(`CREATE DATABASE \`${env.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  await root.end()
  await fs.rm(env.upload.dir, { recursive: true, force: true })
  const { pool } = await import("../src/config/database.js")
  const { runMigrations } = await import("../src/scripts/migrate.js")
  await runMigrations(pool)
  const { seedReferenceData } = await import("../src/scripts/seed.js")
  await seedReferenceData()
}

export async function startServer() {
  await resetDatabase()
  const { createApp } = await import("../src/app.js")
  const { pool } = await import("../src/config/database.js")
  const server = createApp().listen(0)
  await new Promise((resolve) => server.once("listening", resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  return {
    base,
    pool,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      await pool.end()
      await fs.rm(env.upload.dir, { recursive: true, force: true })
    },
  }
}

/** Client HTTP avec cookie de session. */
export class Client {
  constructor(base) {
    this.base = base
    this.cookie = null
  }

  async raw(method, path, { body, headers = {}, form } = {}) {
    const init = { method, headers: { ...headers } }
    if (this.cookie) init.headers.cookie = this.cookie
    if (form) {
      init.body = form
    } else if (body !== undefined) {
      init.headers["content-type"] = "application/json"
      init.body = JSON.stringify(body)
    }
    const res = await fetch(`${this.base}${path}`, init)
    const set = res.headers.get("set-cookie")
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? null : set.split(";")[0]
    return res
  }

  async json(method, path, options) {
    const res = await this.raw(method, path, options)
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return { status: res.status, body: data, headers: res.headers }
  }

  get(path, options) {
    return this.json("GET", path, options)
  }
  post(path, body, headers) {
    return this.json("POST", path, { body, headers })
  }
  put(path, body) {
    return this.json("PUT", path, { body })
  }
  patch(path, body) {
    return this.json("PATCH", path, { body })
  }
  del(path) {
    return this.json("DELETE", path)
  }

  async login(credentials = ADMIN) {
    const res = await this.post("/auth/login", credentials)
    if (res.status !== 200) throw new Error(`Connexion impossible : ${JSON.stringify(res.body)}`)
    return res
  }

  async bytes(path) {
    const res = await this.raw("GET", path)
    return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers }
  }
}

export async function loggedClient(base) {
  const client = new Client(base)
  await client.login()
  return client
}

/** Données de base : une rubrique, un membre, un compte par type. */
export async function baseFixtures(c) {
  const ids = {}
  const cat = async (kind, code) => (await c.get(`/rubriques/${kind}`)).body.data.find((x) => x.code === code).id
  ids.cotisation = await cat("cotisations", "COT-MENSUELLE")
  ids.recette = await cat("recettes", "REC-EXCEPT")
  ids.don = await cat("dons", "DON-LIBRE")
  ids.offrande = await cat("dons", "OFF-DOMINICALE")
  ids.depense = await cat("depenses", "DEP-FOURNITURES")
  const caisse = (await c.get("/comptes")).body.data.find((a) => a.code === "CAISSE")
  ids.caisse = caisse.id
  ids.banque = (await c.post("/comptes", { code: "BANQUE-1", nom: "Banque principale", type: "banque", soldeInitial: "1000.00" })).body.data.id
  ids.membre = (await c.post("/membres", { nom: "Mballa", prenom: "Marie", email: "marie@example.org", telephone: "+237600000001" })).body.data.id
  return ids
}

export const solde = async (c, accountId) => (await c.get(`/comptes/${accountId}/solde`)).body.data.solde
