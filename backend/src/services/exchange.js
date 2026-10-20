import { Readable } from "node:stream"
import ExcelJS from "exceljs"
import { ZodError } from "zod"
import { one, withTransaction, run } from "../config/database.js"
import { AppError, notFound, unprocessable } from "../utils/errors.js"
import { excelDateToIso } from "../utils/dates.js"
import { toCents, fromCents } from "../utils/money.js"
import { createAuditLog } from "./audit.js"
import { buildCsv, buildWorkbook } from "./tabular.js"
import { createAccount, accountSchema, accountUpdateSchema, listAccounts, listAllMovements, findAccountByCode, setAccountActive, updateAccount } from "./accounts.js"
import { CATEGORY_KINDS, categorySchema, createCategory, findCategoryByCode, listCategories, setCategoryActive, updateCategory } from "./categories.js"
import { listAllDiocesanContributions } from "./diocese.js"
import { createMember, listAllMembers, memberSchema, updateMember } from "./members.js"
import { OPERATION_TYPES, createOperation, createSchemaFor, listAllOperations, updateOperation } from "./operations.js"

/**
 * Échanges Excel/CSV : un seul format par ressource, utilisé à l'export ET à l'import.
 * Un fichier exporté peut donc être modifié hors de l'application puis réimporté tel quel.
 */

// Keep round-trip imports aligned with the operation export limit.
const MAX_IMPORT_ROWS = 50000

const normalize = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")

// ---------- Définition des colonnes ----------

const col = (key, header, type = "text", extra = {}) => ({ key, header, type, ...extra })

function operationColumns(config) {
  const cols = [
    col("reference", "Référence", "text", { width: 18 }),
    col("dateOperation", "Date", "date", { required: true, width: 13 }),
  ]
  if (config.member !== "none") {
    cols.push(
      col("membreReference", "Membre (réf.)", "text", { required: config.member === "required", width: 16, aliases: ["Membre ref", "Reference membre"] }),
      col("membre", "Membre (nom)", "text", { info: true, width: 24 }),
    )
  }
  cols.push(
    col("rubriqueCode", "Rubrique (code)", "text", { required: true, width: 22, aliases: ["Rubrique", "Code rubrique"] }),
    col("rubrique", "Rubrique (libellé)", "text", { info: true, width: 26 }),
    col("compteCode", "Compte (code)", "text", { required: true, width: 16, aliases: ["Compte", "Code compte"] }),
    col("compte", "Compte (nom)", "text", { info: true, width: 22 }),
    col("montant", "Montant", "amount", { required: true, width: 15 }),
  )
  if (config.hasPeriode) cols.push(col("periode", "Période", "text", { width: 11, aliases: ["Periode (AAAA-MM)"] }))
  cols.push(col("modePaiement", "Mode de paiement", "text", { width: 18 }), col("libelle", "Libellé", "text", { width: 34 }))
  if (config.hasTiers) {
    cols.push(col("tiers", config.key === "depenses" ? "Bénéficiaire" : "Tiers", "text", { width: 24, aliases: ["Tiers", "Beneficiaire", "Donateur"] }))
  }
  if (config.key === "dons") cols.push(col("nature", "Nature", "text", { info: true, width: 12 }))
  cols.push(col("statut", "Statut", "text", { width: 11 }))
  return cols
}

const MEMBER_COLUMNS = [
  col("reference", "Référence", "text", { width: 16 }),
  col("nom", "Nom", "text", { required: true, width: 22 }),
  col("prenom", "Prénom", "text", { required: true, width: 22, aliases: ["Prenom"] }),
  col("sexe", "Sexe", "text", { width: 8 }),
  col("telephone", "Téléphone", "text", { width: 18, aliases: ["Telephone"] }),
  col("email", "Email", "text", { width: 28, aliases: ["E-mail", "Courriel"] }),
  col("adresse", "Adresse", "text", { width: 30 }),
  col("dateNaissance", "Date de naissance", "date", { width: 16 }),
  col("dateAdhesion", "Date d'adhésion", "date", { width: 16, aliases: ["Date adhesion"] }),
  col("statut", "Statut", "text", { width: 11 }),
  col("notes", "Notes", "text", { width: 30 }),
]

