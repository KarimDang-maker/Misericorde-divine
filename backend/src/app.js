import cookieParser from "cookie-parser"
import express from "express"
import helmet from "helmet"
import { authenticate, requireActiveAccount } from "./middlewares/auth.js"
import { requireAdmin } from "./middlewares/roles.js"
import { attachRequestId, errorHandler, notFoundHandler } from "./middlewares/errors.js"
import { checkOrigin, cors } from "./middlewares/security.js"
import { accountsRouter, treasuryRouter } from "./routes/accounts.js"
import { authRouter } from "./routes/auth.js"
import { adminRouter } from "./routes/admin.js"
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
import { notificationsCronRouter, notificationsUserRouter } from "./routes/notifications.js"
import { checkDatabaseConnection } from "./config/database.js"
import { env } from "./config/environment.js"
import { sendSuccess } from "./utils/http.js"
import swaggerUi from "swagger-ui-express"
import { openApiDocument } from "./openapi.js"

export function createApp() {
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", env.trustProxy)
  app.use(attachRequestId)
  app.use(helmet())
  app.use(cors)
  app.use(express.json({ limit: "1mb" }))
  app.use(cookieParser())
  app.use(checkOrigin)

  const api = express.Router()
  // Documentation publique du contrat HTTP; les données métier restent protégées.
  api.get("/openapi.json", (_req, res) => res.json(openApiDocument))
  api.use("/docs", (req, res, next) => {
    // Swagger UI génère un petit script d'initialisation inline. L'assouplissement
    // CSP est limité à cette interface et conserve les ressources sur la même origine.
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'")
    next()
  }, swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    customSiteTitle: "Misericorde Divine — documentation API",
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  }))
  api.get("/sante", async (_req, res) => {
    sendSuccess(res, { api: "ok", baseDeDonnees: (await checkDatabaseConnection()) ? "ok" : "ko" })
  })
  api.use("/auth", authRouter)
  // Route Vercel Cron : authentifiée par un secret long, sans cookie utilisateur.
  api.use("/cron", notificationsCronRouter)

  // Tout ce qui suit exige une session valide.
  api.use(authenticate, requireActiveAccount)
  api.use("/notifications", notificationsUserRouter)
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
  api.use("/admin", requireAdmin, adminRouter)
  api.use("/parametres", settingsRouter)
  api.use("/aide", helpRouter)
  api.use(notFoundHandler)

  app.use("/api", api)
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
