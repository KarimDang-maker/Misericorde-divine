import { createHash } from "node:crypto"
import { z } from "zod"
import { one, rows, run, withTransaction } from "../config/database.js"
import { conflict, notFound, unprocessable } from "../utils/errors.js"
import { likePattern, normalizeSearchTerm, paginationMeta } from "../utils/pagination.js"
import { createAuditLog } from "./audit.js"

export const ANOMALY_STATUSES = ["ouverte", "en_cours", "resolue", "ignoree"]
export const anomalyStatusSchema = z.object({
  statut: z.enum(ANOMALY_STATUSES),
  commentaire: z.string().trim().max(500).nullish().transform((v) => v || null),
})
export const anomalyResolutionSchema = z.object({ resolution: z.string().trim().min(3, "Obligatoire").max(500) })

const OPERATION_TABLES = [
  ["contribution", "contributions"],
  ["revenue", "revenues"],
  ["donation", "donations"],
  ["expense", "expenses"],
  ["diocesan", "diocesan_contributions"],
]

/** Documentation des contrôles : seules ces règles génèrent des anomalies. */
export const ANOMALY_RULES = [
  { code: "OPERATION_SANS_MOUVEMENT", gravite: "critique", description: "Une opération validée n'a aucun mouvement de compte." },
  { code: "ECART_MOUVEMENT", gravite: "critique", description: "Le montant, le compte ou la date du mouvement diffère de l'opération validée." },
  { code: "ANNULATION_SANS_CONTRE_ECRITURE", gravite: "critique", description: "Une opération annulée n'a pas de contre-écriture." },
  { code: "SOLDE_NEGATIF", gravite: "critique", description: "Un compte interdisant le découvert a un solde négatif." },
  { code: "DOUBLON_COTISATION", gravite: "avertissement", description: "Plusieurs cotisations validées identiques (membre, rubrique, période, montant)." },
  { code: "DIOCESE_PERIODES_CHEVAUCHANTES", gravite: "avertissement", description: "Deux contributions diocésaines validées couvrent des périodes qui se chevauchent." },
  { code: "COMPTE_INACTIF_AVEC_SOLDE", gravite: "info", description: "Un compte désactivé a encore un solde non nul." },
]

const fingerprint = (...parts) => createHash("sha256").update(parts.join("|")).digest("hex")

async function detect() {
  const found = []
  const add = (code, gravite, entite_type, entite_id, message, key = "") =>
    found.push({ code, gravite, entite_type, entite_id, message, empreinte: fingerprint(code, entite_type, entite_id, key) })

  for (const [type, table] of OPERATION_TABLES) {
    const noMovement = await rows(
      null,
      `SELECT o.id, o.reference FROM ${table} o WHERE o.statut = 'valide' AND NOT EXISTS
         (SELECT 1 FROM financial_movements m WHERE m.source_type = ? AND m.source_id = o.id AND m.nature = 'normal')`,
      [type],
    )
    for (const r of noMovement) add("OPERATION_SANS_MOUVEMENT", "critique", type, r.id, `${r.reference} : aucun mouvement de compte.`)

    const gaps = await rows(
      null,
      `SELECT o.id, o.reference FROM ${table} o JOIN financial_movements m
         ON m.source_type = ? AND m.source_id = o.id AND m.nature = 'normal'
       WHERE o.statut = 'valide' AND (m.montant <> o.montant OR m.account_id <> o.account_id OR m.date_operation <> o.date_operation)`,
      [type],
    )
    for (const r of gaps) add("ECART_MOUVEMENT", "critique", type, r.id, `${r.reference} : le mouvement ne correspond pas à l'opération.`)

    const missingReversal = await rows(
      null,
      `SELECT o.id, o.reference FROM ${table} o WHERE o.statut = 'annule' AND NOT EXISTS
         (SELECT 1 FROM financial_movements m WHERE m.source_type = ? AND m.source_id = o.id AND m.nature = 'contre_ecriture')`,
      [type],
    )
    for (const r of missingReversal) {
      add("ANNULATION_SANS_CONTRE_ECRITURE", "critique", type, r.id, `${r.reference} : annulée sans contre-écriture.`)
    }
  }

  const accounts = await rows(
    null,
    `SELECT a.id, a.nom, a.actif, a.autoriser_solde_negatif,
            a.solde_initial + COALESCE(SUM(CASE m.sens WHEN 'entree' THEN m.montant ELSE -m.montant END),0) AS solde
     FROM financial_accounts a LEFT JOIN financial_movements m ON m.account_id = a.id GROUP BY a.id`,
  )
  for (const a of accounts) {
    if (Number(a.solde) < 0 && !a.autoriser_solde_negatif) {
      add("SOLDE_NEGATIF", "critique", "account", a.id, `Le compte « ${a.nom} » a un solde négatif (${a.solde}).`)
    }
    if (!a.actif && Number(a.solde) !== 0) {
      add("COMPTE_INACTIF_AVEC_SOLDE", "info", "account", a.id, `Le compte désactivé « ${a.nom} » a un solde de ${a.solde}.`)
    }
  }

  const duplicates = await rows(
    null,
    `SELECT MIN(id) AS id, COUNT(*) AS n, member_id, category_id, periode, montant FROM contributions
     WHERE statut = 'valide' AND periode IS NOT NULL GROUP BY member_id, category_id, periode, montant HAVING COUNT(*) > 1`,
  )
  for (const d of duplicates) {
    add(
      "DOUBLON_COTISATION",
      "avertissement",
      "contribution",
      d.id,
      `${d.n} cotisations identiques (période ${d.periode}, montant ${d.montant}) pour le même membre.`,
      `${d.member_id}-${d.category_id}-${d.periode}-${d.montant}`,
    )
  }

  const overlaps = await rows(
    null,
    `SELECT a.id AS id_a, a.reference AS ref_a, b.id AS id_b, b.reference AS ref_b FROM diocesan_contributions a
     JOIN diocesan_contributions b ON a.id < b.id AND a.statut='valide' AND b.statut='valide'
       AND a.periode_debut <= b.periode_fin AND b.periode_debut <= a.periode_fin
       AND NOT (a.periode_debut = b.periode_debut AND a.periode_fin = b.periode_fin)`,
  )
  for (const o of overlaps) {
    add("DIOCESE_PERIODES_CHEVAUCHANTES", "avertissement", "diocesan", o.id_a, `${o.ref_a} et ${o.ref_b} se chevauchent.`, String(o.id_b))
  }
  return found
}

