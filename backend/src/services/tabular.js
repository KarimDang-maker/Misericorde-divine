import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"

/**
 * Rendu générique (Excel, CSV, PDF) d'un jeu de données tabulaire.
 * colonnes : [{ key, header, type: 'text'|'date'|'amount'|'int', width? }]
 * La première feuille Excel ne contient QUE l'en-tête et les lignes : c'est le format réimportable.
 */

const toCell = (value, type) => {
  if (value === null || value === undefined || value === "") return null
  if (type === "date") {
    const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? String(value) : d
  }
  if (type === "amount" || type === "int") return Number(value)
  return String(value)
}

export async function buildWorkbook({ titre, feuille, colonnes, lignes, informations = [], feuillesSupplementaires = [] }) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Miséricorde Divine"
  workbook.created = new Date()
  const sheet = workbook.addWorksheet(feuille || "Données")
  sheet.columns = colonnes.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(14, c.header.length + 4),
    style: {
      numFmt: c.type === "date" ? "yyyy-mm-dd" : c.type === "amount" ? "#,##0.00" : undefined,
    },
  }))
  for (const ligne of lignes) {
    sheet.addRow(Object.fromEntries(colonnes.map((c) => [c.key, toCell(ligne[c.key], c.type)])))
  }
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: "FFFFFFFF" } }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7F365A" } }
  header.alignment = { vertical: "middle" }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  if (colonnes.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonnes.length } }
  }

  const info = workbook.addWorksheet("Informations")
  info.columns = [
    { header: "Élément", key: "k", width: 28 },
    { header: "Valeur", key: "v", width: 48 },
  ]
  info.addRow({ k: "Document", v: titre })
  info.addRow({ k: "Exporté le", v: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC" })
  info.addRow({ k: "Nombre de lignes", v: lignes.length })
  for (const item of informations) info.addRow({ k: item.label, v: item.valeur })
  info.getRow(1).font = { bold: true }

  for (const extra of feuillesSupplementaires) {
    const ws = workbook.addWorksheet(extra.nom)
    ws.columns = extra.colonnes.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }))
    for (const ligne of extra.lignes) {
      ws.addRow(Object.fromEntries(extra.colonnes.map((c) => [c.key, toCell(ligne[c.key], c.type)])))
    }
    ws.getRow(1).font = { bold: true }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const csvEscape = (value) => {
  const text = value === null || value === undefined ? "" : String(value)
  // Neutralise l'injection de formules lorsque le CSV est ouvert dans un tableur.
  const safe = /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV UTF-8 avec BOM et séparateur « ; » (ouverture directe dans Excel en français). */
export function buildCsv({ colonnes, lignes }) {
  const head = colonnes.map((c) => csvEscape(c.header)).join(";")
  const body = lignes.map((l) => colonnes.map((c) => csvEscape(l[c.key])).join(";"))
  return Buffer.from(`﻿${[head, ...body].join("\r\n")}\r\n`, "utf8")
}

export function buildPdf({ titre, sousTitre, colonnes, lignes, totaux = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 })
    const chunks = []
    doc.on("data", (c) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    doc.fontSize(16).text(titre)
    if (sousTitre) doc.fontSize(9).fillColor("#666").text(sousTitre).fillColor("#000")
    doc.moveDown(0.5)

    const usable = doc.page.width - 72
    const cols = colonnes.slice(0, 9)
    const width = usable / cols.length
    const drawRow = (cells, bold) => {
      const y = doc.y
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8)
      cells.forEach((cell, i) => {
        doc.text(String(cell ?? ""), 36 + i * width, y, { width: width - 4, height: 11, ellipsis: true, lineBreak: false })
      })
      doc.y = y + 13
    }
    drawRow(cols.map((c) => c.header), true)
    doc.moveTo(36, doc.y - 2).lineTo(36 + usable, doc.y - 2).stroke("#ccc")
    for (const ligne of lignes) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage()
        drawRow(cols.map((c) => c.header), true)
      }
      drawRow(cols.map((c) => ligne[c.key]), false)
    }
    if (totaux.length) {
      doc.moveDown(1).font("Helvetica-Bold").fontSize(10).text("Synthèse")
      doc.font("Helvetica").fontSize(9)
      for (const t of totaux) doc.text(`${t.label} : ${t.valeur}`)
    }
    doc.end()
  })
}
