# Backend Node.js et MySQL — Miséricorde Divine

Ce document décrit les contrats métier et les responsabilités de l’API. Une implémentation Express/MySQL est maintenant présente dans `backend/src` ; les routes et validations exécutables font foi en cas d’écart avec cette spécification. Les calculs financiers, les validations définitives et les contrôles d’autorisation restent côté backend.

## État de l’implémentation

Le code exécutable et les routes réellement montées sont recensés dans [l’audit d’intégration frontend/API/MySQL](docs/INTEGRATION_AUDIT.md). Les sections ci-dessous conservent aussi des éléments de conception et des propositions initiales : une méthode ou route mentionnée comme recommandation ne doit pas être considérée comme implémentée sans vérification dans `backend/src/routes` et `backend/src/services`.

Le socle actuel utilise Express, MySQL, migrations versionnées, sessions par cookie HttpOnly et services métier transactionnels. Les tables et contrôles effectifs sont ceux des migrations et schémas Zod exécutés. Les montants sont stockés en `DECIMAL`; les mouvements de compte constituent la source de calcul des soldes.

## 1. Architecture recommandée

```text
backend/
├── src/
│   ├── config/
│   │   ├── database.js
│   │   ├── environment.js
│   │   └── logger.js
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── repositories/
│   ├── validators/
│   ├── middlewares/
│   ├── models/
│   ├── utils/
│   ├── jobs/
│   ├── app.js
│   └── server.js
├── migrations/
├── seeds/
├── uploads/
├── tests/
├── .env.example
└── package.json
```

### Responsabilités

- **Routes** : déclarer les URL et les middlewares.
- **Controllers** : lire la requête HTTP, appeler le service et construire la réponse.
- **Services** : appliquer les règles métier et coordonner les transactions.
- **Repositories** : exécuter les requêtes MySQL sans décider des règles métier.
- **Validators** : valider les paramètres, filtres et corps de requête.
- **Middlewares** : authentification, erreurs, journalisation et contrôles transversaux.

Les controllers ne doivent contenir ni requêtes SQL ni calculs financiers complexes.

## 2. Méthodes techniques communes

### `createDatabasePool()`

Créer un pool MySQL avec `mysql2/promise` ou une solution équivalente :

- hôte, port et nom de la base ;
- utilisateur et mot de passe provenant des variables d’environnement ;
- limite de connexions ;
- encodage `utf8mb4` ;
- fuseau horaire documenté.

### `checkDatabaseConnection()`

Vérifier la disponibilité de MySQL au démarrage sans exposer les identifiants ou autres secrets.

### `withTransaction(callback)`

Exécuter une opération dans une transaction :

1. récupérer une connexion ;
2. commencer la transaction ;
3. exécuter le callback ;
4. valider avec `COMMIT` ;
5. exécuter `ROLLBACK` en cas d’erreur ;
6. libérer la connexion.

Une écriture financière et son mouvement de compte doivent appartenir à la même transaction.

### `runMigrations()`

Appliquer les migrations SQL versionnées. Les tables de production ne doivent pas être modifiées
manuellement.

### `parsePagination(query)`

Normaliser `page`, `limit` et `offset`, avec une limite maximale de résultats par requête.

### `parseSort(query, allowedFields)`

Autoriser uniquement les colonnes déclarées afin d’empêcher l’injection d’un nom de colonne ou
d’une direction de tri.

### `normalizeDateRange(dateDebut, dateFin)`

- valider les deux dates ;
- vérifier leur ordre ;
- documenter si les bornes sont inclusives ;
- ne pas choisir arbitrairement une période métier.

### `normalizeSearchTerm(value)`

Nettoyer les espaces, limiter la longueur et transmettre la valeur dans une requête SQL préparée.

### `sendSuccess(res, data, meta)`

Format recommandé :

```json
{
  "success": true,
  "data": {},
  "meta": {
    "page": 1,
    "limit": 25,
    "total": 120,
    "totalPages": 5
  }
}
```

### `sendError(res, error)`

Format recommandé :

```json
{
  "success": false,
  "error": {
    "code": "MEMBRE_NOT_FOUND",
    "message": "Le membre demandé est introuvable.",
    "fields": {}
  }
}
```

