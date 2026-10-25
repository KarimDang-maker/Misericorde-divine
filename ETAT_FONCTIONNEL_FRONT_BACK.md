# État fonctionnel du frontend et du backend

**Projet :** Miséricorde Divine  
**État observé :** 25 octobre 2026

Ce document décrit les fonctionnalités visibles dans le frontend et les routes/services repérés dans le backend. « Implémenté » signifie que le code existe ; cela ne constitue pas une certification de production ni la garantie que chaque règle métier a été validée par les responsables métier.

## 1. Comment les données traversent l’application

Pour les écrans branchés à l’API, le parcours courant est déjà :

```text
Formulaire ou action React
        → client Axios (src/api/httpClient.ts)
        → route Express (/api/...)
        → validation Zod et middleware d’authentification
        → service métier (backend/src/services/...)
        → requête SQL MySQL (transactions pour les écritures financières)
        → réponse API affichée par le frontend
```

Le frontend construit et transmet les requêtes ; il ne constitue pas la source de vérité pour les décisions métier. Les contrôles de validation et les écritures en base sont réalisés par les routes et services backend. Les conversions côté interface (par exemple texte vers nombre) ne remplacent pas ces contrôles serveur.

## 2. Fonctionnalités déjà présentes côté frontend

| Module | Fonctionnalités présentes dans l’interface |
| --- | --- |
| Connexion | Connexion, restauration de session via `/auth/me`, déconnexion et gestion des erreurs. |
| Tableau de bord | Indicateurs, évolution recettes/dépenses, répartition et dernières opérations chargés depuis l’API. |
| Membres | Liste paginée/recherche, création, consultation détaillée, modification, activation/désactivation, archivage, synthèse financière, opérations et cotisations liées. |
| Cotisations, recettes, dons, dépenses | Formulaire de création, choix des rubriques/comptes/membres concernés, liste/recherche/pagination, détails, modification et annulation motivée. |
| Rubriques | Consultation, recherche, création, modification, affichage du détail et activation/désactivation pour les catégories exposées par l’API. |
| Comptes et trésorerie | Création et modification de comptes, activation/désactivation, solde et mouvements d’un compte, synthèse caisse/banque/consolidée sur une période. |
| Contribution diocésaine | Calcul, synthèse, génération d’une écriture depuis une période et un compte, saisie manuelle, liste/détail, opérations liées et annulation. |
| Justificatifs | Téléversement avec description et rattachement facultatif, consultation, liaison à une opération, téléchargement et suppression. |
| Recherche | Recherche texte via `/recherche` et affichage des résultats renvoyés par l’API. |
| Rapports | Sélection d’un rapport, filtres par dates, consultation et export PDF, Excel ou CSV. |
| Échanges Excel/CSV | Liste des ressources, modèles, export, import en simulation ou enregistrement, mode partiel ou tout-ou-rien et affichage du résultat. |
| Anomalies | Lancement des contrôles, consultation des règles/liste/détails, mise à jour de statut et résolution commentée. |
| Paramètres | Lecture et modification des réglages généraux, préférences utilisateur, changement de mot de passe et lecture des paramètres de session. |
| Aide | Liste des guides et consultation d’une section. |
| Navigation | Routes de modules, interface partagée, états de chargement/erreur/vide et page inconnue. |

Plusieurs modules utilisent `ResourcePage` et `ModuleTools` communs. Le rendu de certains détails est encore générique (JSON), mais l’interface effectue déjà les appels API correspondants.

## 3. Fonctionnalités déjà présentes côté backend

Le backend est organisé en routes Express, schémas Zod, services métier et accès MySQL. Les routes métier, à l’exception de la santé et de l’authentification, sont protégées par l’authentification et l’exigence d’un compte actif.

