import cookieParser from "cookie-parser"
import express from "express"
import helmet from "helmet"
import { authenticate, requireActiveAccount } from "./middlewares/auth.js"
import { attachRequestId, errorHandler, notFoundHandler } from "./middlewares/errors.js"
import { checkOrigin, cors } from "./middlewares/security.js"
import { accountsRouter, treasuryRouter } from "./routes/accounts.js"
import { authRouter } from "./routes/auth.js"
import { categoriesRouter } from "./routes/categories.js"
import { membersRouter } from "./routes/members.js"
import {
  anomaliesRouter,
  attachmentsRouter,
  dashboardRouter,
  dioceseRouter,
  exchangeRouter,
  helpRouter,
  operationAttachmentsRouter,
  reportsRouter,
  searchRouter,
  settingsRouter,
} from "./routes/misc.js"
import { operationRouter } from "./routes/operations.js"
import { checkDatabaseConnection } from "./config/database.js"
import { sendSuccess } from "./utils/http.js"

export function createApp() {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", "loopback")
  app.use(attachRequestId)
  app.use(helmet())
  app.use(cors)
  app.use(express.json({ limit: "1mb" }))
  app.use(cookieParser())
  app.use(checkOrigin)

  const api = express.Router()
  api.get("/sante", async (_req, res) => {
    sendSuccess(res, { api: "ok", baseDeDonnees: (await checkDatabaseConnection()) ? "ok" : "ko" })
  })
  api.use("/auth", authRouter)

  // Tout ce qui suit exige une session valide.
  api.use(authenticate, requireActiveAccount)
  api.use("/dashboard", dashboardRouter)
  api.use("/membres", membersRouter)
  api.use("/rubriques", categoriesRouter)
  api.use("/cotisations", operationRouter("cotisations"))
  api.use("/recettes", operationRouter("recettes"))
  api.use("/dons", operationRouter("dons"))
  api.use("/depenses", operationRouter("depenses"))
  api.use("/comptes", accountsRouter)
  api.use("/tresorerie", treasuryRouter)
  api.use("/contribution-diocesaine", dioceseRouter)
  api.use("/justificatifs", attachmentsRouter)
  api.use("/operations", operationAttachmentsRouter)
  api.use("/recherche", searchRouter)
  api.use("/rapports", reportsRouter)
  api.use("/echanges", exchangeRouter)
  api.use("/anomalies", anomaliesRouter)
  api.use("/parametres", settingsRouter)
  api.use("/aide", helpRouter)
  api.use(notFoundHandler)

  app.use("/api", api)
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