/** Relance tous les contrôles : crée les nouvelles anomalies, rouvre celles qui persistent, clôt celles corrigées. */
export async function runAnomalyChecks(ctx) {
  const detected = await detect()
  return withTransaction(async (conn) => {
    let created = 0
    let reopened = 0
    for (const item of detected) {
      const existing = await one(conn, "SELECT id, statut FROM anomalies WHERE empreinte = ? FOR UPDATE", [item.empreinte])
      if (!existing) {
        const inserted = await run(
          conn,
          "INSERT INTO anomalies (code, gravite, entite_type, entite_id, message, empreinte) VALUES (?, ?, ?, ?, ?, ?)",
          [item.code, item.gravite, item.entite_type, item.entite_id, item.message, item.empreinte],
        )
        await run(conn, "INSERT INTO anomaly_history (anomaly_id, ancien_statut, nouveau_statut, commentaire) VALUES (?, NULL, 'ouverte', 'Détectée')", [inserted.insertId])
        created++
      } else if (existing.statut === "resolue") {
        await run(conn, "UPDATE anomalies SET statut='ouverte', resolue_le=NULL, message=? WHERE id=?", [item.message, existing.id])
        await run(conn, "INSERT INTO anomaly_history (anomaly_id, ancien_statut, nouveau_statut, commentaire) VALUES (?, 'resolue', 'ouverte', 'Anomalie toujours présente')", [existing.id])
        reopened++
      }
    }
    const active = new Set(detected.map((d) => d.empreinte))
    const open = await rows(conn, "SELECT id, empreinte, statut FROM anomalies WHERE statut IN ('ouverte','en_cours')")
    let autoResolved = 0
    for (const row of open) {
      if (active.has(row.empreinte)) continue
      await run(conn, "UPDATE anomalies SET statut='resolue', resolution='Corrigée (contrôle automatique)', resolue_le=UTC_TIMESTAMP() WHERE id=?", [row.id])
      await run(conn, "INSERT INTO anomaly_history (anomaly_id, ancien_statut, nouveau_statut, commentaire) VALUES (?, ?, 'resolue', 'Corrigée (contrôle automatique)')", [row.id, row.statut])
      autoResolved++
    }
    await createAuditLog(conn, { ctx, action: "ANALYSE", entityType: "anomalies", after: { detectees: detected.length, created, reopened, autoResolved } })
    return { detectees: detected.length, creees: created, rouvertes: reopened, resoluesAutomatiquement: autoResolved }
  })
}