const categoryColumns = (kind) => [
  col("code", "Code", "text", { required: true, width: 22 }),
  col("libelle", "Libellé", "text", { required: true, width: 32, aliases: ["Libelle"] }),
  col("description", "Description", "text", { width: 34 }),
  ...(CATEGORY_KINDS[kind].hasNature ? [col("nature", "Nature", "text", { width: 12 })] : []),
  col("actif", "Actif", "text", { width: 8 }),
]

const ACCOUNT_COLUMNS = [
  col("code", "Code", "text", { required: true, width: 16 }),
  col("nom", "Nom", "text", { required: true, width: 28 }),
  col("type", "Type", "text", { required: true, width: 10 }),
  col("banque", "Banque", "text", { width: 22 }),
  col("numeroCompte", "N° de compte", "text", { width: 22, aliases: ["Numero de compte", "Numero compte"] }),
  col("soldeInitial", "Solde initial", "amount", { width: 16 }),
  col("autoriserSoldeNegatif", "Découvert autorisé", "text", { width: 18, aliases: ["Decouvert autorise"] }),
  col("actif", "Actif", "text", { width: 8 }),
  col("solde", "Solde actuel", "amount", { info: true, width: 16 }),
]

const MOVEMENT_COLUMNS = [
  col("dateOperation", "Date", "date"),
  col("compteCode", "Compte (code)"),
  col("compteNom", "Compte (nom)", "text", { width: 24 }),
  col("sens", "Sens"),
  col("montant", "Montant", "amount"),
  col("sourceType", "Type d'opération"),
  col("reference", "Référence", "text", { width: 18 }),
  col("nature", "Nature"),
  col("libelle", "Libellé", "text", { width: 34 }),
]

const DIOCESE_COLUMNS = [
  col("reference", "Référence", "text", { width: 18 }),
  col("dateOperation", "Date", "date"),
  col("compte", "Compte", "text", { width: 22 }),
  col("periodeDebut", "Début de période", "date", { width: 16 }),
  col("periodeFin", "Fin de période", "date", { width: 16 }),
  col("montant", "Montant", "amount"),
  col("taux", "Taux (%)", "amount"),
  col("assiette", "Assiette", "amount"),
  col("libelle", "Libellé", "text", { width: 34 }),
  col("statut", "Statut"),
]

// ---------- Lecture d'un fichier importé ----------

function cellText(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("")
    if ("result" in value) return value.result ?? null
    if ("text" in value) return value.text
    return String(value)
  }
  if (typeof value === "string") return value.trim() === "" ? null : value.trim()
  return value
}

