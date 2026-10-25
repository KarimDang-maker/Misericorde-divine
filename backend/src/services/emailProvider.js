import { AppError } from "../utils/errors.js"

export function createEmailProvider(config, { fetchImpl = fetch } = {}) {
  if (config.provider === "disabled") {
    throw new AppError(503, "EMAIL_DESACTIVE", "L’envoi des notifications e-mail est désactivé.")
  }
  if (config.provider !== "resend") {
    throw new AppError(503, "EMAIL_PROVIDER_INVALIDE", "Le fournisseur e-mail configuré n’est pas pris en charge.")
  }
  if (!config.apiKey || !config.from) {
    throw new AppError(503, "EMAIL_NON_CONFIGURE", "Le fournisseur e-mail n’est pas entièrement configuré.")
  }

  return {
    from: config.from,
    replyTo: config.replyTo || undefined,
    async send(message) {
      let response
      try {
        response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: message.from || config.from,
            to: [message.to],
            ...(message.replyTo || config.replyTo ? { reply_to: message.replyTo || config.replyTo } : {}),
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          signal: AbortSignal.timeout(10000),
        })
      } catch {
        const error = new Error("EMAIL_PROVIDER_UNAVAILABLE")
        error.code = "EMAIL_PROVIDER_UNAVAILABLE"
        throw error
      }
      if (!response.ok) {
        const permanent = response.status >= 400 && response.status < 500 && response.status !== 429
        const error = new Error(`EMAIL_PROVIDER_${response.status}`)
        error.code = `EMAIL_PROVIDER_${response.status}`
        error.permanent = permanent
        throw error
      }
      return response.json()
    },
  }
}