export async function createAnomaly(data, conn) {
  const empreinte = fingerprint(data.code, data.entite_type ?? "", data.entite_id ?? "", data.message)
  const result = await run(
    conn,
    "INSERT IGNORE INTO anomalies (code, gravite, entite_type, entite_id, message, empreinte) VALUES (?, ?, ?, ?, ?, ?)",
    [data.code, data.gravite ?? "avertissement", data.entite_type ?? null, data.entite_id ?? null, data.message, empreinte],
  )
  return result.insertId
}

const fromRow = (r) => ({
  id: r.id,
  code: r.code,
  gravite: r.gravite,
  entiteType: r.entite_type,
  entiteId: r.entite_id,
  message: r.message,
  statut: r.statut,
  resolution: r.resolution,
  detecteeLe: r.detectee_le,
  resolueLe: r.resolue_le,
})

export async function listAnomalies(filters, pagination) {
  const where = []
  const params = []
  for (const [field, column, allowed] of [
    ["statut", "statut", ANOMALY_STATUSES],
    ["gravite", "gravite", ["info", "avertissement", "critique"]],
  ]) {
    if (filters[field]) {
      if (!allowed.includes(filters[field])) {
        throw unprocessable("FILTRE_INVALIDE", `${field} invalide.`, { [field]: "Valeur inconnue" })
      }
      where.push(`${column} = ?`)
      params.push(filters[field])
    }
  }
  if (filters.code) {
    where.push("code = ?")
    params.push(String(filters.code))
  }
  const term = normalizeSearchTerm(filters.q)
  if (term) {
    const like = likePattern(term)
    where.push("(code LIKE ? OR message LIKE ? OR entite_type LIKE ? OR CAST(entite_id AS CHAR) LIKE ?)")
    params.push(like, like, like, like)
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const total = await one(null, `SELECT COUNT(*) AS n FROM anomalies ${clause}`, params)
  const list = await rows(
    null,
    `SELECT * FROM anomalies ${clause} ORDER BY FIELD(statut,'ouverte','en_cours','resolue','ignoree'),
       FIELD(gravite,'critique','avertissement','info'), id DESC LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  )
  return { items: list.map(fromRow), meta: paginationMeta(pagination, Number(total.n)) }
}

export async function getAnomalyById(id, executor = null) {
  const row = await one(executor, "SELECT * FROM anomalies WHERE id = ?", [id])
  if (!row) throw notFound("ANOMALIE_NOT_FOUND", "L'anomalie est introuvable.")
  const history = await rows(executor, "SELECT * FROM anomaly_history WHERE anomaly_id = ? ORDER BY id", [id])
  return {
    ...fromRow(row),
    historique: history.map((h) => ({
      ancienStatut: h.ancien_statut,
      nouveauStatut: h.nouveau_statut,
      commentaire: h.commentaire,
      date: h.created_at,
    })),
  }
}

export async function updateAnomalyStatus(id, statut, commentaire, ctx) {
  return withTransaction(async (conn) => {
    const row = await one(conn, "SELECT * FROM anomalies WHERE id = ? FOR UPDATE", [id])
    if (!row) throw notFound("ANOMALIE_NOT_FOUND", "L'anomalie est introuvable.")
    if (row.statut === statut) throw conflict("STATUT_INCHANGE", "L'anomalie a déjà ce statut.")
    await run(conn, "UPDATE anomalies SET statut = ?, resolue_le = ? WHERE id = ?", [
      statut,
      statut === "resolue" ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
      id,
    ])
    await run(conn, "INSERT INTO anomaly_history (anomaly_id, ancien_statut, nouveau_statut, commentaire, user_id) VALUES (?, ?, ?, ?, ?)", [
      id,
      row.statut,
      statut,
      commentaire,
      ctx?.user?.id ?? null,
    ])
    await createAuditLog(conn, { ctx, action: "STATUS", entityType: "anomaly", entityId: id, before: { statut: row.statut }, after: { statut } })
    return getAnomalyById(id, conn)
  })
}

export async function resolveAnomaly(id, resolution, ctx) {
  const updated = await updateAnomalyStatus(id, "resolue", resolution, ctx)
  await run(null, "UPDATE anomalies SET resolution = ? WHERE id = ?", [resolution, id])
  return { ...updated, resolution }
}