async function readSheet(file) {
  if (!file) throw unprocessable("FICHIER_REQUIS", "Aucun fichier reçu.", { fichier: "Obligatoire" })
  const workbook = new ExcelJS.Workbook()
  const name = String(file.originalname || "").toLowerCase()
  try {
    if (name.endsWith(".csv")) {
      let content = file.buffer.toString("utf8").replace(/^﻿/, "")
      const firstLine = content.split(/\r?\n/, 1)[0] ?? ""
      const delimiter = (firstLine.match(/;/g) ?? []).length >= (firstLine.match(/,/g) ?? []).length ? ";" : ","
      await workbook.csv.read(Readable.from([content]), { parserOptions: { delimiter, quote: '"' } })
    } else if (name.endsWith(".xlsx")) {
      await workbook.xlsx.load(file.buffer)
    } else {
      throw new AppError(415, "FORMAT_FICHIER_REFUSE", "Format accepté : .xlsx ou .csv.")
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw unprocessable("FICHIER_ILLISIBLE", "Le fichier est illisible ou corrompu.", { fichier: "Illisible" })
  }
  const sheet = workbook.worksheets[0]
  if (!sheet) throw unprocessable("FICHIER_VIDE", "Le fichier ne contient aucune feuille.", { fichier: "Vide" })
  return sheet
}

/** Associe les en-têtes du fichier aux colonnes définies (insensible à la casse, aux accents et à la ponctuation). */
function mapHeaders(sheet, columns) {
  const headerRow = sheet.getRow(1)
  const wanted = new Map()
  for (const c of columns.filter((x) => !x.info)) {
    for (const label of [c.header, ...(c.aliases ?? [])]) wanted.set(normalize(label), c)
  }
  const mapping = new Map()
  headerRow.eachCell({ includeEmpty: false }, (cell, index) => {
    const column = wanted.get(normalize(cellText(cell.value)))
    if (column && !mapping.has(column.key)) mapping.set(column.key, index)
  })
  const missing = columns.filter((c) => c.required && !mapping.has(c.key)).map((c) => c.header)
  if (missing.length) {
    throw unprocessable(
      "FORMAT_FICHIER_INVALIDE",
      `Colonnes obligatoires absentes : ${missing.join(", ")}. Utilisez un fichier exporté ou le modèle d'import.`,
      { colonnes: missing.join(", ") },
    )
  }
  return mapping
}

// ---------- Aides de conversion ----------

const asText = (value) => {
  const v = cellText(value)
  if (v === null || v === undefined) return null
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim() || null
}

function asAmount(value) {
  const v = cellText(value)
  if (v === null || v === undefined) return null
  if (typeof v === "number") {
    const rounded = Math.round(v * 100) / 100
    return Math.abs(v * 100 - Math.round(v * 100)) < 1e-4 ? rounded.toFixed(2) : String(v)
  }
  return String(v)
}

function asPeriod(value) {
  const v = cellText(value)
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 7)
  const text = String(v).trim()
  const fr = /^(\d{1,2})\/(\d{4})$/.exec(text)
  return fr ? `${fr[2]}-${fr[1].padStart(2, "0")}` : text.slice(0, 7)
}

const asBool = (value, fallback) => {
  const v = asText(value)
  if (v === null) return fallback
  return ["1", "oui", "true", "vrai", "o", "yes", "actif"].includes(normalize(v))
}

function rowError(error) {
  if (error instanceof ZodError) {
    return error.issues.map((i) => `${i.path.join(".") || "ligne"} : ${i.message}`).join(" ; ")
  }
  if (error instanceof AppError) {
    const detail = Object.entries(error.fields ?? {}).map(([k, v]) => `${k} : ${v}`).join(" ; ")
    return detail ? `${error.message} (${detail})` : error.message
  }
  if (typeof error?.code === "string" && error.code.startsWith("ER_")) {
    return error.code === "ER_DUP_ENTRY" ? "Valeur déjà existante (doublon)." : "Contrainte de base de données violée."
  }
  throw error
}

// ---------- Registre des ressources ----------

class Lookups {
  constructor(conn) {
    this.conn = conn
    this.cache = new Map()
    this.seen = new Set()
  }
  async remember(key, loader) {
    if (!this.cache.has(key)) this.cache.set(key, await loader())
    return this.cache.get(key)
  }
  member(reference) {
    return this.remember(`m:${reference}`, () => one(this.conn, "SELECT id FROM members WHERE reference = ?", [reference]))
  }
  async category(kind, value) {
    return this.remember(`c:${kind}:${value}`, async () => {
      const byCode = await findCategoryByCode(kind, String(value).toUpperCase(), this.conn)
      if (byCode) return byCode
      return one(this.conn, `SELECT * FROM ${CATEGORY_KINDS[kind].table} WHERE libelle = ?`, [value])
    })
  }
  account(code) {
    return this.remember(`a:${code}`, () => findAccountByCode(String(code).toUpperCase(), this.conn))
  }
}