| Domaine | Traitements/routes et services repérés |
| --- | --- |
| Sécurité/API | Enveloppe de réponse, identifiant de requête, erreurs normalisées, CORS, contrôle d’origine, limitation des tentatives de connexion et middleware de validation. `GET /api/sante`. |
| Authentification | `login`, `logout`, `getCurrentUser`, `changePassword`, révocation de sessions expirées ; sessions serveur et cookie. Pas de parcours d’administration des utilisateurs dans le frontend observé. |
| Membres | `listMembers`, `createMember`, `getMemberById`, `updateMember`, `setMemberStatus`, `getMemberOperations`, `getMemberFinancialSummary`, cotisations d’un membre. |
| Opérations financières | Service commun paramétré pour cotisations, recettes, dons et dépenses : validation, listing, détail, création, mise à jour et annulation. La création/annulation coordonne les écritures financières dans des transactions et écrit l’audit. |
| Comptes | `listAccounts`, `createAccount`, `getAccountById`, `updateAccount`, `setAccountActive`, `getAccountBalance`, `getAccountMovements` ; mouvements financiers et calculs de position de trésorerie. |
| Rubriques | Liste/détail, création, modification, activation, vérification d’existence et d’utilisation, avec un schéma adapté au type de rubrique. |
| Tableau de bord | Résumé, agrégats, évolution, ventilation par catégorie et opérations récentes. |
| Contribution diocésaine | Calcul, création manuelle ou génération à partir des paramètres, synthèse, détail, opérations liées et annulation. |
| Justificatifs | Téléversement, liste, détail, liaison, téléchargement et suppression ; contrôles de type/taille de fichier dans le middleware. |
| Recherche | Recherche globale dans membres, opérations et justificatifs avec catégories, filtres et pagination. |
| Rapports | Rapports des opérations, trésorerie, contribution diocésaine, synthèse financière et historique ; exports CSV, XLSX et PDF. |
| Échanges | Modèles, import/export CSV ou XLSX, simulation, import partiel ou tout-ou-rien et retour des erreurs par ligne. |
| Anomalies | Règles, analyse, liste/détail, changement de statut, résolution. |
| Paramètres/aide | Réglages généraux, préférences, lecture de sécurité de session, guides. |
| Persistance | Migration SQL initiale, script de migration, seed et pool MySQL ; requêtes paramétrées, validations de domaine et transactions disponibles dans les services. |

## 4. Méthodes nécessaires pour faire passer les données par le métier backend

### 4.1 Les méthodes de traitement de la majorité des formulaires actuels existent déjà

Pour les données actuellement saisissables dans l’interface, il ne faut pas recréer le métier dans React ni ajouter une seconde écriture directe en base. Les appels existants aboutissent aux services suivants :

| Donnée saisie/action | Route appelée par le frontend | Méthode métier backend existante |
| --- | --- | --- |
| Créer/modifier/statuer un membre | `POST/PUT/PATCH /api/membres...` | `createMember`, `updateMember`, `setMemberStatus` |
| Créer/modifier/annuler une écriture financière | `POST/PUT/POST .../:id/annulation` sous `/api/cotisations`, `/recettes`, `/dons`, `/depenses` | `createOperation`, `updateOperation`, `cancelOperation` |
| Créer/modifier/activer un compte | `POST/PUT/PATCH /api/comptes...` | `createAccount`, `updateAccount`, `setAccountActive` |
| Créer/modifier/activer une rubrique | `POST/PUT/PATCH /api/rubriques/:type...` | `createCategory`, `updateCategory`, `setCategoryActive` |
| Générer ou saisir contribution diocésaine | `POST /api/contribution-diocesaine...` | `calculateDiocesanContribution`, `generateDiocesanContribution`, `createDiocesanContribution` |
| Téléverser/relier/supprimer un justificatif | `POST/DELETE /api/justificatifs...` | `uploadAttachment`, `linkAttachmentToOperation`, `deleteAttachment` |
| Importer des données | `POST /api/echanges/:resource/import` | `importResource` et les services d’écriture associés |
| Modifier les paramètres | `PUT /api/parametres/...` | `updateGeneralSettings`, `updateDisplayPreferences` |

Les méthodes `apiPost`, `apiPut`, `apiPatch`, `apiUpload` du frontend sont des transporteurs HTTP, pas des méthodes métier. La validation d’autorité doit rester dans les schémas/routes et services backend.