### `createAuditLog(data, transaction)`

Enregistrer :

- l’utilisateur ;
- l’action ;
- le type et l’identifiant de l’entité ;
- la date ;
- les anciennes et nouvelles valeurs nécessaires ;
- un contexte technique minimal.

Ne jamais journaliser les mots de passe, cookies ou secrets.

## 3. Authentification et sessions

Un seul rôle opérationnel est actuellement prévu. Il n’est pas nécessaire d’inventer plusieurs
rôles, mais chaque action doit être associée à un utilisateur authentifié.

### Méthodes

#### `login(credentials)`

- rechercher l’utilisateur ;
- vérifier le mot de passe avec Argon2 ou bcrypt ;
- vérifier que le compte est actif ;
- créer une session ;
- retourner uniquement les informations publiques du compte.

#### `logout(sessionId)`

Invalider la session côté serveur et supprimer le cookie.

#### `getCurrentUser(sessionId)`

Retourner l’utilisateur connecté sans donnée sensible.

#### `changePassword(userId, data)`

Vérifier l’ancien mot de passe, valider le nouveau, stocker uniquement son hash et révoquer les
sessions si nécessaire.

#### `revokeExpiredSessions()`

Supprimer ou invalider périodiquement les sessions expirées.

### Middlewares

#### `authenticate(req, res, next)`

Lire le cookie sécurisé, vérifier la session, attacher l’utilisateur à `req.user` et retourner
`401` si la session est invalide.

#### `requireActiveAccount(req, res, next)`

Bloquer les actions d’un compte désactivé.

### Routes

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
PUT  /api/auth/password
```

Les cookies doivent être `HttpOnly`, `Secure` en production et utiliser une politique `SameSite`
adaptée.

## 4. Tableau de bord

### `getDashboardSummary(filters)`

Retourner une synthèse calculée côté backend :

- total des membres ;
- total des cotisations ;
- total des recettes ;
- total des dons ;
- total des dépenses ;
- solde de caisse ;
- soldes bancaires ;
- situation diocésaine ;
- dernières opérations ;
- séries temporelles des graphiques.

### Méthodes internes

```js
countActiveMembers(filters)
sumContributions(filters)
sumRevenues(filters)
sumDonations(filters)
sumExpenses(filters)
getAccountBalances(filters)
getDiocesanSummary(filters)
getRecentOperations(filters)
getFinancialEvolution(filters)
getRevenueBreakdown(filters)
getExpenseBreakdown(filters)
```

### Route

```text
GET /api/dashboard?dateDebut=...&dateFin=...
```

Les statuts inclus dans chaque total doivent être définis par les règles métier.

## 5. Membres

### Service

#### `listMembers(filters, pagination, sort)`

Rechercher, filtrer, trier et paginer les membres.

#### `getMemberById(memberId)`

Retourner la fiche détaillée ou l’erreur `MEMBRE_NOT_FOUND`.

#### `createMember(data, currentUser)`

- valider les champs ;
- contrôler les règles d’unicité ;
- générer une référence si cette règle est confirmée ;
- enregistrer le membre ;
- créer une trace d’audit.

#### `updateMember(memberId, data, currentUser)`

Vérifier l’existence, limiter les champs modifiables, contrôler les conflits et journaliser la
modification.

#### `archiveMember(memberId, currentUser)`

Archiver plutôt que supprimer physiquement un membre possédant des opérations.

#### `getMemberOperations(memberId, filters, pagination)`

Retourner les opérations liées au membre.

#### `getMemberFinancialSummary(memberId, filters)`

Retourner une synthèse calculée par le backend.

### Repository

```js
findAll(filters, pagination, sort)
findById(memberId)
findByReference(reference)
findByUniqueFields(data)
insert(data, transaction)
updateById(memberId, data, transaction)
archiveById(memberId, transaction)
count(filters)
findOperations(memberId, filters, pagination)
```

### Routes

```text
GET   /api/membres
POST  /api/membres
GET   /api/membres/:id
PUT   /api/membres/:id
PATCH /api/membres/:id/statut
GET   /api/membres/:id/operations
GET   /api/membres/:id/synthese-financiere
```

## 6. Rubriques et référentiels

### Méthodes des rubriques de cotisation

```js
listContributionCategories(filters)
createContributionCategory(data)
updateContributionCategory(id, data)
disableContributionCategory(id)
isCategoryUsable(id, operationType)
```

### Méthodes des autres rubriques

```js
listExpenseCategories(filters)
createExpenseCategory(data)
updateExpenseCategory(id, data)
disableExpenseCategory(id)

