export function sendSuccess(res, data, meta, status = 200) {
  const body = { success: true, data }
  if (meta) body.meta = meta
  return res.status(status).json(body)
}

export function sendCreated(res, data) {
  return sendSuccess(res, data, undefined, 201)
}

export function sendError(res, status, code, message, fields = {}, requestId) {
  return res.status(status).json({
    success: false,
    error: { code, message, fields, requestId },
  })
}

import { badRequest } from "./errors.js"

export function parseId(value, name = "id") {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw badRequest("ID_INVALIDE", `Identifiant « ${name} » invalide.`, { [name]: "Entier positif attendu" })
  return n
}

/** Envoie un fichier généré en mémoire sans jamais exposer de chemin serveur. */
export function sendFile(res, { buffer, mime, filename }) {
  res.setHeader("Content-Type", mime)
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  res.setHeader("Cache-Control", "no-store")
  return res.send(buffer)
}
