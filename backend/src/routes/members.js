import { Router } from "express"
import { idempotent } from "../middlewares/idempotency.js"
import { validateBody } from "../middlewares/validate.js"
import {
  getMemberById,
  getMemberFinancialSummary,
  getMemberOperations,
  listMembers,
  createMember,
  updateMember,
  memberSchema,
  memberStatusSchema,
  memberUpdateSchema,
  setMemberStatus,
} from "../services/members.js"
import { getMemberContributions } from "../services/operations.js"
import { sendCreated, sendSuccess, parseId } from "../utils/http.js"
import { parsePagination } from "../utils/pagination.js"

export const membersRouter = Router()

membersRouter.get("/", async (req, res) => {
  const { items, meta } = await listMembers(req.query, parsePagination(req.query), req.query)
  sendSuccess(res, items, meta)
})

membersRouter.post("/", idempotent, validateBody(memberSchema), async (req, res) => {
  sendCreated(res, await createMember(req.body, req.ctx))
})

membersRouter.get("/:id", async (req, res) => {
  sendSuccess(res, await getMemberById(parseId(req.params.id)))
})

membersRouter.put("/:id", validateBody(memberUpdateSchema), async (req, res) => {
  sendSuccess(res, await updateMember(parseId(req.params.id), req.body, req.ctx))
})

membersRouter.patch("/:id/statut", validateBody(memberStatusSchema), async (req, res) => {
  sendSuccess(res, await setMemberStatus(parseId(req.params.id), req.body.statut, req.ctx))
})

membersRouter.get("/:id/operations", async (req, res) => {
  const { items, meta } = await getMemberOperations(parseId(req.params.id), req.query, parsePagination(req.query))
  sendSuccess(res, items, meta)
})

membersRouter.get("/:id/synthese-financiere", async (req, res) => {
  sendSuccess(res, await getMemberFinancialSummary(parseId(req.params.id), req.query))
})

membersRouter.get("/:id/cotisations", async (req, res) => {
  const memberId = parseId(req.params.id)
  await getMemberById(memberId)
  sendSuccess(res, await getMemberContributions(memberId, req.query))
})