function operationResource(key) {
  const config = OPERATION_TYPES[key]
  return {
    key,
    titre: config.key === "dons" ? "Dons et offrandes" : config.label.charAt(0).toUpperCase() + config.label.slice(1) + "s",
    feuille: key.charAt(0).toUpperCase() + key.slice(1),
    colonnes: operationColumns(config),
    sortBy: "dateOperation",
    async exportRows(filters) {
      const list = await listAllOperations(config, filters)
      return list.map((o) => ({ ...o, rubriqueCode: o.rubriqueCode }))
    },
    async importRow(row, ctx, conn, lookups) {
      const statut = normalize(row.statut)
      if (statut && ["annule", "annulee"].includes(statut)) return { ignored: "Opération annulée : non réimportée" }
      const reference = asText(row.reference)
      let existing = null
      if (reference) {
        if (lookups.seen.has(reference)) throw new AppError(422, "REFERENCE_DUPLIQUEE", `Référence « ${reference} » présente deux fois dans le fichier.`)
        lookups.seen.add(reference)
        existing = await one(conn, `SELECT id FROM ${config.table} WHERE reference = ?`, [reference])
      }
      const data = {
        dateOperation: excelDateToIso(cellText(row.dateOperation)),
        montant: asAmount(row.montant),
        modePaiement: asText(row.modePaiement),
        libelle: asText(row.libelle),
      }
      if (!data.dateOperation) throw new AppError(422, "DATE_INVALIDE", "Date manquante ou invalide (AAAA-MM-JJ).")
      const rubriqueValue = asText(row.rubriqueCode)
      const category = rubriqueValue ? await lookups.category(key, rubriqueValue) : null
      if (!category) throw new AppError(422, "RUBRIQUE_NOT_FOUND", `Rubrique « ${rubriqueValue ?? ""} » introuvable.`)
      data.rubriqueId = category.id
      const accountCode = asText(row.compteCode)
      const account = accountCode ? await lookups.account(accountCode) : null
      if (!account) throw new AppError(422, "COMPTE_NOT_FOUND", `Compte « ${accountCode ?? ""} » introuvable.`)
      data.compteId = account.id
      if (config.member !== "none") {
        const memberRef = asText(row.membreReference)
        if (memberRef) {
          const member = await lookups.member(memberRef)
          if (!member) throw new AppError(422, "MEMBRE_NOT_FOUND", `Membre « ${memberRef} » introuvable.`)
          data.membreId = member.id
        } else if (config.member === "required") {
          throw new AppError(422, "MEMBRE_REQUIS", "Le membre est obligatoire pour une cotisation.")
        }
      }
      if (config.hasTiers) data.tiers = asText(row.tiers)
      if (config.hasPeriode) data.periode = asPeriod(row.periode)
      const parsed = createSchemaFor(config).parse(data)
      if (existing) {
        await updateOperation(config, existing.id, parsed, ctx, conn)
        return { updated: true }
      }
      await createOperation(config, parsed, ctx, conn)
      return { created: true }
    },
  }
}

function categoryResource(kind) {
  return {
    key: `rubriques-${kind}`,
    titre: `Rubriques de ${CATEGORY_KINDS[kind].label}`,
    feuille: "Rubriques",
    colonnes: categoryColumns(kind),
    async exportRows(filters) {
      const list = await listCategories(kind, filters)
      return list.map((c) => ({ ...c, actif: c.actif ? "oui" : "non" }))
    },
    async importRow(row, ctx, conn, lookups) {
      const code = asText(row.code)
      if (code) {
        const uniqueCode = code.toUpperCase()
        if (lookups.seen.has(uniqueCode)) throw new AppError(422, "CODE_DUPLIQUE", `Le code « ${uniqueCode} » est présent plusieurs fois dans le fichier.`)
        lookups.seen.add(uniqueCode)
      }
      const parsed = categorySchema.parse({
        code: code ?? undefined,
        libelle: asText(row.libelle),
        description: asText(row.description),
        nature: CATEGORY_KINDS[kind].hasNature ? (asText(row.nature)?.toLowerCase() ?? undefined) : undefined,
      })
      const existing = code ? await findCategoryByCode(kind, code.toUpperCase(), conn) : null
      if (existing) {
        await updateCategory(kind, existing.id, parsed, ctx, conn)
        const actif = asBool(row.actif, true)
        if (Boolean(existing.actif) !== actif) await setCategoryActive(kind, existing.id, actif, ctx, conn)
        return { updated: true }
      }
      const created = await createCategory(kind, parsed, ctx, conn)
      if (!asBool(row.actif, true)) await setCategoryActive(kind, created.id, false, ctx, conn)
      return { created: true }
    },
  }
}

