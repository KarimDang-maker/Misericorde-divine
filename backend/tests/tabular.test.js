import assert from "node:assert/strict"
import { describe, it } from "node:test"
import ExcelJS from "exceljs"
import { buildCsv, buildWorkbook } from "../src/services/tabular.js"

describe("Exports tabulaires sécurisés", () => {
  it("neutralise les formules CSV et préserve les séparateurs et retours à la ligne", () => {
    const csv = buildCsv({
      colonnes: [{ key: "nom", header: "Nom" }, { key: "note", header: "Note" }],
      lignes: [{ nom: "=HYPERLINK(\"https://evil.example\")", note: "ligne 1;\nligne 2" }],
    }).toString("utf8")
    assert.match(csv, /'=HYPERLINK/)
    assert.match(csv, /"ligne 1;\nligne 2"/)
  })

  it("écrit les valeurs Excel commençant par = comme texte et non comme formule", async () => {
    const bytes = await buildWorkbook({
      titre: "Test",
      colonnes: [{ key: "libelle", header: "Libellé", type: "text" }],
      lignes: [{ libelle: "=HYPERLINK(\"https://evil.example\")" }],
    })
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(bytes)
    const cell = book.worksheets[0].getCell("A2")
    assert.equal(cell.type, ExcelJS.ValueType.String)
    assert.equal(cell.value, '=HYPERLINK("https://evil.example")')
  })
})
