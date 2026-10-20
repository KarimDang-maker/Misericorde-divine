import { Router } from "express"
import { z } from "zod"
import { idempotent } from "../middlewares/idempotency.js"
import { handleFileUpload, handleImportUpload } from "../middlewares/upload.js"
import { validateBody } from "../middlewares/validate.js"
import {
  ANOMALY_RULES,
  anomalyResolutionSchema,
  anomalyStatusSchema,
  getAnomalyById,
  listAnomalies,
  resolveAnomaly,
  runAnomalyChecks,
  updateAnomalyStatus,
} from "../services/anomalies.js"
import {
  ATTACHABLE,
  deleteAttachment,
  downloadAttachment,
  getAttachmentById,
  linkAttachmentToOperation,
  listAttachments,
  listOperationAttachments,
  uploadAttachment,
} from "../services/attachments.js"
import { getDashboardSummary } from "../services/dashboard.js"
import {
  calculateDiocesanContribution,
  cancelDiocesanContribution,
  createDiocesanContribution,
  diocesanCancelSchema,
  diocesanPeriodSchema,
  diocesanSchema,
  generateDiocesanContribution,
  getDiocesanContributionById,
  getDiocesanSummary,
  getRelatedOperations,
  listDiocesanContributions,
} from "../services/diocese.js"
import { buildImportTemplate, exportResource, importResource, listExchangeResources } from "../services/exchange.js"
import { getHelpSection, listHelpSections } from "../services/help.js"
import { exportReport, getReport, REPORTS } from "../services/reports.js"
import { SEARCH_CATEGORIES, globalSearch } from "../services/search.js"
import {
  generalSettingsSchema,
  getDisplayPreferences,
  getGeneralSettings,
  getSessionSecuritySettings,
  preferencesSchema,
  updateDisplayPreferences,
  updateGeneralSettings,
} from "../services/settings.js"
import { notFound } from "../utils/errors.js"
import { parseId, sendCreated, sendFile, sendSuccess } from "../utils/http.js"
import { parsePagination } from "../utils/pagination.js"

// ---- Tableau de bord ----
export const dashboardRouter = Router()
dashboardRouter.get("/", async (req, res) => sendSuccess(res, await getDashboardSummary(req.query)))

// ---- Contribution diocésaine ----
export const dioceseRouter = Router()
dioceseRouter.get("/", async (req, res) => {
  const { items, meta } = await listDiocesanContributions(req.query, parsePagination(req.query))
  sendSuccess(res, items, meta)
})
dioceseRouter.post("/", idempotent, validateBody(diocesanSchema), async (req, res) =>
  sendCreated(res, await createDiocesanContribution(req.body, req.ctx)),
)
dioceseRouter.get("/synthese", async (req, res) => sendSuccess(res, await getDiocesanSummary(req.query)))
dioceseRouter.post("/calcul", validateBody(diocesanPeriodSchema), async (req, res) =>
  sendSuccess(res, await calculateDiocesanContribution(req.body)),
)
dioceseRouter.post("/generation", idempotent, validateBody(diocesanPeriodSchema), async (req, res) =>
  sendCreated(res, await generateDiocesanContribution(req.body, req.ctx)),
)
dioceseRouter.get("/:id", async (req, res) => sendSuccess(res, await getDiocesanContributionById(parseId(req.params.id))))
dioceseRouter.get("/:id/operations", async (req, res) => sendSuccess(res, await getRelatedOperations(parseId(req.params.id))))
dioceseRouter.post("/:id/annulation", validateBody(diocesanCancelSchema), async (req, res) =>
  sendSuccess(res, await cancelDiocesanContribution(parseId(req.params.id), req.body.motif, req.ctx)),
)