const RESOURCES = {
  membres: {
    key: "membres",
    titre: "Membres",
    feuille: "Membres",
    colonnes: MEMBER_COLUMNS,
    async exportRows(filters) {
      const list = await listAllMembers({ ...filters, inclureArchives: filters.inclureArchives ?? "true" })
      return list
    },
    async importRow(row, ctx, conn, lookups) {
      const reference = asText(row.reference)
      let existing = null
      if (reference) {
        if (lookups.seen.has(reference)) throw new AppError(422, "REFERENCE_DUPLIQUEE", `Référence « ${reference} » présente deux fois dans le fichier.`)
        lookups.seen.add(reference)
        existing = await one(conn, "SELECT id FROM members WHERE reference = ?", [reference])
      }
      const sexe = asText(row.sexe)?.toUpperCase().slice(0, 1)
      const parsed = memberSchema.parse({
        nom: asText(row.nom),
        prenom: asText(row.prenom),
        sexe: sexe || null,
        telephone: asText(row.telephone),
        email: asText(row.email),
        adresse: asText(row.adresse),
        dateNaissance: excelDateToIso(cellText(row.dateNaissance)),
        dateAdhesion: excelDateToIso(cellText(row.dateAdhesion)),
        statut: asText(row.statut)?.toLowerCase() || "actif",
        notes: asText(row.notes),
      })
      if (existing) {
        await updateMember(existing.id, parsed, ctx, conn)
        return { updated: true }
      }
      await createMember(parsed, ctx, conn)
      return { created: true }
    },
  },
  cotisations: operationResource("cotisations"),
  recettes: operationResource("recettes"),
  dons: operationResource("dons"),
  depenses: operationResource("depenses"),
  "rubriques-cotisations": categoryResource("cotisations"),
  "rubriques-recettes": categoryResource("recettes"),
  "rubriques-dons": categoryResource("dons"),
  "rubriques-depenses": categoryResource("depenses"),
  comptes: {
    key: "comptes",
    titre: "Comptes",
    feuille: "Comptes",
    colonnes: ACCOUNT_COLUMNS,
    async exportRows(filters) {
      const list = await listAccounts(filters)
      return list.map((a) => ({
        ...a,
        autoriserSoldeNegatif: a.autoriserSoldeNegatif ? "oui" : "non",
        actif: a.actif ? "oui" : "non",
      }))
    },
    async importRow(row, ctx, conn, lookups) {
      const code = asText(row.code)
      if (code) {
        const uniqueCode = code.toUpperCase()
        if (lookups.seen.has(uniqueCode)) throw new AppError(422, "CODE_DUPLIQUE", `Le code « ${uniqueCode} » est présent plusieurs fois dans le fichier.`)
        lookups.seen.add(uniqueCode)
      }
      const existing = code ? await findAccountByCode(code.toUpperCase(), conn) : null
      const parsed = accountSchema.parse({
        code,
        nom: asText(row.nom),
        type: asText(row.type)?.toLowerCase(),
        banque: asText(row.banque),
        numeroCompte: asText(row.numeroCompte),
        soldeInitial: asAmount(row.soldeInitial) ?? "0",
        autoriserSoldeNegatif: asBool(row.autoriserSoldeNegatif, false),
      })
      const initial = toCents(parsed.soldeInitial)
      if (initial === null) throw new AppError(422, "MONTANT_INVALIDE", "Solde initial invalide.")
      if (existing) {
        if (existing.type !== parsed.type || toCents(existing.solde_initial) !== initial) {
          throw new AppError(422, "COMPTE_CHAMPS_IMMUABLES", "Le type et le solde initial d'un compte existant ne peuvent pas être modifiés par import.")
        }
        const patch = accountUpdateSchema.parse({
          nom: parsed.nom,
          banque: parsed.banque,
          numeroCompte: parsed.numeroCompte,
          autoriserSoldeNegatif: parsed.autoriserSoldeNegatif,
        })
        await updateAccount(existing.id, patch, ctx, conn)
        const actif = asBool(row.actif, true)
        if (Boolean(existing.actif) !== actif) await setAccountActive(existing.id, actif, ctx, conn)
        return { updated: true }
      }
      const created = await createAccount({ ...parsed, soldeInitial: fromCents(initial) }, ctx, conn)
      if (!asBool(row.actif, true)) await setAccountActive(created.id, false, ctx, conn)
      return { created: true }
    },
  },
  mouvements: {
    key: "mouvements",
    titre: "Mouvements de comptes",
    feuille: "Mouvements",
    colonnes: MOVEMENT_COLUMNS,
    exportOnly: true,
    exportRows: (filters) => listAllMovements(filters),
  },
  "contribution-diocesaine": {
    key: "contribution-diocesaine",
    titre: "Contribution diocésaine",
    feuille: "Contribution diocésaine",
    colonnes: DIOCESE_COLUMNS,
    exportOnly: true,
    exportRows: (filters) => listAllDiocesanContributions(filters),
  },
}