### 4.2 Compléments recommandés selon les fonctionnalités déjà affichées

Les éléments ci-dessous sont des compléments de cohérence ou d’ergonomie. Ils ne signifient pas que la logique centrale de persistance correspondante manque au backend.

1. **Recherche avec filtres explicites dans l’interface**
   - Backend déjà disponible : `globalSearch(query, categories, filters, pagination)` via `GET /api/recherche`.
   - À compléter côté frontend : un écran de recherche dédié avec sélection des catégories, filtres et pagination, plutôt que le champ générique commun. Garder le traitement serveur dans `globalSearch`, `searchMembers`, `searchContributions`, `searchRevenues`, `searchDonations`, `searchExpenses` et `searchAttachments`.

2. **Préférences enregistrées au changement**
   - Backend déjà disponible : `getDisplayPreferences` et `updateDisplayPreferences`.
   - Si l’attente produit est que le thème, le masquage des montants ou le nombre de lignes s’appliquent partout, compléter le frontend par un état partagé qui charge et applique ces préférences sur les pages. Le formulaire de sauvegarde existe déjà ; l’application globale des valeurs est à vérifier/compléter.

3. **Édition métier de la contribution diocésaine**
   - Le backend expose la création et l’annulation, tandis que l’écran permet la saisie/génération et l’annulation.
   - Si une contribution validée doit être modifiable, définir d’abord la règle d’audit/contre-écriture, puis ajouter un schéma, une méthode de service transactionnelle (par exemple `updateDiocesanContribution`) et une route `PUT /api/contribution-diocesaine/:id`. Ne pas modifier librement une écriture déjà comptabilisée sans arbitrage métier.

4. **Gestion des utilisateurs**
   - Le frontend observé ne propose que connexion, déconnexion et changement de son propre mot de passe ; le backend contient `createUser` mais pas de flux complet visible de gestion des comptes.
   - Si l’application doit gérer plusieurs utilisateurs, développer après définition des rôles/droits : `listUsers`, `getUserById`, `updateUser`, `setUserActive` et, selon la règle retenue, création/réinitialisation contrôlée du mot de passe. Ajouter les routes protégées par autorisation, les validations, l’audit et les écrans associés. Ce besoin n’est pas requis pour les formulaires métier déjà branchés.

5. **Écriture comptable d’ajustement de compte**
   - L’interface peut créer un compte avec solde initial, consulter les mouvements et générer les mouvements par les opérations ; aucun écran de saisie de correction/inventaire de solde n’est observé.
   - Si un ajustement manuel est demandé, définir les justificatifs, droits, motif et contre-écriture, puis développer une méthode transactionnelle dédiée (par exemple `createAccountAdjustment`) et une route dédiée. Ne jamais permettre au frontend de remplacer directement un solde calculé.

6. **État de santé opérationnel**
   - `GET /api/sante` existe, mais n’est pas affiché dans le frontend observé. Une page de diagnostic n’est utile que pour l’administration ; ne pas exposer de détails sensibles de base de données aux utilisateurs non autorisés.

## 5. Ordre conseillé pour la suite

1. Établir avec le métier les règles non déterminées : rôles, validation/annulation, corrections comptables, calcul diocésain et champs obligatoires.
2. Prioriser la recherche dédiée et l’application globale des préférences, qui prolongent des fonctionnalités déjà visibles.
3. Ajouter une gestion des utilisateurs seulement si plusieurs profils et permissions sont nécessaires.
4. Ajouter modification de contribution ou ajustement de compte uniquement après validation des règles de traçabilité comptable.
5. Pour chaque nouvelle écriture : schéma Zod côté serveur → méthode de service métier → transaction et audit → route authentifiée → appel frontend → affichage de la réponse/erreur.

## 6. Références du code inspecté

