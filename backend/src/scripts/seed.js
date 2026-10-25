import path from "node:path"
import { fileURLToPath } from "node:url"
import { pool, one, run } from "../config/database.js"
import { env } from "../config/environment.js"
import { createUser } from "../services/auth.js"
import { createCategory } from "../services/categories.js"
import { runMigrations } from "./migrate.js"

/** Données de référence minimales (aucune opération financière fictive). Idempotent. */
const CATEGORIES = {
  cotisations: [
    ["COT-MENSUELLE", "Cotisation mensuelle"],
    ["COT-ANNUELLE", "Cotisation annuelle"],
  ],
  recettes: [
    ["REC-EXCEPT", "Recette exceptionnelle"],
    ["REC-VENTE", "Vente"],
  ],
  dons: [
    ["DON-LIBRE", "Don libre", "don"],
    ["OFF-DOMINICALE", "Offrande dominicale", "offrande"],
  ],
  depenses: [
    ["DEP-FOURNITURES", "Fournitures administratives"],
    ["DEP-LOYER", "Loyer"],
    ["DEP-CHARGES", "Charges (eau, électricité)"],
  ],
}

export async function seedReferenceData() {
  const created = { utilisateur: false, rubriques: 0, comptes: 0 }
  const kinds = { cotisations: "contribution_categories", recettes: "revenue_categories", dons: "donation_categories", depenses: "expense_categories" }
  for (const [kind, list] of Object.entries(CATEGORIES)) {
    for (const [code, libelle, nature] of list) {
      if (await one(null, `SELECT id FROM ${kinds[kind]} WHERE code = ?`, [code])) continue
      await createCategory(kind, { code, libelle, description: null, nature }, null)
      created.rubriques++
    }
  }
  if (!(await one(null, "SELECT id FROM financial_accounts WHERE code = 'CAISSE'"))) {
    await run(null, "INSERT INTO financial_accounts (code, nom, type, solde_initial) VALUES ('CAISSE', 'Caisse principale', 'caisse', 0)")
    created.comptes++
  }
  const adminEmail = env.seed.email.toLowerCase()
  if (!(await one(null, "SELECT id FROM users WHERE email = ?", [adminEmail]))) {
    if (!env.seed.password || env.seed.password.length < 8) {
      throw new Error("SEED_ADMIN_PASSWORD (8 caractères min.) est requis pour créer le compte initial.")
    }
    const id = await createUser({ email: adminEmail, nom: env.seed.name, password: env.seed.password })
    await run(null, "UPDATE users SET role='admin' WHERE id=?", [id])
    created.utilisateur = true
  }
  await run(null, "UPDATE users SET role='admin' WHERE email=?", [adminEmail])
  return created
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMigrations(pool)
  console.log("Données de référence :", await seedReferenceData())
  await pool.end()
}