export function getResource(key) {
  const resource = RESOURCES[key]
  if (!resource) throw notFound("RESSOURCE_INCONNUE", "Cette ressource ne gère pas l'export/import.")
  return resource
}

export const listExchangeResources = () =>
  Object.values(RESOURCES).map((r) => ({ key: r.key, titre: r.titre, import: !r.exportOnly }))

const FORMATS = {
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  csv: { mime: "text/csv; charset=utf-8", ext: "csv" },
}

export async function exportResource(key, filters = {}, format = "xlsx") {
  const resource = getResource(key)
  const target = FORMATS[format]
  if (!target) throw unprocessable("FORMAT_INVALIDE", "Format d'export inconnu (xlsx ou csv).", { format: "xlsx ou csv" })
  const lignes = await resource.exportRows(filters)
  const colonnes = resource.colonnes
  const buffer =
    format === "csv"
      ? buildCsv({ colonnes, lignes })
      : await buildWorkbook({
          titre: resource.titre,
          feuille: resource.feuille,
          colonnes,
          lignes,
          informations: Object.entries(filters)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => ({ label: `Filtre ${k}`, valeur: String(v) })),
        })
  return { buffer, mime: target.mime, filename: `${resource.key}-${new Date().toISOString().slice(0, 10)}.${target.ext}` }
}

/** Modèle d'import : en-têtes seuls + feuille d'instructions (jamais de ligne d'exemple importable). */
export async function buildImportTemplate(key) {
  const resource = getResource(key)
  if (resource.exportOnly) throw unprocessable("IMPORT_NON_SUPPORTE", "Cette ressource ne peut pas être importée.")
  const colonnes = resource.colonnes.filter((c) => !c.info)
  const buffer = await buildWorkbook({
    titre: `Modèle d'import — ${resource.titre}`,
    feuille: resource.feuille,
    colonnes,
    lignes: [],
    feuillesSupplementaires: [
      {
        nom: "Instructions",
        colonnes: [
          { header: "Colonne", key: "c", width: 28 },
          { header: "Obligatoire", key: "o", width: 12 },
          { header: "Format", key: "f", width: 40 },
        ],
        lignes: colonnes.map((c) => ({
          c: c.header,
          o: c.required ? "oui" : "non",
          f: { date: "AAAA-MM-JJ", amount: "Nombre, 2 décimales max", int: "Entier", text: "Texte" }[c.type],
        })),
      },
    ],
  })
  return { buffer, mime: FORMATS.xlsx.mime, filename: `modele-import-${resource.key}.xlsx` }
}

