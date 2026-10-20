import { randomUUID } from "node:crypto"
import { ZodError } from "zod"
import { env } from "../config/environment.js"
import { logger } from "../config/logger.js"
import { AppError } from "../utils/errors.js"
import { sendError } from "../utils/http.js"

export function attachRequestId(req, res, next) {
  req.id = randomUUID().slice(0, 18)
  res.setHeader("X-Request-Id", req.id)
  next()
}

export function notFoundHandler(req, res) {
  sendError(res, 404, "ROUTE_INTROUVABLE", "La ressource demandée n'existe pas.", {}, req.id)
}

const MYSQL_CONFLICTS = {
  ER_DUP_ENTRY: [409, "DOUBLON", "Une valeur unique existe déjà."],
  ER_ROW_IS_REFERENCED_2: [409, "ENTITE_UTILISEE", "Cet élément est référencé par d'autres données."],
  ER_NO_REFERENCED_ROW_2: [422, "REFERENCE_INVALIDE", "Une référence liée est invalide."],
  ER_CHECK_CONSTRAINT_VIOLATED: [422, "CONTRAINTE_VIOLEE", "Une contrainte de données est violée."],
  ER_DATA_TOO_LONG: [422, "VALEUR_TROP_LONGUE", "Une valeur dépasse la longueur autorisée."],
  ER_LOCK_DEADLOCK: [409, "CONFLIT_CONCURRENT", "Conflit d'accès concurrent, veuillez réessayer."],
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof AppError) {
    return sendError(res, error.status, error.code, error.message, error.fields, req.id)
  }
  if (error instanceof ZodError) {
    const fields = {}
    for (const issue of error.issues) fields[issue.path.join(".") || "_"] = issue.message
    return sendError(res, 422, "VALIDATION_ECHOUEE", "Les données envoyées sont invalides.", fields, req.id)
  }
  if (error?.type === "entity.parse.failed") {
    return sendError(res, 400, "JSON_INVALIDE", "Le corps de la requête n'est pas un JSON valide.", {}, req.id)
  }
  if (error?.type === "entity.too.large") {
    return sendError(res, 413, "CORPS_TROP_VOLUMINEUX", "La requête est trop volumineuse.", {}, req.id)
  }
  if (error?.name === "MulterError") {
    const tooLarge = error.code === "LIMIT_FILE_SIZE"
    return sendError(
      res,
      tooLarge ? 413 : 400,
      tooLarge ? "FICHIER_TROP_VOLUMINEUX" : "TELEVERSEMENT_INVALIDE",
      tooLarge ? "Le fichier dépasse la taille maximale autorisée." : "Téléversement invalide.",
      {},
      req.id,
    )
  }
  const mapped = MYSQL_CONFLICTS[error?.code]
  if (mapped) {
    // Détails SQL volontairement masqués.
    logger.warn("Erreur MySQL mappée", { code: error.code, requestId: req.id })
    return sendError(res, mapped[0], mapped[1], mapped[2], {}, req.id)
  }
  logger.error("Erreur non prévue", {
    requestId: req.id,
    path: req.path,
    message: error?.message,
    stack: env.isProduction ? undefined : error?.stack,
  })
  return sendError(res, 500, "ERREUR_INTERNE", "Une erreur interne est survenue.", {}, req.id)
}