listRevenueCategories(filters)
createRevenueCategory(data)
updateRevenueCategory(id, data)
disableRevenueCategory(id)

listDonationCategories(filters)
createDonationCategory(data)
updateDonationCategory(id, data)
disableDonationCategory(id)
```

### Routes

```text
GET   /api/rubriques/cotisations
POST  /api/rubriques/cotisations
PUT   /api/rubriques/cotisations/:id
PATCH /api/rubriques/cotisations/:id/statut

GET   /api/rubriques/depenses
POST  /api/rubriques/depenses
PUT   /api/rubriques/depenses/:id
PATCH /api/rubriques/depenses/:id/statut
```

Une rubrique utilisée historiquement ne doit pas être supprimée physiquement.

## 7. Cotisations

### `listContributions(filters, pagination, sort)`

Filtres : membre, période, rubrique, statut, référence et compte de destination.

### `getContributionById(id)`

Retourner l’opération, le membre, la rubrique, le compte, les justificatifs et l’historique.

### `createContribution(data, currentUser)`

Dans une transaction :

1. vérifier le membre ;
2. vérifier la rubrique ;
3. vérifier le compte de destination ;
4. valider le montant ;
5. créer la cotisation ;
6. créer le mouvement financier ;
7. créer la trace d’audit ;
8. valider la transaction.

### `updateContribution(id, data, currentUser)`

Modifier uniquement si le statut et les règles métier le permettent.

### `cancelContribution(id, reason, currentUser)`

Conserver le motif et l’historique. Une contre-écriture peut être nécessaire selon les règles
comptables validées.

### Méthodes complémentaires

```js
getMemberContributions(memberId, filters)
getExpectedContributions(memberId, period)
calculateContributionDelay(memberId, period)
```

Les deux dernières méthodes ne doivent être développées qu’après définition des échéances,
montants attendus, pénalités et tolérances.

### Routes

```text
GET  /api/cotisations
POST /api/cotisations
GET  /api/cotisations/:id
PUT  /api/cotisations/:id
POST /api/cotisations/:id/annulation
GET  /api/membres/:id/cotisations
```

## 8. Recettes

### Méthodes

```js
listRevenues(filters, pagination, sort)
getRevenueById(id)
createRevenue(data, currentUser)
updateRevenue(id, data, currentUser)
cancelRevenue(id, reason, currentUser)
getRevenueAttachments(id)
```

`createRevenue()` doit préserver la distinction entre recette, cotisation, don et offrande.

### Routes

```text
GET  /api/recettes
POST /api/recettes
GET  /api/recettes/:id
PUT  /api/recettes/:id
POST /api/recettes/:id/annulation
```

## 9. Dons et offrandes

### Méthodes

```js
listDonations(filters, pagination, sort)
getDonationById(id)
createDonation(data, currentUser)
updateDonation(id, data, currentUser)
cancelDonation(id, reason, currentUser)
```

Le modèle doit conserver la distinction entre don, offrande et autres catégories validées.

### Routes

```text
GET  /api/dons
POST /api/dons
GET  /api/dons/:id
PUT  /api/dons/:id
POST /api/dons/:id/annulation
```

## 10. Dépenses

### `listExpenses(filters, pagination, sort)`

Filtrer par période, rubrique, statut, compte, référence et intervalle de montant.

### `createExpense(data, currentUser)`

Dans une transaction :

1. vérifier la rubrique ;
2. vérifier le compte ou la caisse ;
3. valider le montant ;
4. créer la dépense ;
5. créer le mouvement de sortie ;
6. créer l’audit ;
7. valider la transaction.

### Autres méthodes

```js
getExpenseById(id)
updateExpense(id, data, currentUser)
submitExpenseForValidation(id, currentUser)
validateExpense(id, currentUser)
rejectExpense(id, reason, currentUser)
cancelExpense(id, reason, currentUser)
```

Les méthodes de soumission, validation et rejet doivent être retirées si aucun circuit de
validation n’est prévu.

### Routes

```text
GET  /api/depenses
POST /api/depenses
GET  /api/depenses/:id
PUT  /api/depenses/:id
POST /api/depenses/:id/soumission
POST /api/depenses/:id/validation
POST /api/depenses/:id/rejet
POST /api/depenses/:id/annulation
```

## 11. Caisse et comptes bancaires

### Méthodes des comptes

```js
listAccounts(filters)
getAccountById(id)
createAccount(data, currentUser)
updateAccount(id, data, currentUser)
disableAccount(id, currentUser)
getAccountBalance(id, asOfDate)
getAccountMovements(id, filters, pagination)
```

### `createFinancialMovement(data, transaction)`

Méthode interne centrale enregistrant :

- le compte ;
- le sens, entrée ou sortie ;
- le montant ;
- la date ;
- le type et l’identifiant de l’opération source ;
- la référence ;
- le statut.

Cette méthode doit être appelée par les services métier et non directement par le frontend.

### Méthodes de synthèse

```js
getCashPosition(filters)
getBankPosition(filters)
getConsolidatedPosition(filters)
getReconciliationData(accountId, period)
```

Le rapprochement doit attendre la définition des règles correspondantes.

### Routes

```text
GET /api/comptes
GET /api/comptes/:id
GET /api/comptes/:id/solde
GET /api/comptes/:id/mouvements
GET /api/tresorerie/synthese
```

Ne pas exposer de transfert bancaire réel sans spécification explicite.

## 12. Contribution diocésaine

### Méthodes minimales

```js
listDiocesanContributions(filters, pagination)
getDiocesanContributionById(id)
createDiocesanContribution(data, currentUser)
getDiocesanSummary(filters)
getRelatedOperations(id)
getDiocesanReport(filters)
```

### Méthodes conditionnelles

```js
calculateDiocesanContribution(period)
generateDiocesanContribution(period)
```

Ces calculs doivent attendre la validation du taux éventuel, de l’assiette, des périodes, des
arrondis et du traitement des annulations.

### Routes

```text
GET  /api/contribution-diocesaine
POST /api/contribution-diocesaine
GET  /api/contribution-diocesaine/synthese
GET  /api/contribution-diocesaine/:id
GET  /api/contribution-diocesaine/:id/operations
```

## 13. Justificatifs

MySQL doit conserver les métadonnées et la clé de stockage. Éviter de stocker les fichiers sous
forme de longues chaînes Base64.

### `uploadAttachment(file, metadata, currentUser)`

- vérifier le type MIME et la taille ;
- générer un nom interne non prévisible ;
- stocker le fichier ;
- enregistrer les métadonnées ;
- associer le justificatif à l’opération.

### Autres méthodes

```js
listAttachments(filters, pagination)
getAttachmentById(id)
downloadAttachment(id, currentUser)
deleteAttachment(id, currentUser)
linkAttachmentToOperation(attachmentId, operationType, operationId)
```

`downloadAttachment()` doit vérifier les droits et ne pas exposer un chemin interne.

### Routes

```text
GET    /api/justificatifs
POST   /api/justificatifs
GET    /api/justificatifs/:id
GET    /api/justificatifs/:id/telechargement
DELETE /api/justificatifs/:id
GET    /api/operations/:type/:id/justificatifs
```

Utiliser `multipart/form-data`, par exemple avec Multer, puis un stockage objet en production.

## 14. Recherche

### `globalSearch(query, categories, filters, currentUser)`

- limiter les catégories accessibles ;
- rechercher dans les membres et opérations ;
- appliquer la pagination ;
- retourner le type de chaque résultat ;
- respecter les autorisations.

### Méthodes internes

```js
searchMembers(query, filters, pagination)
searchContributions(query, filters, pagination)
searchRevenues(query, filters, pagination)
searchDonations(query, filters, pagination)
searchExpenses(query, filters, pagination)
searchAttachments(query, filters, pagination)
```

### Route

```text
GET /api/recherche?q=...&categories=membres,depenses&page=1
```

## 15. Rapports et exports

### Méthodes

```js
getContributionReport(filters)
getRevenueReport(filters)
getDonationReport(filters)
getExpenseReport(filters)
getTreasuryReport(filters)
getDiocesanReport(filters)
getFinancialSummaryReport(filters)
getOperationHistoryReport(filters)
```

### Exports

```js
exportReportToCsv(reportType, filters)
exportReportToExcel(reportType, filters)
exportReportToPdf(reportType, filters)
```

Les exports et les écrans doivent utiliser les mêmes services de données.

### Routes

```text
GET /api/rapports/cotisations
GET /api/rapports/recettes
GET /api/rapports/depenses
GET /api/rapports/tresorerie
GET /api/rapports/contribution-diocesaine
GET /api/rapports/synthese-financiere
GET /api/rapports/:type/export?format=csv
```

## 16. Anomalies

### Méthodes

```js
runAnomalyChecks(context)
createAnomaly(data, transaction)
listAnomalies(filters, pagination)
getAnomalyById(id)
updateAnomalyStatus(id, status, comment, currentUser)
resolveAnomaly(id, resolution, currentUser)
```

Seules les anomalies fondées sur des contrôles métier documentés doivent être créées.

### Routes

```text
GET   /api/anomalies
GET   /api/anomalies/:id
PATCH /api/anomalies/:id/statut
POST  /api/anomalies/:id/resolution
```

## 17. Paramètres

### Méthodes

```js
getGeneralSettings()
updateGeneralSettings(data, currentUser)
getDisplayPreferences(userId)
updateDisplayPreferences(userId, data)
getSessionSecuritySettings()
```

Les rubriques financières configurables doivent avoir leurs propres tables et validations.

### Routes

```text
GET /api/parametres
PUT /api/parametres/generaux
GET /api/parametres/preferences
PUT /api/parametres/preferences
```

## 18. Aide et partage

### Aide

```js
listHelpSections()
getHelpSection(slug)
```

### Partage

Ne pas développer le partage avant d’en avoir défini la signification, les droits, la durée et les
données concernées. Si un partage sécurisé de documents est confirmé :

```js
createSecureDocumentShare()
revokeDocumentShare()
listDocumentShares()
```

## 19. Tables MySQL indicatives

```text
users
sessions
members

