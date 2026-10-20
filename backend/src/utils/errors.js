export class AppError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export const badRequest = (code, message, fields) => new AppError(400, code, message, fields)
export const unauthorized = (message = "Authentification requise.") =>
  new AppError(401, "NON_AUTHENTIFIE", message)
export const forbidden = (message = "Action interdite.") => new AppError(403, "INTERDIT", message)
export const notFound = (code, message) => new AppError(404, code, message)
export const conflict = (code, message, fields) => new AppError(409, code, message, fields)
export const unprocessable = (code, message, fields) => new AppError(422, code, message, fields)
