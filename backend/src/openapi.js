/** Contrat OpenAPI 3.0 de l'API Misericorde Divine. */
const id = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }
const jsonBody = (schema = { type: "object", additionalProperties: true }) => ({
  required: true,
  content: { "application/json": { schema } },
})
const response = (description = "Réponse JSON de l'API") => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiResponse" } } } })
const secured = [{ SessionCookie: [] }]
const tag = (name, summary) => ({ name, description: summary })
const crudList = (summary, securedOperation = true) => ({ summary, tags: [summary], ...(securedOperation ? { security: secured } : {}), responses: { 200: response(), 401: response("Session absente ou expirée"), 403: response("Accès interdit") } })

const paths = {
  "/sante": { get: { summary: "État de l’API et de la base", tags: ["Système"], responses: { 200: response(), 503: response("Base indisponible") } } },
  "/auth/login": { post: { summary: "Ouvrir une session", tags: ["Authentification"], requestBody: jsonBody({ type: "object", required: ["email", "motDePasse"], properties: { email: { type: "string", format: "email" }, motDePasse: { type: "string", format: "password" } } }), responses: { 200: response("Session créée; cookie HttpOnly défini"), 401: response("Identifiants invalides"), 429: response("Trop de tentatives") } } },
  "/auth/logout": { post: { summary: "Fermer la session", tags: ["Authentification"], security: secured, responses: { 200: response() } } },
  "/auth/me": { get: { summary: "Utilisateur connecté", tags: ["Authentification"], security: secured, responses: { 200: response(), 401: response() } } },
  "/auth/password": { put: { summary: "Changer son mot de passe", tags: ["Authentification"], security: secured, requestBody: jsonBody(), responses: { 200: response(), 400: response("Données invalides") } } },
  "/auth/password-reset/request": { post: { summary: "Demander une réinitialisation", tags: ["Authentification"], requestBody: jsonBody({ type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } }), responses: { 202: response("Réponse neutre, que le compte existe ou non") } } },
  "/auth/password-reset/confirm": { post: { summary: "Confirmer la réinitialisation", tags: ["Authentification"], requestBody: jsonBody(), responses: { 200: response(), 400: response("Jeton invalide ou expiré") } } },
  "/cron/notifications": { get: { summary: "Traiter la file de notifications e-mail", tags: ["Notifications"], security: [{ CronBearer: [] }], responses: { 200: response(), 401: response("Secret Cron invalide") } } },
  "/notifications/preferences": { get: { ...crudList("Notifications"), summary: "Consulter ses préférences e-mail", description: "PASSWORD_CHANGED et PASSWORD_RESET sont obligatoires et ne peuvent pas être désactivés. Le choix concerne les futurs événements optionnels, dont aucun n’est actuellement activé." }, put: { ...crudList("Notifications"), summary: "Modifier ses préférences e-mail", description: "Enregistre le consentement aux futurs messages d’information. Les alertes de sécurité restent obligatoires.", requestBody: jsonBody({ type: "object", additionalProperties: false, required: ["notificationsOptionnelles"], properties: { notificationsOptionnelles: { type: "boolean" } } }) } },
  "/dashboard": { get: crudList("Tableau de bord") },
  "/membres": { get: crudList("Membres"), post: { ...crudList("Membres"), summary: "Créer un membre", parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], requestBody: jsonBody(), responses: { 201: response("Membre créé"), 400: response() } } },
  "/membres/{id}": { get: { ...crudList("Membres"), summary: "Détail d’un membre", parameters: [id] }, put: { ...crudList("Membres"), summary: "Modifier un membre", parameters: [id], requestBody: jsonBody() } },
  "/membres/{id}/statut": { patch: { ...crudList("Membres"), summary: "Modifier le statut d’un membre", parameters: [id], requestBody: jsonBody() } },
  "/membres/{id}/operations": { get: { ...crudList("Membres"), summary: "Opérations d’un membre", parameters: [id] } },
  "/membres/{id}/synthese-financiere": { get: { ...crudList("Membres"), summary: "Synthèse financière d’un membre", parameters: [id] } },
  "/membres/{id}/cotisations": { get: { ...crudList("Membres"), summary: "Cotisations d’un membre", parameters: [id] } },
  "/rubriques/{type}": { get: { ...crudList("Rubriques"), summary: "Lister les rubriques", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string", enum: ["cotisations", "recettes", "dons", "depenses"] } }] }, post: { ...crudList("Rubriques"), summary: "Créer une rubrique", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string", enum: ["cotisations", "recettes", "dons", "depenses"] } }, { $ref: "#/components/parameters/IdempotencyKey" }], requestBody: jsonBody(), responses: { 201: response() } } },
  "/rubriques/{type}/{id}": { get: { ...crudList("Rubriques"), summary: "Détail d’une rubrique", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string" } }, id] }, put: { ...crudList("Rubriques"), summary: "Modifier une rubrique", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string" } }, id], requestBody: jsonBody() } },
  "/rubriques/{type}/{id}/statut": { patch: { ...crudList("Rubriques"), summary: "Activer ou désactiver une rubrique", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string" } }, id], requestBody: jsonBody() } },
  "/comptes": { get: crudList("Comptes"), post: { ...crudList("Comptes"), summary: "Créer un compte", parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], requestBody: jsonBody(), responses: { 201: response() } } },
  "/comptes/{id}": { get: { ...crudList("Comptes"), summary: "Détail d’un compte", parameters: [id] }, put: { ...crudList("Comptes"), summary: "Modifier un compte", parameters: [id], requestBody: jsonBody() } },
  "/comptes/{id}/statut": { patch: { ...crudList("Comptes"), summary: "Modifier le statut d’un compte", parameters: [id], requestBody: jsonBody() } },
  "/comptes/{id}/solde": { get: { ...crudList("Comptes"), summary: "Consulter le solde d’un compte", parameters: [id] } },
  "/comptes/{id}/mouvements": { get: { ...crudList("Comptes"), summary: "Lister les mouvements d’un compte", parameters: [id] } },
  "/comptes/{id}/ajustements": { post: { ...crudList("Comptes"), summary: "Ajuster un compte (administrateur uniquement)", parameters: [id, { $ref: "#/components/parameters/IdempotencyKey" }], requestBody: jsonBody(), responses: { 201: response(), 403: response("Réservé aux administrateurs") } } },
  "/tresorerie/synthese": { get: crudList("Trésorerie") },
  "/contribution-diocesaine": { get: crudList("Contribution diocésaine"), post: { ...crudList("Contribution diocésaine"), summary: "Créer une contribution diocésaine", parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], requestBody: jsonBody(), responses: { 201: response() } } },
  "/contribution-diocesaine/synthese": { get: crudList("Contribution diocésaine") },
  "/contribution-diocesaine/calcul": { post: { ...crudList("Contribution diocésaine"), summary: "Calculer une contribution", requestBody: jsonBody() } },
  "/contribution-diocesaine/generation": { post: { ...crudList("Contribution diocésaine"), summary: "Générer une contribution", parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], requestBody: jsonBody(), responses: { 201: response() } } },
  "/contribution-diocesaine/{id}": { get: { ...crudList("Contribution diocésaine"), summary: "Détail d’une contribution", parameters: [id] }, put: { ...crudList("Contribution diocésaine"), summary: "Corriger une contribution valide par contre-écriture", description: "La période et les données historiques du calcul restent immuables. Les mouvements précédents ne sont jamais supprimés.", parameters: [id], requestBody: jsonBody(), responses: { 200: response(), 409: response("Contribution annulée"), 422: response("Données ou compte invalides") } } },
  "/contribution-diocesaine/{id}/operations": { get: { ...crudList("Contribution diocésaine"), summary: "Opérations liées", parameters: [id] } },
  "/contribution-diocesaine/{id}/annulation": { post: { ...crudList("Contribution diocésaine"), summary: "Annuler une contribution", parameters: [id], requestBody: jsonBody() } },
  "/justificatifs": { get: crudList("Justificatifs"), post: { ...crudList("Justificatifs"), summary: "Téléverser un justificatif", requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { fichier: { type: "string", format: "binary" }, description: { type: "string" } }, required: ["fichier"] } } } }, responses: { 201: response(), 413: response("Fichier trop volumineux") } } },
  "/justificatifs/{id}": { get: { ...crudList("Justificatifs"), summary: "Détail d’un justificatif", parameters: [id] }, delete: { ...crudList("Justificatifs"), summary: "Supprimer un justificatif", parameters: [id], responses: { 204: { description: "Supprimé" } } } },
  "/justificatifs/{id}/telechargement": { get: { ...crudList("Justificatifs"), summary: "Télécharger un justificatif", parameters: [id], responses: { 200: { description: "Contenu binaire" } } } },
  "/justificatifs/{id}/liaison": { post: { ...crudList("Justificatifs"), summary: "Lier un justificatif à une opération", parameters: [id], requestBody: jsonBody() } },
  "/operations/{type}/{id}/justificatifs": { get: { ...crudList("Justificatifs"), summary: "Justificatifs d’une opération", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string", enum: ["cotisations", "recettes", "dons", "depenses"] } }, id] } },
  "/recherche": { get: crudList("Recherche") },
  "/rapports": { get: crudList("Rapports") },
  "/rapports/{type}": { get: { ...crudList("Rapports"), summary: "Consulter un rapport", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string" } }] } },
  "/rapports/{type}/export": { get: { ...crudList("Rapports"), summary: "Exporter un rapport", parameters: [{ name: "type", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Fichier CSV, XLSX ou PDF" } } } },
  "/echanges": { get: crudList("Échanges") },
  "/echanges/{resource}/export": { get: { ...crudList("Échanges"), summary: "Exporter une ressource", parameters: [{ name: "resource", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Fichier CSV ou XLSX" } } } },
  "/echanges/{resource}/modele": { get: { ...crudList("Échanges"), summary: "Télécharger le modèle d’import", parameters: [{ name: "resource", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Modèle CSV ou XLSX" } } } },
  "/echanges/{resource}/import": { post: { ...crudList("Échanges"), summary: "Importer une ressource", parameters: [{ name: "resource", in: "path", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { fichier: { type: "string", format: "binary" }, simulation: { type: "boolean" }, partiel: { type: "boolean" } }, required: ["fichier"] } } } } } },
  "/anomalies": { get: crudList("Anomalies") },
  "/anomalies/regles": { get: crudList("Anomalies") },
  "/anomalies/analyse": { post: { ...crudList("Anomalies"), summary: "Lancer l’analyse des anomalies" } },
  "/anomalies/{id}": { get: { ...crudList("Anomalies"), summary: "Détail d’une anomalie", parameters: [id] } },
  "/anomalies/{id}/statut": { patch: { ...crudList("Anomalies"), summary: "Modifier le statut d’une anomalie", parameters: [id], requestBody: jsonBody() } },
  "/anomalies/{id}/resolution": { post: { ...crudList("Anomalies"), summary: "Résoudre une anomalie", parameters: [id], requestBody: jsonBody() } },
  "/parametres": { get: crudList("Paramètres") },
  "/parametres/generaux": { put: { ...crudList("Paramètres"), summary: "Modifier les paramètres généraux", requestBody: jsonBody() } },
  "/parametres/preferences": { get: crudList("Paramètres"), put: { ...crudList("Paramètres"), summary: "Modifier ses préférences", requestBody: jsonBody() } },
  "/aide": { get: crudList("Aide") },
  "/aide/{slug}": { get: { ...crudList("Aide"), summary: "Consulter une rubrique d’aide", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }] } },
  "/admin/users": { get: { ...crudList("Administration"), summary: "Lister les utilisateurs (administrateur)" }, post: { ...crudList("Administration"), summary: "Créer un utilisateur (administrateur)", requestBody: jsonBody(), responses: { 201: response(), 403: response() } } },
  "/admin/users/{id}": { get: { ...crudList("Administration"), summary: "Détail d’un utilisateur (administrateur)", parameters: [id] }, put: { ...crudList("Administration"), summary: "Modifier un utilisateur (administrateur)", parameters: [id], requestBody: jsonBody() } },
  "/admin/users/{id}/statut": { patch: { ...crudList("Administration"), summary: "Activer ou désactiver un utilisateur (administrateur)", parameters: [id], requestBody: jsonBody() } },
  "/admin/notifications/outbox": { get: { ...crudList("Administration"), summary: "Consulter la file e-mail (administrateur)", description: "La réponse masque les destinataires et n’expose jamais les payloads, tokens ou clés de déduplication.", parameters: [{ name: "status", in: "query", schema: { type: "string", enum: ["pending", "processing", "sent", "dead"] } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } }] } },
  "/admin/notifications/outbox/{id}/retry": { post: { ...crudList("Administration"), summary: "Relancer une notification morte (administrateur)", description: "Seul le statut dead peut être relancé. La relance est auditée et reçoit une nouvelle clé d’idempotence fournisseur.", parameters: [id], responses: { 200: response(), 404: response("Notification inconnue"), 409: response("Notification non relançable"), 422: response("Limite de relances atteinte") } } },
}

for (const [resource, label] of [["cotisations", "Cotisations"], ["recettes", "Recettes"], ["dons", "Dons"], ["depenses", "Dépenses"]]) {
  paths[`/${resource}`] = {
    get: { ...crudList(label), summary: `Lister les ${label.toLowerCase()}` },
    post: { ...crudList(label), summary: `Créer une opération de type ${label.toLowerCase()}`, parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }], requestBody: jsonBody(), responses: { 201: response(), 409: response("Conflit d’idempotence") } },
  }
  paths[`/${resource}/{id}`] = {
    get: { ...crudList(label), summary: `Détail d’une opération (${label.toLowerCase()})`, parameters: [id] },
    put: { ...crudList(label), summary: `Modifier une opération (${label.toLowerCase()})`, parameters: [id], requestBody: jsonBody() },
  }
  paths[`/${resource}/{id}/annulation`] = { post: { ...crudList(label), summary: `Annuler une opération (${label.toLowerCase()})`, parameters: [id], requestBody: jsonBody({ type: "object", required: ["motif"], properties: { motif: { type: "string" } } }) } }
}

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Misericorde Divine API",
    version: "1.0.0",
    description: "Contrat HTTP du backend Misericorde Divine. Les réponses métier suivent l’enveloppe `{ success, data, meta? }`; les erreurs suivent `{ success: false, error: { code, message, fields, requestId } }`. Les routes métier nécessitent une session créée par `/auth/login`.",
  },
  servers: [{ url: "/api", description: "API sur le même domaine que cette documentation" }],
  tags: [tag("Système", "Disponibilité"), tag("Authentification", "Sessions et mots de passe"), tag("Notifications", "Traitement e-mail planifié"), tag("Tableau de bord", "Synthèse"), tag("Membres", "Référentiel des membres"), tag("Rubriques", "Référentiels de classement"), tag("Comptes", "Comptes et mouvements"), tag("Trésorerie", "Positions de trésorerie"), tag("Contribution diocésaine", "Calculs et versements diocésains"), tag("Justificatifs", "Pièces jointes"), tag("Recherche", "Recherche globale"), tag("Rapports", "Consultation et export"), tag("Échanges", "Import et export"), tag("Anomalies", "Détection et résolution"), tag("Paramètres", "Paramètres et préférences"), tag("Aide", "Aide intégrée"), tag("Administration", "Gestion des utilisateurs et de la file e-mail")],
  paths,
  components: {
    securitySchemes: {
      SessionCookie: { type: "apiKey", in: "cookie", name: "md_session", description: "Cookie HttpOnly défini par POST /auth/login." },
      CronBearer: { type: "http", scheme: "bearer", description: "Valeur de CRON_SECRET, réservée au cron de confiance." },
    },
    parameters: {
      IdempotencyKey: { name: "Idempotency-Key", in: "header", required: false, description: "Clé unique réutilisable pour une nouvelle tentative du même POST avec le même corps.", schema: { type: "string", maxLength: 128 } },
    },
    schemas: {
      ApiResponse: { type: "object", properties: { success: { type: "boolean" }, data: {}, meta: { type: "object", additionalProperties: true } }, required: ["success"] },
      ApiError: { type: "object", properties: { success: { type: "boolean", enum: [false] }, error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, fields: { type: "object", additionalProperties: true }, requestId: { type: "string" } }, required: ["code", "message"] } }, required: ["success", "error"] },
    },
  },
}
