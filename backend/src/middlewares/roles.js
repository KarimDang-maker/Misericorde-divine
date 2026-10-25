import { forbidden } from "../utils/errors.js"

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== "admin") throw forbidden("Cette action est réservée aux administrateurs.")
  next()
}