contribution_categories
contributions

revenue_categories
revenues

donation_categories
donations

expense_categories
expenses

financial_accounts
financial_movements

diocesan_contributions
attachments
operation_attachments

anomalies
anomaly_history

settings
audit_logs
```

Des tables d’historique peuvent être nécessaires :

```text
contribution_status_history
expense_status_history
revenue_status_history
```

## 20. Règles de persistance financière

### Utiliser `DECIMAL`

```sql
montant DECIMAL(15, 2) NOT NULL
```

Ne jamais utiliser `FLOAT` ou `DOUBLE` pour les montants. Le pilote MySQL peut retourner un
`DECIMAL` sous forme de chaîne ; utiliser une bibliothèque décimale pour les calculs complexes.

### Transactions

Une opération financière et son mouvement de compte doivent être créés dans la même transaction.

### Références uniques

Chaque opération devrait posséder une référence serveur unique, selon une convention à valider :

```text
CT-2025-000148
DP-2025-000082
```

Ajouter une contrainte MySQL `UNIQUE`.

### Pas de suppression physique automatique

Pour les opérations financières :

- utiliser des statuts ;
- conserver l’historique ;
- journaliser l’annulation ;
- prévoir une contre-écriture si les règles l’exigent.

### Idempotence

```js
checkIdempotencyKey(key, userId)
saveIdempotentResponse(key, response, transaction)
```

Les routes de création financière peuvent accepter un en-tête `Idempotency-Key` pour empêcher une
double création.

### Concurrence

Utiliser des transactions et, si nécessaire, `SELECT ... FOR UPDATE` pour empêcher les validations
ou mises à jour concurrentes.

## 21. Index MySQL indicatifs

```sql
CREATE INDEX idx_members_reference ON members(reference);
CREATE INDEX idx_members_name ON members(nom, prenom);