- Frontend : `src/config/navigation.ts`, `src/app/routes.tsx`, `src/api/httpClient.ts`, `src/auth/AuthProvider.tsx`, `src/pages/shared/ResourcePage.tsx`, `src/pages/shared/ModuleTools.tsx`, `src/pages/categories/CategoryPage.tsx`, `src/pages/dashboard/DashboardPage.tsx`.
- Backend : `backend/src/app.js`, `backend/src/routes/*.js`, `backend/src/services/*.js`, `backend/src/config/database.js`, `backend/src/middlewares/*.js`, `backend/migrations/001_init.sql`.

---

## 7. Contrats détaillés entre les écrans et l’API

Toutes les réponses JSON de succès utilisent normalement `{ success: true, data, meta? }`. Les erreurs utilisent `{ success: false, error: { code, message, fields, requestId } }`. Le client Axios extrait ce format et envoie les cookies de session avec `withCredentials: true`.

| Écran/parcours | Contrat API effectivement utilisé | Couche métier et persistance |
| --- | --- | --- |
| Démarrage de session | `GET /api/auth/me`, `POST /api/auth/login` avec `{email,motDePasse}`, `POST /api/auth/logout` | Authentification du compte, hash du jeton de session, tables `users`, `sessions`, `audit_logs`; cookie HttpOnly. |
| Tableau de bord | `GET /api/dashboard?dateDebut&dateFin` | Agrégations de `dashboard.js`, opérations et mouvements, aucune écriture. Frontend consomme `data.membresActifs`, totaux, `dernieresOperations`, `evolution.points`, `repartitionRecettes`. |
| Membres | `GET /api/membres?q&page&limit`, `POST /api/membres`, `GET/PUT /api/membres/:id`, `PATCH /api/membres/:id/statut`, sous-routes synthèse/ops/cotisations | Zod impose nom/prénom, e-mail/date si renseignés, statut ; service gère référence, unicité, historique/audit et tables membres/opérations. |
| Opérations financières | Pour chaque type : `GET/POST /api/{cotisations,recettes,dons,depenses}`, `GET/PUT /:id`, `POST /:id/annulation` avec `{motif}` | Schémas dynamiques par type ; validation du montant, de la période, du compte, de la rubrique et du membre selon le type ; transaction pour opération, mouvement de compte et audit. Tables d’opérations et `financial_movements`. |
| Rubriques | `GET/POST /api/rubriques/:type`, `GET/PUT /:type/:id`, `PATCH /:type/:id/statut` | Service commun par type, codes uniques, audit et refus de suppression implicite ; tables de catégories dédiées. |
| Comptes | `GET/POST /api/comptes`, `GET/PUT /:id`, `PATCH /:id/statut`, `GET /:id/solde`, `GET /:id/mouvements`; `GET /api/tresorerie/synthese` | `accounts.js` calcule solde initial + entrées − sorties ; les mouvements ont une source de vérité dédiée. Les nouveaux soldes d’opérations sont produits par les écritures, pas par le frontend. |
| Contribution diocésaine | `GET/POST /api/contribution-diocesaine`, `/synthese`, `POST /calcul`, `POST /generation`, détail et annulation | Schéma distinct pour la saisie manuelle et période de calcul ; `diocese.js` récupère taux/assiette dans les paramètres, vérifie les règles, écrit contribution et mouvement en transaction. |
| Justificatifs | `POST /api/justificatifs` multipart (`fichier`, description), liste/détail, liaison, téléchargement, suppression | `upload.js` limite et filtre le fichier ; `attachments.js` enregistre métadonnées/empreinte et association. Le stockage actuellement configuré est disque local. |
| Recherche | `GET /api/recherche?q&categories&page&limit` | `globalSearch` délègue aux fonctions de recherche de chaque domaine ; renvoie `items`, `meta` et `categoriesDisponibles`. |
| Rapports | `GET /api/rapports`, `GET /:type?dateDebut&dateFin`, `GET /:type/export?format=...` | Calculs agrégés et génération PDF/XLSX/CSV côté serveur. |
| Import/export | `GET /api/echanges`, export, `/modele`, import multipart et options `simulation`, `partiel` | `exchange.js` interprète, rapproche et applique les lignes ; le mode simulation ne persiste pas ; l’application s’appuie sur les services métier correspondants. |
| Anomalies | `GET /api/anomalies`, `/regles`, `POST /analyse`, `GET /:id`, `PATCH /:id/statut`, `POST /:id/resolution` | Détection, empreinte de doublon, statuts et historique en base via `anomalies.js`. |
| Paramètres | `GET /api/parametres`, `GET/PUT /preferences`, `PUT /generaux`, `PUT /api/auth/password` | Réglages globaux JSON et préférences par utilisateur ; changement de mot de passe avec révocation des autres sessions. |
| Aide | `GET /api/aide`, `GET /:slug` | Contenu statique du service `help.js`, sans écriture MySQL. |

