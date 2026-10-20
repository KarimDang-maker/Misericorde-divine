import { Router } from "express"
import { idempotent } from "../middlewares/idempotency.js"
import { validateBody } from "../middlewares/validate.js"
import {
  OPERATION_TYPES,
  cancelOperation,
  cancelSchema,
  createOperation,
  createSchemaFor,
  getOperationDetail,
  listOperations,
  updateOperation,
  updateSchemaFor,
} from "../services/operations.js"
import { parseId, sendCreated, sendSuccess } from "../utils/http.js"
import { parsePagination } from "../utils/pagination.js"

/** Cotisations, recettes, dons et dépenses partagent les mêmes routes (cf. services/operations.js). */
export function operationRouter(key) {
  const config = OPERATION_TYPES[key]
  const router = Router()

  router.get("/", async (req, res) => {
    const { items, meta } = await listOperations(config, req.query, parsePagination(req.query), req.query)
    sendSuccess(res, items, meta)
  })
  router.post("/", idempotent, validateBody(createSchemaFor(config)), async (req, res) => {
    sendCreated(res, await createOperation(config, req.body, req.ctx))
  })
  router.get("/:id", async (req, res) => sendSuccess(res, await getOperationDetail(config, parseId(req.params.id))))
  router.put("/:id", validateBody(updateSchemaFor(config)), async (req, res) => {
    sendSuccess(res, await updateOperation(config, parseId(req.params.id), req.body, req.ctx))
  })
  router.post("/:id/annulation", validateBody(cancelSchema), async (req, res) => {
    sendSuccess(res, await cancelOperation(config, parseId(req.params.id), req.body.motif, req.ctx))
  })
  return router
}
