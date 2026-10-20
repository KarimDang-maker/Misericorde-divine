/** Valide req.body / req.query / req.params avec un schéma Zod. Remplace la valeur par la version nettoyée. */
function validator(source) {
  return (schema) => (req, _res, next) => {
    const parsed = schema.parse(req[source])
    if (source === "query") {
      // req.query est en lecture seule avec Express 5 : on expose la version validée à part.
      req.validatedQuery = parsed
    } else {
      req[source] = parsed
    }
    next()
  }
}

export const validateBody = validator("body")
export const validateQuery = validator("query")
export const validateParams = validator("params")