### Validations et garanties déjà mises en place

- Les corps sont validés avec Zod avant l’appel du service. Le middleware convertit les erreurs de validation en `422` et les associe à des champs.
- Les montants sont traités dans les services avec représentation décimale/centimes ; la base utilise `DECIMAL`, pas un flottant de précision approximative.
- Les opérations financières utilisent des transactions, références serveur et audit. L’annulation écrit une contre-écriture au lieu de supprimer l’opération originale.
- Les requêtes SQL de valeurs sont paramétrées. Les tris et certains filtres sont résolus par listes de colonnes autorisées dans les services.
- Le middleware de session s’exécute avant les routeurs métier. L’API autorise une origine CORS explicitement configurée et exige les cookies pour les routes protégées.
- La pagination est disponible sur les domaines qui renvoient `{items, meta}` ; les listes de rubriques/comptes ne sont pas toutes paginées de la même manière.

## 8. Écarts constatés qui empêchent une expérience frontend complètement normale

Ces points sont distincts de l’absence de logique métier : certains sont des défauts d’intégration à corriger même si le service backend existe.

### Priorité bloquante ou haute

1. **Préférences de l’utilisateur non appliquées dans l’interface**
   - Le frontend lit et enregistre `theme`, `masquerMontants`, `lignesParPage` et `langue`.
   - `ResourcePage` ne lit que `lignesParPage`. Les montants du tableau de bord restent affichés et le thème sombre n’est pas appliqué par un état global repéré.
   - À développer côté frontend : un provider de préférences initialisé depuis `GET /api/parametres/preferences`, appliquant le thème et le masquage aux écrans concernés, et un mécanisme de rafraîchissement après sauvegarde. Côté backend, `getDisplayPreferences` et `updateDisplayPreferences` existent déjà ; aucun nouveau service métier n’est nécessaire sauf ajout de nouvelles préférences.

2. **Valeur diocésaine vide envoyée comme zéro**
   - Dans `ModuleTools.tsx`, la soumission des paramètres convertit `general.dioceseTaux` avec `Number(...)`, sauf quand sa valeur est la chaîne vide. Or une valeur API `null` s’affiche comme champ vide mais reste `null` en mémoire ; `Number(null)` donne `0`.
   - Résultat : sauvegarder les paramètres sans saisir de taux peut définir un taux à `0` au lieu de le laisser non configuré. Le backend valide `0` comme un taux valide, donc il ne peut pas deviner que l’utilisateur voulait conserver `null`.
   - Correction principale côté frontend : convertir uniquement une chaîne non vide en nombre, et transmettre explicitement `null` lorsqu’aucun taux n’est renseigné. Le backend pourrait aussi rendre la validation/confirmation métier plus explicite, mais ne doit pas réinterpréter arbitrairement `0`.

3. **Sessions avec frontend et API sur deux projets Vercel**
   - Le client utilise `withCredentials`, le CORS expose l’origine autorisée et le backend met un cookie `HttpOnly`, mais `cookieOptions()` fixe `SameSite=Lax`.
   - Si le navigateur considère les deux domaines Vercel comme des sites distincts, le cookie peut ne pas être envoyé aux appels API ; l’utilisateur paraît connecté puis reçoit des `401` sur les pages métier. Un `localhost` ne reproduit pas ce cas.
   - À développer/vérifier côté backend et déploiement : définir une configuration de cookie compatible avec l’architecture réelle, souvent `SameSite=None; Secure` pour un contexte intersite, et tester login, `/auth/me`, rechargement et logout sur les vrais domaines. `SameSite=None` doit toujours être combiné à `Secure`, et CORS doit garder une origine explicite avec credentials.

