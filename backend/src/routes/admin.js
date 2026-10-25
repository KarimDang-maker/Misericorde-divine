import { Router } from "express"
import { z } from "zod"
import { createAdminUserSchema, createUser, getUserById, listUsers, setUserActive, updateAdminUserSchema, updateUser } from "../services/admin.js"
import { parseId, sendCreated, sendSuccess } from "../utils/http.js"
import { parsePagination } from "../utils/pagination.js"
import { validateBody } from "../middlewares/validate.js"
import { listNotificationOutbox, retryDeadNotification } from "../services/notifications.js"

export const adminRouter = Router()
adminRouter.get("/notifications/outbox", async (req, res) => {
  const result = await listNotificationOutbox(req.query, parsePagination(req.query))
  sendSuccess(res, result.items, result.meta)
})
adminRouter.post("/notifications/outbox/:id/retry", async (req, res) =>
  sendSuccess(res, await retryDeadNotification(parseId(req.params.id), req.ctx)),
)
adminRouter.get("/users", async (req, res) => {
  const result = await listUsers({ ...req.query, ...parsePagination(req.query) })
  sendSuccess(res, result.items, result.meta)
})
adminRouter.post("/users", validateBody(createAdminUserSchema), async (req, res) => sendCreated(res, await createUser(req.body, req.ctx)))
adminRouter.get("/users/:id", async (req, res) => sendSuccess(res, await getUserById(parseId(req.params.id))))
adminRouter.put("/users/:id", validateBody(updateAdminUserSchema), async (req, res) => sendSuccess(res, await updateUser(parseId(req.params.id), req.body, req.ctx)))
adminRouter.patch("/users/:id/statut", validateBody(z.object({ actif: z.boolean() })), async (req, res) => sendSuccess(res, await setUserActive(parseId(req.params.id), req.body.actif, req.ctx)))