class RollbackSignal extends Error {
  constructor(result) {
    super("rollback")
    this.result = result
  }
}

/**
 * Importe un fichier Excel/CSV.
 *  - simulation : tout est exécuté puis annulé (aperçu fidèle, rien n'est conservé) ;
 *  - par défaut « tout ou rien » : une ligne invalide annule l'import ;
 *  - partiel : les lignes valides sont conservées, les autres rapportées.
 */
export async function importResource(key, file, options, ctx) {
  const resource = getResource(key)
  if (resource.exportOnly) throw unprocessable("IMPORT_NON_SUPPORTE", "Cette ressource ne peut pas être importée.")
  const sheet = await readSheet(file)
  const mapping = mapHeaders(sheet, resource.colonnes)

  const lines = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const values = {}
    let empty = true
    for (const [fieldKey, index] of mapping) {
      const value = row.getCell(index).value
      values[fieldKey] = value
      if (cellText(value) !== null && cellText(value) !== undefined) empty = false
    }
    if (!empty) lines.push({ line: r, values })
  }
  if (lines.length === 0) throw unprocessable("FICHIER_VIDE", "Le fichier ne contient aucune ligne de données.", { fichier: "Vide" })
  if (lines.length > MAX_IMPORT_ROWS) {
    throw unprocessable("FICHIER_TROP_LONG", `Maximum ${MAX_IMPORT_ROWS} lignes par import.`, { fichier: "Trop de lignes" })
  }
  if (resource.sortBy) {
    // Ordre chronologique : les soldes se reconstituent comme dans la réalité (entrées avant sorties du même jour).
    lines.sort((a, b) => String(excelDateToIso(cellText(a.values[resource.sortBy])) ?? "").localeCompare(String(excelDateToIso(cellText(b.values[resource.sortBy])) ?? "")) || a.line - b.line)
  }

  const summary = { fichier: file.originalname, lignesLues: lines.length, creees: 0, misesAJour: 0, ignorees: 0, erreurs: [], ignoreesDetail: [] }
  const simulate = Boolean(options.simulation)
  const partial = Boolean(options.partiel)

  try {
    return await withTransaction(async (conn) => {
      const lookups = new Lookups(conn)
      let index = 0
      for (const { line, values } of lines) {
        const savepoint = `import_row_${index++}`
        await conn.query(`SAVEPOINT ${savepoint}`)
        try {
          const outcome = await resource.importRow(values, ctx, conn, lookups)
          if (outcome.ignored) {
            summary.ignorees++
            summary.ignoreesDetail.push({ ligne: line, raison: outcome.ignored })
          } else if (outcome.updated) {
            summary.misesAJour++
          } else {
            summary.creees++
          }
        } catch (error) {
          await conn.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          summary.erreurs.push({ ligne: line, message: rowError(error) })
        }
      }
      const failed = summary.erreurs.length > 0
      summary.simulation = simulate
      summary.statut = simulate ? "simulation" : failed && !partial ? "annule" : "importe"
      if (simulate || (failed && !partial)) {
        if (!simulate) {
          summary.creees = 0
          summary.misesAJour = 0
        }
        throw new RollbackSignal(summary)
      }
      await createAuditLog(conn, {
        ctx,
        action: "IMPORT",
        entityType: `import:${resource.key}`,
        after: { fichier: file.originalname, creees: summary.creees, misesAJour: summary.misesAJour, ignorees: summary.ignorees, erreurs: summary.erreurs.length },
      })
      return summary
    })
  } catch (error) {
    if (error instanceof RollbackSignal) return error.result
    throw error
  }
}