4. **Pièces jointes stockées sur disque local**
   - `attachments.js` utilise le répertoire configuré `backend/uploads`; `sendFile` et Multer sont câblés autour de ce stockage.
   - Sur les fonctions serverless Vercel, le disque d’une instance n’est pas un stockage persistant partagé. Un fichier peut sembler téléversé puis devenir introuvable depuis une autre invocation.
   - À développer : abstraction de stockage `putObject/getObject/deleteObject` et adaptateur objet persistant, avec stockage de sa clé dans `attachments.storage_key`. L’API de téléversement/téléchargement existante peut être conservée, mais les méthodes `uploadAttachment`, `downloadAttachment`, `deleteAttachment` doivent déléguer à l’adaptateur au lieu du disque local.

### Priorité fonctionnelle moyenne

5. **Écran Recherche trop générique**
   - La page est montée comme un `ResourcePage`; elle fournit un champ `q` et envoie `page/limit`, ce qui utilise bien `globalSearch`.
   - Le backend renvoie les catégories disponibles mais l’écran ne propose pas de sélection de catégories ni de filtres dédiés. Les résultats et leur navigation restent génériques.
   - À développer côté frontend : écran dédié avec catégories, filtres éventuels et rendu par type. Le backend a déjà les fonctions `search*`; ajouter une méthode de service seulement si un nouveau critère métier (ex. période/statut/compte) est défini et validé.

6. **Affichage générique de modules non tabulaires**
   - `ResourcePage` transforme un objet unique en pseudo-ligne et les structures imbriquées en texte peu lisible. C’est le cas notamment des paramètres (`generaux`, `preferences`, `securiteSession`) et potentiellement de l’aide.
   - À développer côté frontend : vues dédiées pour paramètres et aide, ou filtrage de la liste générique pour ne pas afficher les mêmes données deux fois. Les endpoints backend correspondants sont déjà présents.

7. **Détails d’opération exposés en JSON brut**
   - Le frontend charge les détails d’opération et justificatifs, puis les rend dans un bloc JSON générique.
   - À développer côté frontend : fiche structurée, montants/dates localisés, liens justificatifs et erreurs de chargement. Côté backend, les services de détail et d’association sont présents ; compléter seulement si la fiche métier révèle un champ ou une règle manquante.

8. **Options de saisie et validation à harmoniser**
   - Le formulaire React marque les champs HTML requis, mais le backend reste la seule validation fiable. Les erreurs Zod arrivent en `ApiError.fields`; plusieurs composants affichent seulement `message`.
   - À développer côté frontend : afficher les erreurs par champ à partir de `fields`, conserver les saisies après erreur et confirmer les annulations/suppressions. Les schémas serveur d’opération, membre, compte et rubrique existent déjà.

## 9. Travaux backend à faire pour les fonctionnalités actuellement affichées

### Nécessaire avant un usage fiable sur les domaines actuels

1. **Rendre la session inter-domaines configurable** : paramètres de cookie selon l’environnement, validation des domaines CORS exacts et tests d’intégration navigateur pour les déploiements séparés.
2. **Rendre le stockage des justificatifs persistant** : adaptateur d’objet externe pour écriture, lecture et suppression ; contrôle d’accès conservé avant téléchargement.
3. **Séparer le serveur d’exécution serverless du processus de maintenance** : `server.js` lance connexion DB et migrations avant `app.listen`, et démarre un timer de purge. Pour Vercel, exporter l’application HTTP depuis une entrée compatible, exécuter migrations une fois via une commande de déploiement contrôlée, et déplacer la purge des sessions vers une tâche planifiée. Éviter que chaque démarrage d’instance exécute des migrations concurrentes.
4. **Activer TLS MySQL Aiven dans le pool** : `database.js` ne transmet actuellement pas `ssl` au pilote. Ajouter lecture/validation de certificat CA et tests de connexion avec rejet des certificats non valides. Les variables `DB_SSL`/`DB_SSL_CA` du modèle de déploiement ne sont pas consommées tant que ce changement n’est pas fait.
5. **Rendre les erreurs de transport multipart prévisibles** : vérifier que le middleware renvoie l’enveloppe JSON normalisée pour type MIME refusé, absence de fichier et dépassement de taille ; préserver l’identifiant de requête afin que le client affiche un message précis.

