import { Router } from "express"
import { validateBody } from "../middlewares/validate.js"
import {
  activeStatusSchema,
  categorySchema,
  categoryUpdateSchema,
  createCategory,
  getCategory,
  listCategories,
  setCategoryActive,
  updateCategory,
  CATEGORY_KINDS,
} from "../services/categories.js"
import { parseId, sendCreated, sendSuccess } from "../utils/http.js"
import { idempotent } from "../middlewares/idempotency.js"

export const categoriesRouter = Router()

for (const kind of Object.keys(CATEGORY_KINDS)) {
  const path = `/${kind}`
  categoriesRouter.get(path, async (req, res) => sendSuccess(res, await listCategories(kind, req.query)))
  categoriesRouter.post(path, idempotent, validateBody(categorySchema), async (req, res) =>
    sendCreated(res, await createCategory(kind, req.body, req.ctx)),
  )
  categoriesRouter.get(`${path}/:id`, async (req, res) => sendSuccess(res, await getCategory(kind, parseId(req.params.id))))
  categoriesRouter.put(`${path}/:id`, validateBody(categoryUpdateSchema), async (req, res) =>
    sendSuccess(res, await updateCategory(kind, parseId(req.params.id), req.body, req.ctx)),
  )
  categoriesRouter.patch(`${path}/:id/statut`, validateBody(activeStatusSchema), async (req, res) =>
    sendSuccess(res, await setCategoryActive(kind, parseId(req.params.id), req.body.actif, req.ctx)),
  )
}