// ---- Justificatifs ----
export const attachmentsRouter = Router()
attachmentsRouter.get("/", async (req, res) => {
  const { items, meta } = await listAttachments(req.query, parsePagination(req.query))
  sendSuccess(res, items, meta)
})
attachmentsRouter.post("/", handleFileUpload, async (req, res) => {
  sendCreated(res, await uploadAttachment(req.file, req.body ?? {}, req.ctx))
})
attachmentsRouter.get("/:id", async (req, res) => sendSuccess(res, await getAttachmentById(parseId(req.params.id))))
attachmentsRouter.get("/:id/telechargement", async (req, res) => {
  const file = await downloadAttachment(parseId(req.params.id), req.ctx)
  res.setHeader("Content-Type", file.mimeType)
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.nom)}`)
  res.sendFile(file.filePath)
})
attachmentsRouter.post(
  "/:id/liaison",
  validateBody(z.object({ operationType: z.enum(["contribution", "revenue", "donation", "expense", "diocesan"]), operationId: z.coerce.number().int().positive() })),
  async (req, res) => {
    sendSuccess(res, await linkAttachmentToOperation(parseId(req.params.id), req.body.operationType, req.body.operationId, req.ctx))
  },
)
attachmentsRouter.delete("/:id", async (req, res) => {
  await deleteAttachment(parseId(req.params.id), req.ctx)
  res.status(204).end()
})

export const operationAttachmentsRouter = Router()
operationAttachmentsRouter.get("/:type/:id/justificatifs", async (req, res) => {
  const target = ATTACHABLE[req.params.type]
  if (!target) throw notFound("OPERATION_TYPE_INCONNU", "Type d'opération inconnu.")
  sendSuccess(res, await listOperationAttachments(target.type, parseId(req.params.id)))
})

// ---- Recherche ----
export const searchRouter = Router()
searchRouter.get("/", async (req, res) => {
  const categories = req.query.categories ? String(req.query.categories).split(",").map((c) => c.trim()).filter(Boolean) : []
  const { items, meta } = await globalSearch(req.query.q, categories, req.query, parsePagination(req.query))
  sendSuccess(res, items, { ...meta, categoriesDisponibles: SEARCH_CATEGORIES })
})

// ---- Rapports ----
export const reportsRouter = Router()
reportsRouter.get("/", (_req, res) => sendSuccess(res, Object.keys(REPORTS)))
reportsRouter.get("/:type/export", async (req, res) => {
  sendFile(res, await exportReport(req.params.type, req.query, String(req.query.format ?? "xlsx").toLowerCase()))
})
reportsRouter.get("/:type", async (req, res) => sendSuccess(res, await getReport(req.params.type, req.query)))

// ---- Échanges Excel / CSV ----
export const exchangeRouter = Router()
exchangeRouter.get("/", (_req, res) => sendSuccess(res, listExchangeResources()))
exchangeRouter.get("/:resource/export", async (req, res) => {
  sendFile(res, await exportResource(req.params.resource, req.query, String(req.query.format ?? "xlsx").toLowerCase()))
})
exchangeRouter.get("/:resource/modele", async (req, res) => sendFile(res, await buildImportTemplate(req.params.resource)))
exchangeRouter.post("/:resource/import", handleImportUpload, async (req, res) => {
  const truthy = (v) => ["1", "true", "oui"].includes(String(v ?? "").toLowerCase())
  const result = await importResource(
    req.params.resource,
    req.file,
    { simulation: truthy(req.query.simulation ?? req.body?.simulation), partiel: truthy(req.query.partiel ?? req.body?.partiel) },
    req.ctx,
  )
  if (result.statut === "annule") {
    return res.status(422).json({
      success: false,
      error: { code: "IMPORT_ANNULE", message: "Import annulé : corrigez les lignes en erreur puis réessayez.", fields: {}, requestId: req.id },
      data: result,
    })
  }
  sendSuccess(res, result)
})

// ---- Anomalies ----
export const anomaliesRouter = Router()
anomaliesRouter.get("/", async (req, res) => {
  const { items, meta } = await listAnomalies(req.query, parsePagination(req.query))
  sendSuccess(res, items, meta)
})
anomaliesRouter.get("/regles", (_req, res) => sendSuccess(res, ANOMALY_RULES))
anomaliesRouter.post("/analyse", async (req, res) => sendSuccess(res, await runAnomalyChecks(req.ctx)))
anomaliesRouter.get("/:id", async (req, res) => sendSuccess(res, await getAnomalyById(parseId(req.params.id))))
anomaliesRouter.patch("/:id/statut", validateBody(anomalyStatusSchema), async (req, res) =>
  sendSuccess(res, await updateAnomalyStatus(parseId(req.params.id), req.body.statut, req.body.commentaire, req.ctx)),
)
anomaliesRouter.post("/:id/resolution", validateBody(anomalyResolutionSchema), async (req, res) =>
  sendSuccess(res, await resolveAnomaly(parseId(req.params.id), req.body.resolution, req.ctx)),
)

// ---- Paramètres ----
export const settingsRouter = Router()
settingsRouter.get("/", async (req, res) => {
  sendSuccess(res, {
    generaux: await getGeneralSettings(),
    preferences: await getDisplayPreferences(req.user.id),
    securiteSession: getSessionSecuritySettings(),
  })
})
settingsRouter.put("/generaux", validateBody(generalSettingsSchema), async (req, res) =>
  sendSuccess(res, await updateGeneralSettings(req.body, req.ctx)),
)
settingsRouter.get("/preferences", async (req, res) => sendSuccess(res, await getDisplayPreferences(req.user.id)))
settingsRouter.put("/preferences", validateBody(preferencesSchema), async (req, res) =>
  sendSuccess(res, await updateDisplayPreferences(req.user.id, req.body)),
)

// ---- Aide ----
export const helpRouter = Router()
helpRouter.get("/", (_req, res) => sendSuccess(res, listHelpSections()))
helpRouter.get("/:slug", (req, res) => sendSuccess(res, getHelpSection(req.params.slug)))