### À développer uniquement si le besoin produit est confirmé

- **Administration des utilisateurs** : routes/service liste, détail, création, mise à jour, activation, attribution de rôles et réinitialisation de mot de passe. Avant cela, définir les rôles et le contrôle d’accès par action ; actuellement, le backend traite les utilisateurs comme des comptes actifs/inactifs sans matrice de permissions.
- **Correction contrôlée d’un mouvement/solde** : méthode dédiée, motif obligatoire, pièce justificative, mouvement de type ajustement, audit et permission explicite. Le schéma SQL prévoit `source_type='ajustement'`, mais aucun parcours frontend/service métier d’ajustement n’a été repéré. Ne pas introduire un endpoint qui mettrait directement à jour le solde initial d’un compte déjà utilisé.
- **Modification d’une contribution diocésaine** : décider si une écriture déjà validée est corrigée par contre-écriture et remplacement ou par modification tracée ; ensuite ajouter schéma de patch, service transactionnel et route dédiée. Le frontend actuel sait créer/annuler, pas modifier.
- **Recherche avec filtres métier additionnels** : le service global existe déjà ; implémenter de nouveaux filtres serveur (et tests de validation) après décision sur les critères attendus, plutôt que d’envoyer des filtres non documentés.

## 10. Priorisation recommandée pour le fonctionnement normal

| Rang | Travail | Responsable principal | Pourquoi |
| --- | --- | --- | --- |
| 1 | Vérifier les contrats de réponse et corriger le taux `null` → `0` | Frontend | Évite une configuration financière incorrecte ; le backend ne peut pas distinguer une intention explicite de zéro d’une conversion accidentelle. |
| 2 | Tester et configurer le cookie de session sur les domaines Vercel réels | Backend + déploiement | Sans cookie navigateur, tous les appels métier protégés échouent même si l’API est joignable. |
| 3 | Ajouter TLS Aiven au pool MySQL | Backend | Nécessaire pour une connexion chiffrée fiable à la base hébergée. |
| 4 | Sortir fichiers et tâches de fond du disque/processus éphémère | Backend + infrastructure | Évite perte de fichiers et purge de sessions aléatoire sur les fonctions. |
| 5 | Déployer via un export Express compatible et lancer migrations séparément | Backend + infrastructure | Évite les démarrages incomplets ou migrations simultanées lors du scaling. |
| 6 | Appliquer les préférences et améliorer recherche/détails | Frontend | Les API nécessaires sont pour l’essentiel déjà disponibles ; améliore la cohérence visible. |
| 7 | Définir et construire gestion des rôles ou ajustements | Produit + backend + frontend | Ces fonctions ne peuvent pas être correctement inventées sans décisions métier. |

## 11. Synthèse de l’audit

Le socle de persistance métier est déjà substantiel : les formulaires de membres, opérations financières, comptes, rubriques, justificatifs, contribution diocésaine, import et paramètres appellent des routes Express qui valident et délèguent à des services, lesquels lisent/écrivent dans MySQL. Le travail prioritaire n’est donc pas de réécrire toutes ces méthodes, mais de fiabiliser les frontières de déploiement/session/stockage, corriger les écarts d’interface identifiés, puis ajouter des méthodes backend seulement pour les fonctions absentes (rôles utilisateurs, ajustement contrôlé, éventuelle modification diocésaine).

Cet audit est basé sur la lecture statique des sources présentes. Il ne confirme pas le comportement de tous les scénarios en base réelle et ne remplace pas des tests d’intégration sur navigateur, base de test et domaines de production.
