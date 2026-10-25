import { Router } from "express"
import { validateBody } from "../middlewares/validate.js"
import {
  accountSchema,
  accountAdjustmentSchema,
  accountUpdateSchema,
  createAccount,
  createAccountAdjustment,
  getAccountBalance,
  getAccountById,
  getAccountMovements,
  listAccounts,
  setAccountActive,
  updateAccount,
} from "../services/accounts.js"
import { getBankPosition, getCashPosition, getConsolidatedPosition } from "../services/reports.js"
import { parseId, sendCreated, sendSuccess } from "../utils/http.js"
import { parsePagination } from "../utils/pagination.js"
import { idempotent } from "../middlewares/idempotency.js"
import { z } from "zod"
import { requireAdmin } from "../middlewares/roles.js"

export const accountsRouter = Router()

accountsRouter.get("/", async (req, res) => sendSuccess(res, await listAccounts(req.query)))
accountsRouter.post("/", idempotent, validateBody(accountSchema), async (req, res) =>
  sendCreated(res, await createAccount(req.body, req.ctx)),
)
accountsRouter.get("/:id", async (req, res) => sendSuccess(res, await getAccountById(parseId(req.params.id))))
accountsRouter.put("/:id", validateBody(accountUpdateSchema), async (req, res) =>
  sendSuccess(res, await updateAccount(parseId(req.params.id), req.body, req.ctx)),
)
accountsRouter.patch("/:id/statut", validateBody(z.object({ actif: z.boolean() })), async (req, res) =>
  sendSuccess(res, await setAccountActive(parseId(req.params.id), req.body.actif, req.ctx)),
)
accountsRouter.get("/:id/solde", async (req, res) =>
  sendSuccess(res, await getAccountBalance(parseId(req.params.id), req.query.date)),
)
accountsRouter.get("/:id/mouvements", async (req, res) => {
  const { items, meta } = await getAccountMovements(parseId(req.params.id), req.query, parsePagination(req.query))
  sendSuccess(res, items, meta)
})
accountsRouter.post("/:id/ajustements", requireAdmin, idempotent, validateBody(accountAdjustmentSchema), async (req, res) =>
  sendCreated(res, await createAccountAdjustment(parseId(req.params.id), req.body, req.ctx)),
)

export const treasuryRouter = Router()
treasuryRouter.get("/synthese", async (req, res) => {
  const [caisse, banque, consolidee] = await Promise.all([
    getCashPosition(req.query),
    getBankPosition(req.query),
    getConsolidatedPosition(req.query),
  ])
  sendSuccess(res, { caisse, banque, consolidee })
})