CREATE INDEX idx_contributions_date ON contributions(date_operation);
CREATE INDEX idx_contributions_member ON contributions(member_id);
CREATE INDEX idx_contributions_category ON contributions(category_id);

CREATE INDEX idx_expenses_date ON expenses(date_operation);
CREATE INDEX idx_expenses_category ON expenses(category_id);

CREATE INDEX idx_movements_account_date
ON financial_movements(account_id, date_operation);

CREATE INDEX idx_attachments_operation
ON operation_attachments(operation_type, operation_id);
```

Les index définitifs doivent être ajustés selon les requêtes réellement utilisées.

## 22. Codes HTTP

```text
200 OK                    Lecture ou modification réussie
201 Created               Création réussie
204 No Content            Action sans contenu
400 Bad Request           Requête invalide
401 Unauthorized          Session absente ou expirée
403 Forbidden             Action interdite
404 Not Found             Ressource inexistante
409 Conflict              Doublon ou conflit d’état
413 Payload Too Large     Fichier trop volumineux
415 Unsupported Media     Format de fichier refusé
422 Unprocessable Entity  Validation métier
429 Too Many Requests     Trop de tentatives
500 Internal Server Error Erreur non prévue
```

## 23. Middlewares

```js
authenticate
requireActiveAccount
validateBody(schema)
validateQuery(schema)
validateParams(schema)
handleFileUpload
rateLimitAuthentication
attachRequestId
notFoundHandler
errorHandler
```

### `errorHandler(error, req, res, next)`

- convertir les erreurs en réponses cohérentes ;
- masquer les détails SQL ;
- ne pas exposer la stack en production ;
- associer un identifiant de requête ;
- journaliser uniquement les informations nécessaires.

## 24. Tests backend

### Tests unitaires

- validation des montants ;
- changements de statut ;
- génération des références ;
- règles d’annulation ;
- pagination et filtres ;
- calculs financiers officiellement validés.

### Tests d’intégration

- création d’un membre ;
- création d’une cotisation et de son mouvement ;
- rollback si une étape échoue ;
- création d’une dépense ;
- authentification ;
- téléversement ;
- recherche et rapports.

### Tests de concurrence

Vérifier qu’une même opération ne peut pas être créée ou validée deux fois.

### Tests de sécurité

- injection SQL ;
- accès sans session ;
- fichiers dangereux ;
- dépassement de taille ;
- paramètres de tri non autorisés ;
- accès non autorisé à un justificatif.

## 25. Ordre de développement recommandé

1. Configurer Node.js, Express et MySQL.
2. Créer les migrations et le modèle de données.
3. Centraliser les erreurs et la validation.
4. Développer l’authentification et les sessions.
5. Développer les membres.
6. Développer les rubriques configurables.
7. Développer les comptes et mouvements financiers.
8. Développer les cotisations.
9. Développer les recettes.
10. Développer les dons et offrandes.
11. Développer les dépenses.
12. Développer les justificatifs.
13. Développer le tableau de bord.
14. Développer la contribution diocésaine après validation des règles.
15. Développer la recherche.
16. Développer les rapports et exports.
17. Développer les anomalies après définition des contrôles.
18. Développer les paramètres.
19. Documenter l’API avec OpenAPI.
20. Compléter les tests d’intégration, de concurrence et de sécurité.

## 26. Décisions métier obligatoires

Les points suivants ne doivent pas être inventés :

- champs obligatoires d’un membre ;
- définition d’un membre actif ;
- montants et périodicité des cotisations ;
- règles de retard et pénalités ;
- statuts des opérations ;
- procédure de validation ;
- procédure d’annulation ;
- calcul de la contribution diocésaine ;
- définition officielle du solde ;
- règles de rapprochement bancaire ;
- anomalies à détecter ;
- contenu exact des rapports ;
- droits sur les justificatifs ;
- signification du partage.

## 27. Prochain livrable backend recommandé

Créer un contrat OpenAPI accompagné du schéma MySQL initial. Ce contrat doit documenter :

- les routes réelles ;
- les paramètres ;
- les corps de requêtes ;
- les formats de réponse ;
- les codes d’erreur ;
- les règles de pagination ;
- les statuts métier ;
- les exemples de données.

Le frontend pourra ensuite être connecté sans supposer les noms de champs ou les formats de
réponse.
