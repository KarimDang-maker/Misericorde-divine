const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")

export function renderPasswordChangedEmail(payload) {
  const name = String(payload.userName || "").trim()
  const greeting = name ? `Bonjour ${name},` : "Bonjour,"
  const date = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Douala",
  }).format(new Date(payload.occurredAt))
  const text = `${greeting}\n\nLe mot de passe de votre compte Miséricorde Divine a été modifié le ${date}.\n\nSi vous n’êtes pas à l’origine de cette modification, contactez immédiatement l’administrateur de la plateforme.\n\nCet avis de sécurité est automatique.`
  const html = `<p>${escapeHtml(greeting)}</p><p>Le mot de passe de votre compte Miséricorde Divine a été modifié le <strong>${escapeHtml(date)}</strong>.</p><p>Si vous n’êtes pas à l’origine de cette modification, contactez immédiatement l’administrateur de la plateforme.</p><p>Cet avis de sécurité est automatique.</p>`
  return { subject: "Avis de sécurité : mot de passe modifié", text, html }
}

export function renderPasswordResetEmail(payload) {
  const greeting = payload.userName ? `Bonjour ${payload.userName},` : "Bonjour,"
  const resetUrl = payload.resetUrl
  const text = `${greeting}\n\nUne demande de réinitialisation du mot de passe de votre compte Miséricorde Divine a été reçue. Utilisez ce lien à usage unique dans les 48 heures :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`
  const html = `<p>${escapeHtml(greeting)}</p><p>Une demande de réinitialisation du mot de passe de votre compte Miséricorde Divine a été reçue.</p><p><a href="${escapeHtml(resetUrl)}">Réinitialiser mon mot de passe</a></p><p>Ce lien à usage unique expire dans 48 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`
  return { subject: "Réinitialisation du mot de passe", text, html }
}

export { escapeHtml }
