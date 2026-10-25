# Guide d’implémentation et de test — frontend et backend

**Plateforme :** Miséricorde Divine  
**Version de référence :** 25 octobre 2026  
**Portée :** interface React, client API, API Express, règles métier, MySQL, intégrations et notifications e-mail.

Ce guide sert de plan de travail et de recette. Les cases « existant » signifient que le code ou des tests correspondants ont été trouvés dans le dépôt ; elles ne signifient pas que la recette a été rejouée dans l’environnement courant. Toute modification doit conserver les règles métier déjà présentes et respecter les décisions métier validées.

## 1. Résumé de l’état actuel

Le backend comprend déjà des routes Express, des services de domaine, des schémas Zod, une migration initiale MySQL et deux suites de tests Node.js. Les domaines membres, opérations financières, comptes, rubriques, contribution diocésaine, justificatifs, recherche, rapports, échanges, anomalies, paramètres et authentification ont une implémentation substantielle.

Les principaux travaux préalables à un usage fiable en ligne sont :

- [x] Configurer TLS vérifié vers MySQL Aiven dans le pool `mysql2` (`DB_SSL`, CA et `rejectUnauthorized: true`) ; la connexion réelle avec le CA Aiven reste à vérifier au déploiement.
- [x] Séparer l’entrée serverless `src/index.js`, le serveur local, les migrations explicites et le nettoyage des sessions ; aucun job périodique ne tourne au chargement de la fonction.
- [x] Ajouter un adaptateur privé Vercel Blob pour les justificatifs ; le compte de stockage et son token restent à configurer en ligne.
- [x] Rendre `Secure` et `SameSite` configurables, avec `SameSite=None` refusé sans Secure ; test navigateur avec les domaines de production encore à faire.
- [x] Implémenter l’adaptateur Resend, désactivé par défaut, et le premier événement de sécurité : avis envoyé à l’adresse du compte après changement du mot de passe.
- [x] Ajouter une outbox transactionnelle pour que les envois e-mail ne perdent pas un événement et ne bloquent pas une écriture métier.

## 2. Règles de travail et définition de terminé

### Flux à respecter pour toute donnée métier

```text
Requête HTTP authentifiée
  → validation Zod (corps, paramètres, filtres)
  → service métier
  → transaction SQL si plusieurs écritures liées
  → audit et événement/outbox éventuel dans la transaction
  → réponse API normalisée
```

Le frontend ne doit jamais pouvoir établir le solde ou la validité d’une opération par lui-même. Les montants, références, statuts, contrôles de compte/rubrique, règles d’annulation, droits et idempotence sont décidés et revalidés par le backend.

### Définition de terminé pour une fonctionnalité

- [ ] Contrat documenté : route, rôle/session requise, champs, filtres, réponse, erreurs.
- [ ] Schéma Zod rejette les entrées invalides et ne laisse pas passer de champs non autorisés.
- [ ] Règle métier isolée dans un service, indépendante du transport HTTP.
- [ ] SQL paramétré ; transaction/rollback si la fonctionnalité modifie plusieurs tables.
- [ ] Audit pour les changements financiers, de sécurité ou d’administration.
- [ ] Idempotence pour les actions financières ou importables où une répétition peut doubler l’effet.
- [ ] Tests unitaires de règles et tests HTTP/MySQL du contrat.
- [ ] Test d’échec qui prouve qu’aucune écriture partielle ne reste.
- [ ] Test d’autorisation, validation, erreurs normalisées et cas limites.
- [ ] Logs utiles sans mot de passe, jeton, contenu de justificatif ou secret.
- [ ] Migrations réversibles/documentées selon la politique du projet et stratégie de sauvegarde connue.
- [ ] Vérification de bout en bout avec le frontend et réponse comprise par son client Axios.
- [ ] Parcours frontend réalisé dans le même sprint vertical : état initial, chargement, succès, validation, erreurs API, droits et actualisation après écriture.
- [ ] Types frontend correspondant aux DTO réellement renvoyés ; aucun calcul de solde, contournement de droit ou règle métier dupliqué dans le navigateur.
- [ ] Tests frontend ciblés et recette navigateur sur le même contrat que les tests backend.

## 3. Préparer l’environnement de test

### Tests automatisés déjà présents

Le backend utilise `node:test` (`backend/package.json`, script `npm test`). Les tests API et finance appellent de vrais services Express et MySQL. `backend/tests/env.js` force `NODE_ENV=test`, `DB_NAME=misericorde_divine_test` et un répertoire de téléversements de test. Avant chaque suite d’intégration, `backend/tests/helpers.js` vide seulement les tables du schéma dédié, applique les migrations et initialise les données de référence ; il ne supprime plus le schéma lui-même. Le module `backend/tests/safety.js` bloque les noms de base différents et les hôtes distants non confirmés.

Avant de les lancer :

- [x] Démarrer un MySQL local de test et fournir `DB_HOST`, `DB_PORT`, `DB_ROOT_USER`, `DB_ROOT_PASSWORD` dans l’environnement backend.
- [x] Réserver `misericorde_divine_test` uniquement aux tests automatisés ; le helper supprime toutes les tables de ce schéma avant de les recréer.
- [x] Lancer depuis `backend` avec `npm test`.
- [ ] Ne jamais utiliser la base de production ou la base Aiven de l’application comme cible de test.
- [ ] Contrôler le code de sortie et les logs ; une suite non exécutée faute de MySQL n’est pas une suite réussie.

Le seed fournit rubriques de référence, caisse principale et administrateur de test sans créer d’opération financière fictive. L’authentification de test utilise `MotDePasseTest123`.

Par défaut, la suite autorise uniquement `localhost`, `127.0.0.1` ou `::1`. Pour une base distante **jetable de test seulement**, fournir les trois confirmations exactes : `TEST_ALLOW_REMOTE_DATABASE=I_UNDERSTAND_THIS_IS_A_DISPOSABLE_TEST_DATABASE`, `TEST_DB_HOST_CONFIRMATION=<hôte exact>` et `TEST_DB_NAME_CONFIRMATION=misericorde_divine_test`. Ces variables ne rendent pas une base de production sûre : l’opérateur doit s’assurer que l’hôte désigne bien un service de test séparé. Le compte MySQL de test doit être limité au schéma de test autant que le fournisseur le permet.

### Tests manuels d’API

- [ ] Utiliser une base jetable, migrée avec `npm run migrate`, puis `npm run seed` avec un mot de passe de test.
- [ ] Obtenir un cookie de session via `POST /api/auth/login`.
- [ ] Vérifier `GET /api/sante`, puis une route protégée sans cookie (attendu : `401`).
- [ ] Tester une validation invalide et vérifier `422`, `error.code`, `error.fields` et `requestId`.
- [ ] Vérifier que les réponses de succès gardent le format `{ success: true, data, meta? }`.
- [ ] Vérifier qu’une mutation n’est possible que depuis l’origine autorisée et avec la session attendue.

## 4. Checklist par fonctionnalité de la plateforme

### 4.1 Infrastructure API, erreurs et configuration

**Présent :** `app.js`, `server.js`, middlewares request ID, erreurs, sécurité, validation, configuration et logger.

- [ ] Vérifier la route de santé sans fuite de nom d’utilisateur, mot de passe ou chaîne de connexion.
- [ ] Vérifier les réponses `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422`, `429` et `500` sous le même format API.
- [ ] Vérifier que les erreurs Zod et Multer sont transformées en erreurs exploitables par `httpClient.ts`.
- [ ] Vérifier CORS avec l’origine frontend autorisée, une origine non autorisée, OPTIONS et cookies credentialed.
- [ ] Vérifier le contrôle d’origine des écritures contre CSRF et les requêtes sans en-tête Origin.
- [ ] Vérifier les limites JSON et multipart, les en-têtes Helmet, le rate limit login et la journalisation.
- [ ] Ajouter une validation de configuration au démarrage (variables obligatoires en production, URLs, limites) qui échoue clairement sans exposer les secrets.
- [ ] Définir une stratégie de versionnement API et de compatibilité des enveloppes avant d’ajouter des changements cassants.

**Cas de test minimaux :** route inconnue ; JSON invalide ; corps trop volumineux ; CORS OPTIONS ; origin étrangère sur POST ; erreur SQL simulée ; erreur sans stack en production ; request ID de réponse présent et corrélé aux erreurs.

### 4.2 Authentification, session et comptes

**Présent :** login/logout/me/changement et reset du mot de passe, hachage bcrypt, sessions serveur, blocage des comptes inactifs, rôles `admin`/`gestionnaire`, gestion admin des utilisateurs, ajustements admin et nettoyage des sessions expirées. La recette réelle des domaines Vercel reste à faire.

- [x] Tester login avec bon et mauvais mot de passe sans révéler si l’e-mail existe.
- [x] Vérifier cookie HttpOnly, durée, configuration Secure/SameSite, path et suppression au logout ; les domaines réels restent à recetter en déploiement.
- [x] Tester session expirée, révoquée, invalide, compte désactivé et changement de mot de passe.
- [x] Vérifier que le changement de mot de passe révoque les autres sessions et n’écrit jamais le mot de passe dans l’audit/log.
- [ ] Vérifier rate limiting par client en production derrière le proxy et la bonne détermination de l’IP réelle.
- [x] Décision produit : l’application gère les rôles `admin` et `gestionnaire`; les endpoints de gestion utilisateurs sont réservés à `admin`.
- [x] Développer `listUsers`, `getUserById`, `createUser`, `updateUser`, `setUserActive`, reset sécurisé avec token à durée limitée et audit.
- [x] Tester l’accès admin/non-admin, la protection du dernier admin, la révocation de session après désactivation et l’absence d’énumération au reset.

**Tests existants repérés :** routes protégées, santé, mauvais identifiants, cookie, hash du mot de passe, logout, expiration, compte désactivé, changement de mot de passe et origine CSRF.

### 4.3 Membres

**Présent :** liste/recherche/tri/pagination, création, détail, modification partielle, changement de statut, archivage, historique des opérations et synthèse financière.

- [ ] Valider champs requis nom/prénom, sexe, date, e-mail, téléphone et longueurs.
- [x] Tester unicité e-mail/téléphone, normalisation e-mail et erreurs de doublon.
- [x] Vérifier génération de référence côté serveur et non-réutilisation concurrente.
- [x] Vérifier que l’archivage n’efface pas les opérations et que les archives sont masquées ou incluses selon le filtre.
- [ ] Vérifier la recherche accentuée et les caractères littéraux `%`/`_` (filtrage, tri autorisé et pagination sont couverts).
- [x] Vérifier qu’un membre archivé est refusé pour une nouvelle cotisation ; le statut inactif reste un état distinct.
- [x] Tester synthèse financière vide et opérations/synthèse/cotisations avec opérations annulées.

**Tests existants repérés :** CRUD, validations, doublons, recherche/tri/pagination, archivage et synthèse/opérations.

### 4.4 Opérations financières : cotisations, recettes, dons et dépenses

**Présent :** service commun `operations.js`, schémas par type, filtres, création, édition, annulation motivée, génération référence, écritures de mouvements et audit.

- [x] Tester les champs spécifiques couverts par les schémas : membre requis pour cotisation, membre facultatif pour recette/don, tiers et période selon le type.
- [x] Tester montant zéro, négatif, excessif, précision monétaire, virgule décimale et valeurs mal formées.
- [ ] Compléter les cas compte/rubrique/membre inactif et champs inconnus (dates impossibles et références inexistantes sont couvertes).
- [x] Vérifier les sens : recette/cotisation/don augmentent le compte ; dépense le diminue.
- [x] Vérifier modification du montant/compte : mouvements synchronisés et soldes cohérents en transaction.
- [x] Vérifier annulation motivée, contre-écriture unique, historique, refus d’une seconde annulation et modification après annulation.
- [x] Tester découvert interdit/autorisé, rollback sans ligne partielle et concurrence sur le solde.
- [x] Tester répétition, concurrence, clé réutilisée sur autre route/payload et création indépendante sans clé.
- [x] Le frontend transmet une clé par intention POST et la réutilise après erreur réseau/serveur pour le même endpoint et payload.
- [x] Vérifier la cohérence des mouvements, soldes, dashboard, rapports, recherche et exports.

**Tests existants repérés :** suite finance couvre opérations, précision, soldes insuffisants, rollback, comptes/rubriques désactivés, concurrence, idempotence, filtres, tri, historique et audit.

### 4.5 Comptes, mouvements et trésorerie

**Présent :** création, liste/filtre, détail, édition des attributs autorisés, activation, solde à date, mouvements et synthèse caisse/banque/consolidée.

- [x] Valider code, unicité, type, solde initial, nom et autorisation de découvert ; les métadonnées bancaires sont validées par schéma.
- [x] Vérifier que l’édition d’un compte n’écrase ni le solde initial ni les mouvements existants.
- [x] Vérifier calcul du solde à une date avec mouvements postérieurs exclus et filtres inclusifs.
- [x] Vérifier invariant : solde = solde initial + somme des entrées − somme des sorties, contre-écritures incluses.
- [x] Vérifier qu’un compte inactif est refusé pour toute nouvelle opération, mais reste consultable dans l’historique.
- [x] Ajustement manuel implémenté via `accountAdjustmentSchema`, `createAccountAdjustment` et `POST /api/comptes/:id/ajustements` : admin seulement, motif, référence justificative facultative, mouvement immuable, transaction et audit ; aucun client ne modifie directement un solde.

### 4.6 Rubriques financières

**Présent :** CRUD logique sans suppression physique, activation/désactivation, recherche et protection des références historiques ; quatre familles (cotisations, recettes, dons, dépenses), nature spécifique au don.

- [x] Tester code généré (normalisation accentuée), code fourni, unicité et doublons.
- [x] Tester champs spécifiques à la rubrique de don et valeur de nature.
- [x] Vérifier qu’une rubrique utilisée ne peut pas changer de code.
- [x] Vérifier qu’une rubrique inactive reste lisible dans les anciennes opérations mais est refusée pour les nouvelles.
- [x] Vérifier compteur d’utilisations et détails.

### 4.7 Tableau de bord et calculs d’agrégats

**Présent :** membres actifs, totaux des opérations valides, soldes caisse/banque, évolution, répartition et dernières opérations.

- [ ] Tester période vide, début seul, fin seule, bornes incluses et période inversée/invalide.
- [ ] Comparer les agrégats à des requêtes SQL indépendantes de test.
- [ ] Vérifier exclusion des opérations annulées des totaux métier et inclusion correcte de leurs contre-écritures dans les soldes.
- [ ] Vérifier la forme exacte du DTO utilisée par `DashboardSummary` et les valeurs décimales reçues par le frontend.
- [ ] Tester absence de donnée et plusieurs milliers d’écritures afin de garder des requêtes agrégées et indexables.

### 4.8 Contribution diocésaine

**Présent :** lecture/écriture manuelle, calcul, synthèse, génération, détail, opérations liées, correction par contre-écriture et annulation. Le taux et l’assiette sont configurables ; la logique refuse le calcul si ces règles ne sont pas renseignées.

- [ ] Faire valider officiellement le taux, l’assiette, les catégories incluses, l’arrondi et le traitement des annulations.
- [x] Tester calcul sans configuration, avec taux nul explicite, assiettes configurées, périodes inclusives et montants décimaux aux seuils d’arrondi.
- [x] Tester génération : compte actif requis, période, montant calculé, référence, mouvement sortant cohérent et annulation avec contre-écriture.
- [x] Tester deux générations simultanées sur la même période exacte : un seul versement est créé.
- [x] Tester contribution manuelle avec période invalide, montant invalide et compte inactif.
- [ ] Définir et tester la règle métier pour les périodes qui se chevauchent sans être identiques ; le verrou actuel sérialise les périodes exactement identiques.
- [x] Correction d’une contribution valide : `diocesanUpdateSchema`, `updateDiocesanContribution`, `PUT /api/contribution-diocesaine/:id`; les mouvements existants ne sont pas supprimés, la correction ajoute une contre-écriture puis le mouvement corrigé dans la même transaction. La période et les données historiques du calcul sont immuables.
- [x] Tester changement de compte/montant, invariant des soldes, conservation des 3 mouvements, refus de découvert avec rollback et refus de modification de la période.

### 4.9 Justificatifs

**Présent :** upload multipart, type MIME + signature, taille, nom de stockage imprévisible, hash SHA-256, liaison, liste, détail, téléchargement sécurisé, suppression.

- [x] Tester MIME interdit, signature invalide et dépassement de taille ; le nom original est nettoyé et la clé de stockage est imprévisible.
- [x] Tester liaison à chacun des cinq types d’opération et référence inexistante sans fichier ou métadonnée orpheline.
- [x] Vérifier `Content-Disposition`, `nosniff`, type MIME et journalisation du téléchargement.
- [x] Tester suppression des métadonnées et objet ; les adaptateurs sont injectables et testés sans réseau, y compris l’accès privé Vercel Blob.
- [x] Ajouter le stockage objet privé Vercel Blob avec fournisseur enregistré par justificatif ; le disque local demeure utilisé en développement/tests.
- [ ] Tester sur Vercel Preview/Production la configuration réelle du store privé, le token, la persistance entre invocations, ainsi que les pannes et la reprise/nettoyage d’orphelins.
- [ ] Ajouter tests d’autorisation si des opérations ou documents ont des droits de visibilité différents selon les rôles.

### 4.10 Recherche

**Présent :** fonctions de recherche pour membres, cotisations, recettes, dons, dépenses, justificatifs ; route commune avec catégories et pagination.

- [ ] Tester chaque catégorie seule, toutes catégories, catégorie inconnue, terme vide/long, pagination et absence de résultats.
- [ ] Vérifier que chaque résultat annonce un type stable et un identifiant navigable par le frontend.
- [ ] Tester caractères d’injection SQL et caractères génériques.
- [ ] Ajouter filtres serveur seulement après définition des champs acceptés et schéma de query Zod ; ne pas interpoler des colonnes client.
- [ ] Ajouter côté frontend un choix de catégories : le backend renvoie déjà `categoriesDisponibles`.

### 4.11 Rapports et exports

**Présent :** liste des types, synthèse JSON et export CSV/XLSX/PDF pour rapports déclarés.

- [x] Tester les types de rapport disponibles et les filtres déjà couverts par les écrans.
- [x] Vérifier les totaux de rapport par comparaison aux listes et à l’invariant de trésorerie.
- [x] Tester les formats inconnus et neutraliser l’injection de formules CSV ; le classeur XLSX conserve les chaînes de formule comme texte.
- [x] Tester les en-têtes de téléchargement et les contenus CSV, XLSX et PDF ouvrables pour les rapports disponibles.
- [ ] Vérifier que les exports ne contiennent que les données de l’utilisateur autorisé et n’exposent pas de colonnes techniques.

### 4.12 Import/export Excel et CSV

**Présent :** liste des ressources, modèle, export, import, simulation, mode partiel/tout-ou-rien, rapprochement et rapport de résultat.

- [ ] Tester fichier vide, format non accepté, taille maximale, colonnes manquantes/inconnues, lignes invalides et doublons internes.
- [x] Vérifier simulation sans aucune écriture, y compris pour une ligne de dépense modifiée.
- [x] Vérifier tout-ou-rien : une dépense invalide annule l’import sans mutation partielle.
- [ ] Vérifier import partiel : seules les lignes valides sont persistées et chaque ligne invalide est rapportée.
- [ ] Vérifier rapprochement par identifiant métier (référence/code), droits de modification, cohérence des écritures financières et non-réactivation des opérations annulées.
- [ ] Protéger contre formules de feuille de calcul injectées lors d’un export et contre fichiers malformés/volumineux.
- [ ] Ajouter une clé d’idempotence au lancement final ou un identifiant d’import pour éviter qu’un retry rejoue deux fois les créations.

### 4.13 Anomalies et contrôles métier

**Présent :** règles documentées, analyse, empreinte unique, création/réouverture/résolution automatique, changement de statut, résolution manuelle et historique.

- [ ] Faire approuver chaque règle et son niveau de gravité par le métier ; ne pas inventer d’anomalies financières.
- [ ] Tester une fixture saine (zéro faux positif) et une fixture par règle (détection attendue).
- [x] Vérifier répétition d’analyse sans doublons et résolution automatique quand l’incohérence est corrigée.
- [x] Tester transitions de statut, commentaires, résolution manuelle et historique/audit.
- [ ] Ajouter une fixture pour chaque règle d’anomalie et vérifier la réouverture d’une anomalie résolue qui réapparaît.
- [ ] Vérifier coût et durée sur un volume de production représentatif ; prévoir analyse asynchrone si nécessaire.

### 4.14 Paramètres, préférences et aide

**Présent :** paramètres généraux, taux/assiette diocésains, préférences par utilisateur, exposition en lecture des paramètres de session, changement de mot de passe et aide statique.

- [ ] Tester valeurs par défaut, mise à jour partielle, null explicite et persistance après nouvelle session.
- [ ] Tester bornes du taux, devise, assiettes et champs inconnus.
- [x] Le frontend conserve un taux vide (`null`) au lieu de le convertir silencieusement en `0` ; un taux `0` explicite reste pris en charge.
- [ ] Appliquer réellement au frontend `theme`, `masquerMontants` et `lignesParPage`; le backend de préférences existe déjà.
- [ ] Vérifier que seuls les paramètres non secrets de session sont exposés.
- [ ] Tester slug d’aide inconnu et contenu documentaire encodé correctement.

### 4.15 Audit, idempotence et opérations de maintenance

**Présent :** journal d’audit, middleware idempotent optionnel sur les mutations financières, table de clés, migration et seed. Le middleware d’idempotence attend une réponse réussie avant de la mémoriser et rejoue la réponse pour la même clé/utilisateur/route.

- [x] Vérifier sur les opérations et changements de mot de passe l’acteur, l’action, l’entité et l’absence de secrets ; le nettoyage récursif masque aussi les clés sensibles imbriquées.
- [x] Tester qu’aucun mot de passe ou hash n’est consigné ; l’audit n’enregistre pas les jetons, secrets, cookies, blobs ou octets de fichiers.
- [ ] Vérifier les droits d’accès et la durée de rétention des audits ; aucun endpoint de consultation d’audit n’est présent dans les écrans actuels.
- [ ] Tester la clé d’idempotence sur autre route, autre utilisateur, replay, expiration/rétention et appels simultanés.
- [ ] Déplacer la purge des sessions expirées hors du timer d’un serveur serverless et la lancer via cron/worker contrôlé.
- [ ] Rendre l’application Express importable par une fonction HTTP Vercel sans effets de bord d’écoute de port et de migration au chargement.

## 5. Notifications par e-mail

### 5.1 Décisions à valider avant d’envoyer des e-mails

Les destinataires ne doivent pas être déduits uniquement du fait qu’un formulaire contient une adresse e-mail. Décider et documenter :

- [x] Fournisseur d’envoi implémenté : API Resend ; `EMAIL_PROVIDER=disabled` empêche tout envoi avant activation explicite.
- [ ] Domaine d’envoi et vérification DNS (SPF, DKIM, DMARC) chez le fournisseur.
- [ ] Adresse d’expédition et adresse Reply-To.
- [x] Premier événement : changement du mot de passe ; destinataire : adresse du propriétaire du compte. Les autres événements restent à approuver.
- [ ] Langue, fuseau horaire et format des montants/dates.
- [ ] Politique de consentement/préférences et possibilité de désactivation, si applicable.
- [ ] Politique de conservation des e-mails, erreurs et données personnelles.

### 5.2 Événements candidats à faire approuver

| Événement candidat | Destinataire possible | Garde-fou |
| --- | --- | --- |
| Création d’un compte utilisateur / invitation | Utilisateur invité | Lien à usage unique, expiration courte ; jamais envoyer un mot de passe en clair. |
| Réinitialisation de mot de passe | Propriétaire du compte | Réponse HTTP neutre contre l’énumération d’e-mails ; token haché en base. |
| Changement du mot de passe | Propriétaire du compte | Avis de sécurité sans inclure le nouveau mot de passe. |
| Écriture financière créée ou annulée | Opérateur et/ou destinataire métier configuré | N’envoyer aucun détail financier à une adresse non vérifiée ou non autorisée ; définir le contenu et l’accord métier. |
| Import terminé avec erreurs | Initiateur de l’import | Envoyer le résumé et un lien sécurisé, pas les lignes sensibles en pièce jointe. |
| Anomalie critique détectée | Groupe d’administration configuré | Déduplication, seuil de fréquence et lien vers la plateforme ; ne pas inclure plus de données qu’il n’en faut. |
| Pièce justificative reçue | Responsable désigné | Pas de pièce jointe dans le courriel ; lien authentifié/expirant si nécessaire. |

Ne pas activer tous ces e-mails par défaut. Choisir une première tranche réduite, par exemple changement/réinitialisation de mot de passe et rapport d’import, puis mesurer les échecs et le volume avant d’ajouter des événements financiers.

### 5.3 Architecture recommandée : outbox transactionnelle

Ne pas appeler directement le fournisseur e-mail depuis une transaction financière, et ne pas faire un `sendMail()` non attendu en arrière-plan de la requête. Ces approches peuvent ralentir la réponse, perdre l’e-mail lors d’un redémarrage, ou envoyer une notification alors que l’écriture métier a été annulée.

```text
Service métier
  → transaction MySQL : écritures métier + audit + notification_outbox
  → commit
Worker/cron isolé
  → prend un événement disponible (verrou/lease)
  → prépare le modèle et envoie via EmailProvider
  → marque envoyé ou programme une nouvelle tentative
```

À ajouter côté backend :

- [x] Interface injectable `EmailProvider.send({to, from, subject, html, text, idempotencyKey})` et adaptateur HTTP Resend ; les tests injectent un faux provider.
- [x] Table `notification_outbox` avec charge utile minimale, clé de déduplication unique, statut, compteur d’essais, disponibilité, lease, résultat et code d’erreur expurgé.
- [ ] Table de préférences/abonnements si les événements sont désactivables par utilisateur : `user_id`, `event_type`, `enabled`, `updated_at` ; préciser les événements obligatoires de sécurité non désactivables si c’est la politique retenue.
- [x] Migration versionnée et index sur statut/date disponible, lease et clé de déduplication.
- [x] `enqueueNotification(conn, event)` écrit dans la transaction métier, valide une liste fermée d’événements et déduplique les retries.
- [x] `claimPendingNotifications(limit)` utilise `FOR UPDATE SKIP LOCKED` et un lease expirant ; les tests couvrent deux workers concurrents.
- [x] `deliverNotification(item)` rend le modèle, envoie via provider injecté puis marque `sent` ; les erreurs sont codées sans corps fournisseur.
- [x] Retry borné avec backoff exponentiel et statut final `dead` ; la reprise est réservée au worker/cron, sans route d’envoi arbitraire.
- [ ] Déduplication par clé d’événement stable (par exemple type + entité + version/transition) pour éviter les doublons lors d’un retry.
- [x] Worker isolé du serveur HTTP : script local et endpoint cron Vercel protégé par `CRON_SECRET`, avec lot borné et aucun timer permanent.
- [ ] Ne pas conserver le corps complet de l’e-mail ou des secrets dans l’outbox. Garder un payload minimal, chiffrer/limiter les données si nécessaire, fixer une rétention et expurger les erreurs du fournisseur.

L’outbox permet une livraison **au moins une fois** ; le fournisseur ou l’adaptateur doit accepter une clé d’idempotence si disponible. Il faut donc aussi rendre l’envoi dédupliqué. Ne pas promettre une livraison exactement une fois, qui n’est généralement pas garantie entre MySQL et un service externe.

### 5.4 Modules e-mail et configuration

Le backend utilise l’API REST Resend par `fetch` natif ; aucune dépendance supplémentaire d’envoi n’est requise. Le domaine, les secrets et l’expéditeur doivent être configurés avant activation :

- [x] Utiliser l’API REST officielle Resend via `fetch` natif Node, sans dépendance d’envoi supplémentaire.
- [x] Ajouter `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_API_KEY`, `EMAIL_BATCH_LIMIT` et `CRON_SECRET` à la configuration serveur et aux modèles d’environnement.
- [ ] Garder les secrets seulement dans le gestionnaire de secrets de l’hébergeur ; ne jamais ajouter les valeurs réelles aux fichiers `.env*` versionnés.
- [x] Refuser une configuration Resend incomplète ; l’envoi reste désactivé par défaut jusqu’à activation explicite.
- [ ] Séparer configuration Production/Preview/Test afin qu’un test ou preview ne contacte pas de vrais utilisateurs.
- [x] Ajouter le modèle texte/HTML d’avis de changement de mot de passe, avec échappement HTML des données utilisateur.
- [ ] Ajouter nom/identité visuelle, sujet, lien vers la plateforme et coordonnées de contact, sans publier d’URL d’accès public à des données privées.

### 5.5 Méthodes/services/routes à ajouter pour l’e-mail

Proposition de couche de service (les noms peuvent être ajustés au style du dépôt) :

```text
backend/src/services/notifications.js
  notificationEventSchema
  enqueueNotification(executor, event)
  getNotificationPreferences(userId)
  updateNotificationPreferences(userId, patch, ctx)
  claimPendingNotifications(limit, workerId)
  deliverNotification(notificationId, provider)
  retryFailedNotifications(limit)
  getNotificationStatus(id)                 // administration uniquement, si utile

backend/src/services/email/provider.js
  createEmailProvider(env)
  sendEmail(message)

backend/src/services/email/templates/*.js
  renderInviteEmail(data)
  renderPasswordResetEmail(data)
  renderSecurityNoticeEmail(data)
  renderImportSummaryEmail(data)
```

- [x] Ajouter `GET/PUT /api/notifications/preferences` pour mémoriser le choix utilisateur relatif aux futurs e-mails optionnels ; `PASSWORD_CHANGED` et `PASSWORD_RESET` restent obligatoires.
- [ ] Ne pas exposer une route publique d’envoi libre d’e-mail.
- [ ] Les invitations et réinitialisations doivent avoir des endpoints à débit limité, réponses neutres et tokens limités en durée/usage ; ajouter tables/migrations nécessaires.
- [x] Émettre le premier événement approuvé par le code — changement du mot de passe — dans la transaction d’authentification ; rollback de l’outbox si le changement échoue.
- [ ] Séparer configuration de destinataires système (groupes d’alerte) et adresse personnelle (`users.email`) ; décider comment vérifier qu’une adresse est correcte/contrôlée.

### 5.6 Checklist de tests des notifications

#### Tests unitaires (sans réseau)

- [x] Le template construit le sujet, destinataire, texte et HTML de l’avis de sécurité.
- [x] Les variables utilisateur sont échappées dans le HTML ; ce template ne contient aucun lien dynamique.
- [x] Le payload n’inclut pas mot de passe, hash, cookie, token de session ni document joint.
- [x] Les préférences e-mail sont persistées par utilisateur ; les deux événements de sécurité obligatoires sont retournés comme non désactivables. Aucun événement optionnel n’est actuellement disponible pour être filtré.
- [x] La clé de déduplication empêche l’insertion en double ; le provider reçoit une clé stable propre au message pour une reprise après crash.
- [x] Le retry applique un backoff borné et termine au nombre maximal configuré ; les erreurs permanentes passent directement à `dead`.
- [x] Les échecs provider sont classés par code sans enregistrer leurs corps de réponse ou secrets.

#### Tests d’intégration MySQL + faux fournisseur

- [x] Si une transaction métier rollback, aucune ligne outbox ne reste ; le changement de mot de passe insère l’événement uniquement après validation des identifiants.
- [x] Si l’opération commit, l’outbox contient le type d’événement et l’adresse du compte, sans mot de passe.
- [x] Un worker marque un message envoyé et utilise la clé d’idempotence provider.
- [x] Deux workers concurrents ne prennent pas le même événement actif.
- [x] Un échec temporaire libère le lease et reprogramme le message ; un échec permanent le place en `dead`.
- [ ] Reprise après crash après envoi mais avant marquage : tester le comportement idempotent/dédupliqué.
- [ ] Un utilisateur désactivé, adresse non vérifiée ou préférence désactivée suit la politique convenue.
- [ ] Les événements d’import/anomalie sont regroupés et ne produisent pas une tempête d’e-mails.

#### Tests e-mail de staging

- [ ] Utiliser un sandbox/boîte de capture du fournisseur, jamais les adresses réelles en test.
- [ ] Vérifier SPF/DKIM/DMARC et le domaine d’expédition avec les outils du fournisseur.
- [ ] Envoyer un e-mail de chaque modèle vers une adresse interne contrôlée.
- [ ] Vérifier rendu mobile/desktop, texte brut, liens, accents, fuseau horaire et désinscription/préférences le cas échéant.
- [ ] Vérifier webhook de livraison/rebond/plainte si le produit en dépend ; authentifier la signature du webhook et dédupliquer les événements entrants.
- [ ] Activer progressivement en production et surveiller bounce, complaint, quota, délai et files en attente.

## 6. Plan de test end-to-end de l’API pour le frontend

- [ ] Se connecter depuis l’URL frontend de Preview avec un compte de test.
- [ ] Recharger la page : `GET /auth/me` doit restaurer la session.
- [ ] Lire le tableau de bord et vérifier les valeurs avec les données semées.
- [ ] Créer un membre, le modifier, chercher, consulter sa fiche, l’archiver et contrôler l’historique.
- [ ] Créer une rubrique et un compte ; désactiver chacun et vérifier que l’opération nouvelle qui les référence est rejetée.
- [ ] Créer une cotisation, une recette, un don et une dépense ; contrôler mouvements, soldes, tableau de bord, recherche, rapport et export.
- [ ] Déclencher une dépense excessive : l’interface doit recevoir une erreur métier claire et aucun enregistrement partiel ne doit exister.
- [ ] Modifier et annuler une écriture : contre-écriture et données historiques restent cohérentes.
- [ ] Téléverser et associer un justificatif ; télécharger exactement le fichier ; supprimer et vérifier que l’objet n’existe plus.
- [ ] Faire une simulation d’import puis comparer la base avant/après ; l’état doit être identique.
- [ ] Lancer un import réel dans la base de test et contrôler le résumé, les lignes rejetées et les écritures.
- [ ] Consulter un rapport et comparer ses totaux à ceux du dashboard et des listes.
- [ ] Tester préférences et mot de passe ; vérifier application effective dans l’interface.
- [ ] Déclencher chaque notification de staging et vérifier le message capturé sans fuite de secrets.
- [ ] Simuler API indisponible, session expirée et timeout : l’interface doit distinguer réseau, `401`, validation et erreur serveur.

## 7. Ordre d’implémentation proposé

### Phase A — fiabiliser l’existant

- [ ] Lancer et maintenir la suite MySQL `npm test` verte.
- [ ] Ajouter TLS Aiven et test d’intégration TLS.
- [ ] Découpler `createApp()` du serveur écoutant et des migrations ; exécuter une migration une seule fois pendant le déploiement.
- [ ] Définir le cookie multi-domaine et valider le login réel sur navigateur.
- [ ] Remplacer le stockage justificatifs avant leur usage sous Vercel.
- [ ] Ajouter les clés d’idempotence côté frontend pour les mutations à effet financier.
- [ ] Corriger le taux diocésain `null` → `0` et appliquer les préférences globales dans le frontend.

### Phase B — notifications e-mail

- [ ] Valider le domaine, From/Reply-To, consentement et rétention avant d’activer l’envoi réel.
- [x] Implémenter migration outbox + service d’enqueue transactionnel.
- [x] Implémenter provider Resend injectable et mode désactivé ; les tests utilisent un provider factice.
- [x] Implémenter worker/cron à lots, verrouillage, retry borné, déduplication et codes d’échec expurgés.
- [x] Implémenter l’avis de sécurité texte/HTML après changement du mot de passe, destiné à l’adresse du compte.
- [x] Ajouter la lecture/mise à jour des préférences e-mail et la supervision admin de l’outbox avec retry contrôlé d’un état `dead`.
- [x] Ajouter les tests unitaires et d’intégration MySQL avec faux provider ; recette fournisseur sandbox reste à faire.
- [ ] Déployer avec un domaine d’envoi validé, commencer avec destinataires internes, surveiller et élargir progressivement.

### Phase C — fonctionnalités optionnelles décidées avec le métier

- [x] Définir rôles/droits puis réaliser administration des utilisateurs ; accès admin validé et méthodes documentées.
- [x] Définir procédure de correction comptable puis réaliser ajustement contrôlé.
- [x] Définir la correction diocésaine comme contre-écriture append-only, période immuable, puis ajouter le schéma, la route et le service transactionnels.
- [ ] Ajouter les filtres de recherche/rapports demandés et leurs tests de contrat.

## 8. Critères de sortie avant production

- [ ] Toutes les fonctionnalités visibles du frontend ont un test API de lecture/écriture et les erreurs sont rendues correctement.
- [ ] Les opérations financières ont des tests de rollback, concurrence et idempotence.
- [ ] La suite backend passe contre une base dédiée jetable ; aucun test destructif n’a visé une base réelle.
- [ ] Connexion Aiven utilise TLS vérifié ; secrets uniquement dans les variables d’environnement du fournisseur.
- [ ] Migrations contrôlées, sauvegarde/restauration répétée et stratégie de rollback connues.
- [ ] Cookies, CORS, CSRF, rate limit et autorisations testés sur domaines de production/preview.
- [ ] Fichiers justificatifs persistants et restaurables.
- [ ] Jobs/worker exécutés par un mécanisme durable et observable, avec alertes d’échec.
- [ ] Notifications désactivables/configurables conformément à la décision, sans fuite de données, avec retries et suivi des rebonds.
- [ ] Journaux et métriques ne contiennent aucun secret ou donnée financière personnelle inutile.
- [ ] Recette fonctionnelle signée par le métier pour taux diocésain, statuts, annulation, assiettes, rôles et destinataires e-mail.

---

## 9. Matrice des méthodes et endpoints par fonctionnalité

Les endpoints ci-dessous sont les contrats présents dans les routeurs actuels, sauf lorsqu’ils sont explicitement marqués **À créer**. Ils sont protégés par session à partir du montage des routeurs métier dans `app.js`. Toutes les mutations doivent continuer à passer par Zod puis un service ; la logique SQL ne doit pas être déplacée dans les composants React.

### 9.1 API commune, session et membres

| Fonctionnalité | Endpoint(s) | Méthode(s) backend appelée(s) | Développement / tests à conserver ou ajouter |
| --- | --- | --- | --- |
| Santé API | `GET /api/sante` | `checkDatabaseConnection`, `sendSuccess` | Garder une réponse minimale et tester DB indisponible sans fuite de config. |
| Connexion | `POST /api/auth/login` | `login`, `rateLimitAuthentication`, `validateBody(loginSchema)`, `cookieOptions`, `publicUser` | Tester hash bcrypt, compte actif, erreurs neutres, rate limit, cookie de production. |
| Utilisateur courant | `GET /api/auth/me` | `authenticate`, `getCurrentUser`, `requireActiveAccount`, `publicUser` | Tester session absente, expirée, révoquée ou utilisateur inactif. |
| Déconnexion | `POST /api/auth/logout` | `logout`, effacement cookie | Vérifier suppression serveur et côté navigateur. |
| Changement mot de passe | `PUT /api/auth/password` | `changePassword`, `validateBody(passwordSchema)` | Vérifier ancien mot de passe, politique minimale, révocation des autres sessions, audit sans secret. |
| Demander reset mot de passe | `POST /api/auth/password-reset/request` | `rateLimitPasswordReset`, `requestPasswordReset`, token SHA-256 + AES-GCM dans l’outbox | Réponse 202 identique pour adresse connue/inconnue ; limiter par IP/adresse ; adresse de Preview contrôlée. |
| Confirmer reset mot de passe | `POST /api/auth/password-reset/confirm` | `confirmPasswordReset`, `passwordResetConfirmSchema`, bcrypt, révocation des sessions | Token à usage unique et limité à 48 heures ; rejet expiré/réutilisé ; nouveau login et avis e-mail. |
| Administration utilisateurs | `GET/POST /api/admin/users`, `GET/PUT /api/admin/users/:id`, `PATCH /api/admin/users/:id/statut` | `requireAdmin`, `listUsers`, `getUserById`, `createUser`, `updateUser`, `setUserActive`, `createAuditLog` | `admin` seulement ; rôle courant exposé par `/auth/me`; empêcher désactivation/rétrogradation du dernier admin actif et révoquer les sessions désactivées. |
| Lister membres | `GET /api/membres?q&statut&page&limit&sort` | `listMembers`, `parsePagination`, `countMembers`, `buildFilters` | Vérifier DTO, tri autorisé, filtre archives, méta pagination. |
| Créer membre | `POST /api/membres` | `memberSchema`, `createMember`, `nextReference`, `createAuditLog` | Tester champs, unicité et références concurrentes. |
| Détail/modifier membre | `GET/PUT /api/membres/:id` | `getMemberById`, `memberUpdateSchema`, `updateMember` | Tester patch partiel, non trouvé, champs inconnus et audit. |
| Changer statut | `PATCH /api/membres/:id/statut` `{statut}` | `memberStatusSchema`, `setMemberStatus` | Tester états actif/inactif/archive et conservation des liens financiers. |
| Dossier financier membre | `GET /api/membres/:id/operations`, `/synthese-financiere`, `/cotisations` | `getMemberOperations`, `getMemberFinancialSummary`, `getMemberContributions` | Tester opérations annulées, pagination, membre inconnu et montants. |

### 9.2 Rubriques, comptes et opérations financières

| Fonctionnalité | Endpoint(s) | Méthode(s) backend appelée(s) | Développement / tests à conserver ou ajouter |
| --- | --- | --- | --- |
| Liste/détail rubrique | `GET /api/rubriques/{cotisations,recettes,dons,depenses}[?q]`, `GET /api/rubriques/:type/:id` | `listCategories`, `getCategory`, `kindOf` | Vérifier quatre types, nature des dons, utilisations et types inconnus. |
| Créer rubrique | `POST /api/rubriques/:type` | `categorySchema`, `createCategory`, `findCategoryByCode`, `createAuditLog` | Tester code automatique si omis, doublon, transaction/audit. |
| Modifier/activer rubrique | `PUT /api/rubriques/:type/:id`, `PATCH .../:id/statut` `{actif}` | `categoryUpdateSchema`, `updateCategory`, `setCategoryActive`, `isCategoryUsable` | Tester refus de changement de code après usage et refus d’usage inactif en création d’opération. |
| Lister opérations | `GET /api/{cotisations,recettes,dons,depenses}?q&statut&dateDebut&dateFin&compteId&rubriqueId&membreId&page&limit&sort` | `operationRouter(type)`, `listOperations`, `buildFilters`, `parsePagination` | Tester filtres, dates inclusives, tri par liste blanche et représentation DTO. |
| Détail opération | `GET /api/{type}/:id` | `getOperationDetail`, `getOperationById` | Vérifier mouvements, historique et justificatifs éventuels. |
| Créer opération | `POST /api/{type}` | `createSchemaFor`, `createOperation`, `operationConfig`, `parsePositiveAmount`, `isCategoryUsable`, `lockAccounts`, `assertAccountsSolvent`, `createFinancialMovement`, `nextReference`, `createAuditLog` | Tester les variantes des 4 types, idempotence, transaction, solde et références. |
| Modifier opération | `PUT /api/{type}/:id` | `updateSchemaFor`, `updateOperation`, mouvements compensatoires, audit | Tester changement compte/montant/catégorie, opération annulée et rollback. |
| Annuler opération | `POST /api/{type}/:id/annulation` `{motif}` | `cancelSchema`, `cancelOperation`, mouvement de contre-écriture, historique | Tester motif obligatoire, répétition, découvert et état après annulation. |
| Créer compte | `POST /api/comptes` | `accountSchema`, `createAccount` | Tester code unique, solde initial et découvert. La clé idempotence est optionnelle actuellement ; le client doit envoyer un header stable pour protéger les retries. |
| Ajustement compte | `POST /api/comptes/:id/ajustements` | `requireAdmin`, `accountAdjustmentSchema`, `createAccountAdjustment`, `createFinancialMovement`, `assertAccountsSolvent`, `createAuditLog` | Admin seulement ; sens, montant positif, date, motif obligatoire, référence de justificatif facultative ; table d’ajustement, mouvement, solde et audit doivent commit/rollback ensemble. |
| Lister/détail compte | `GET /api/comptes?actif&type&q`, `GET /api/comptes/:id` | `listAccounts`, `getAccountById` | Tester filtres, soldes calculés, compte inactif et indexation. |
| Modifier/activer compte | `PUT /api/comptes/:id`, `PATCH /api/comptes/:id/statut` `{actif}` | `accountUpdateSchema`, `updateAccount`, `setAccountActive` | Ne jamais permettre l’écrasement du solde/mouvements historiques par ce endpoint. |
| Solde/mouvements | `GET /api/comptes/:id/solde?date`, `GET /api/comptes/:id/mouvements?page&limit&dateDebut&dateFin` | `getAccountBalance`, `getAccountMovements` | Tester soldes datés, pagination et invariant solde/mouvements. |
| Synthèse trésorerie | `GET /api/tresorerie/synthese?dateDebut&dateFin` | `getCashPosition`, `getBankPosition`, `getConsolidatedPosition` | Comparer caisse + banque au consolidé, vérifier périodes et annulés. |

### 9.3 Tableau de bord, diocèse, pièces jointes et recherche

| Fonctionnalité | Endpoint(s) | Méthode(s) backend appelée(s) | Développement / tests à conserver ou ajouter |
| --- | --- | --- | --- |
| Tableau de bord | `GET /api/dashboard?dateDebut&dateFin` | `getDashboardSummary`, `countActiveMembers`, `sumContributions`, `sumRevenues`, `sumDonations`, `sumExpenses`, `getAccountBalances`, `getFinancialEvolution`, `getRevenueBreakdown`, `getExpenseBreakdown`, `getRecentOperations` | Tester correspondance avec SQL indépendant et shape consommée par `DashboardSummary`. |
| Lister contributions diocésaines | `GET /api/contribution-diocesaine?q&statut&page&limit` | `listDiocesanContributions` | Tester pagination, filtres et DTO. |
| Contribution manuelle | `POST /api/contribution-diocesaine` | `diocesanSchema`, `createDiocesanContribution`, `createFinancialMovement`, `createAuditLog` | Tester compte, montant, période et mouvement de sortie transactionnel. |
| Calcul diocésain sans écriture | `POST /api/contribution-diocesaine/calcul` `{dateDebut,dateFin}` | `diocesanPeriodSchema`, `calculateDiocesanContribution`, `applyRate`, `getGeneralSettings` | Tester paramètre manquant, bornes et arrondi exact ; aucune écriture ne doit être créée. |
| Synthèse/génération diocésaine | `GET /api/contribution-diocesaine/synthese`, `POST /api/contribution-diocesaine/generation` | `getDiocesanSummary`, `generateDiocesanContribution`, `calculateDiocesanContribution`, transaction et idempotence | Tester période, compte, répétition, chevauchement et mouvement. |
| Détail/correction/annulation diocésaine | `GET/PUT /api/contribution-diocesaine/:id`, `GET /:id/operations`, `POST /:id/annulation` | `getDiocesanContributionById`, `updateDiocesanContribution`, `diocesanUpdateSchema`, `getRelatedOperations`, `cancelDiocesanContribution` | Correction valide uniquement ; période/calcul immuables ; contre-écriture append-only, mouvements et audit transactionnels ; annulation ultérieure reste cohérente. |
| Lister/téléverser justificatif | `GET /api/justificatifs?q&operationType&page&limit`, `POST /api/justificatifs` multipart | `listAttachments`, `handleFileUpload`, `uploadAttachment`, validation MIME/signature, SHA-256 | Préserver tests fichier manquant, signature fausse, limite, transaction et nettoyage orphelin. |
| Détail/liaison/téléchargement/suppression | `GET /api/justificatifs/:id`, `POST /:id/liaison`, `GET /:id/telechargement`, `DELETE /:id` | `getAttachmentById`, `linkAttachmentToOperation`, `downloadAttachment`, `deleteAttachment` | À adapter à un stockage objet avant Vercel ; tester accès, en-têtes et cohérence base/objet. |
| Justificatifs d’une opération | `GET /api/operations/:type/:id/justificatifs` | `listOperationAttachments`, `assertOperationExists` | Tester chaque type autorisé et opération inconnue. |
| Recherche globale | `GET /api/recherche?q&categories&page&limit` | `globalSearch`, `searchMembers`, `searchContributions`, `searchRevenues`, `searchDonations`, `searchExpenses`, `searchAttachments` | Tester catégories, injection, pagination et types de résultats. Le filtre catégorie est implémenté backend, mais n’est pas proposé par l’écran actuel. |

### 9.4 Rapports, échanges, anomalies, paramètres et aide

| Fonctionnalité | Endpoint(s) | Méthode(s) backend appelée(s) | Développement / tests à conserver ou ajouter |
| --- | --- | --- | --- |
| Catalogue rapports | `GET /api/rapports` | `REPORTS` | Veiller à garder les valeurs identiques aux options utilisées par le frontend. |
| Rapport JSON/exports | `GET /api/rapports/:type`, `GET /:type/export?format=csv|xlsx|pdf` | `getReport`, `exportReport`, méthodes de rapports par domaine, `buildCsv`, `buildWorkbook`, `buildPdf` | Tests de chaque type/format, dates, contenu, caractères CSV et cohérence. |
| Catalogue ressources échange | `GET /api/echanges` | `listExchangeResources` | Contrat de types et indicateur `import` consommés par ModuleTools. |
| Modèle/export/import | `GET /api/echanges/:resource/modele`, `GET /:resource/export?format`, `POST /:resource/import?simulation&partiel` multipart | `getResource`, `buildImportTemplate`, `exportResource`, `importResource` | Tester simulation, transaction tout-ou-rien, mode partiel, lignes erronées, taille et déduplication. |
| Règles/analyse anomalies | `GET /api/anomalies/regles`, `POST /api/anomalies/analyse` | `ANOMALY_RULES`, `runAnomalyChecks`, `createAnomaly`, `createAuditLog` | Faire approuver chaque règle ; tester faux positifs, répétition et coût. |
| Liste/détail/statut/résolution anomalies | `GET /api/anomalies`, `GET /:id`, `PATCH /:id/statut`, `POST /:id/resolution` | `listAnomalies`, `getAnomalyById`, `updateAnomalyStatus`, `resolveAnomaly` | Vérifier transitions, commentaire, historique, `resolue_le` et audit dans une transaction cohérente ; la résolution manuelle est transactionnelle et exige un commentaire. |
| Worker notifications | `GET /api/cron/notifications` (secret Bearer), script local `npm run notifications:process` | `claimPendingNotifications`, `deliverNotification`, `retryFailedNotifications`, `createEmailProvider` | Lot borné, lease, retry avec backoff, clé d’idempotence provider ; aucun endpoint utilisateur d’envoi libre. Le provider reste désactivé par défaut. |
| Préférences e-mail | `GET/PUT /api/notifications/preferences` | `getNotificationPreferences`, `updateNotificationPreferences`, `notificationPreferencesSchema` | Session obligatoire et préférences isolées par utilisateur ; `PASSWORD_CHANGED` et `PASSWORD_RESET` restent obligatoires ; le choix concerne les futurs événements optionnels. |
| Supervision/retry outbox admin | `GET /api/admin/notifications/outbox?status&page&limit`, `POST /api/admin/notifications/outbox/:id/retry` | `listNotificationOutbox`, `retryDeadNotification`, `requireAdmin` | Admin seulement ; destinataire masqué, payload/token/clé de déduplication exclus ; seulement `dead` relançable, audit transactionnel, nouvelle clé provider par relance manuelle. |
| Lecture réglages complets | `GET /api/parametres` | `getGeneralSettings`, `getDisplayPreferences`, `getSessionSecuritySettings` | Vérifier absence de secrets et sérialisation des valeurs null/default. |
| Modifier paramètres généraux | `PUT /api/parametres/generaux` | `generalSettingsSchema`, `updateGeneralSettings` | Tester assiette/taux, mise à jour partielle, null et audit. Corriger le frontend qui peut envoyer `0` pour `null`. |
| Préférences | `GET/PUT /api/parametres/preferences` | `getDisplayPreferences`, `preferencesSchema`, `updateDisplayPreferences` | Déjà présent. Tester isolation par user ; frontend doit appliquer thème/masquage/page-size. |
| Aide | `GET /api/aide`, `GET /api/aide/:slug` | `listHelpSections`, `getHelpSection` | Tester slug absent et shape attendu ; pas de persistance nécessaire pour le contenu statique. |

### 9.5 Contrats restant optionnels ou non implémentés

Ces endpoints ne doivent être ajoutés qu’après validation du besoin et des règles d’accès.

| Fonctionnalité future | Endpoint proposé | Méthodes à créer | Données/règles à prévoir |
| --- | --- | --- | --- |
| Import asynchrone durable | À créer seulement si la durée maximale serverless ne permet pas l’import synchrone | `startImport`, `getImportStatus`, `processImport` | Nécessite job ID, stockage du résultat, worker et reprise ; aucune preuve actuelle que l’import synchrone dépasse la limite Vercel. |
| Filtres métier spécifiques rapports/recherche | À définir avec les utilisateurs avant d’ajouter des query params | Schémas Zod de query et critères SQL sur liste blanche | Ne pas inventer de champs ni interpoler une colonne SQL fournie par le client. |

**Décision e-mail :** les méthodes `GET/PUT /api/notifications/preferences` sont implémentées. Les deux événements actuellement disponibles (`PASSWORD_CHANGED`, `PASSWORD_RESET`) restent obligatoires et ne sont pas désactivables. La préférence est mémorisée pour les futurs événements informatifs optionnels ; la liste de ces événements est actuellement vide.

**Décision diocésaine :** `PUT /api/contribution-diocesaine/:id` corrige uniquement compte, montant, date d’opération et libellé. Les bornes de période, l’assiette et le taux d’origine restent immuables ; chaque correction conserve l’écriture précédente et ajoute une contre-écriture compensatrice.

## 10. Phases de développement avec méthodes, endpoints et tests

Les phases sont ordonnées par dépendance. Le périmètre de Phase 1 à 3 correspond principalement à la fiabilisation et la recette des fonctionnalités déjà en place ; les Phases 4 et 5 ajoutent l’e-mail et les besoins conditionnels. Les méthodes déjà existantes ne sont pas à réécrire : il faut les consolider et étendre leurs tests si un critère manque.

### Phase 0 — Décisions et fondations techniques

**But :** décider les contrats qui changent le comportement métier et rendre un environnement de test sûr.

- [ ] Confirmer les règles financières : arrondi, assiette diocésaine, annulation, modification, découvert.
- [x] Confirmer les événements de sécurité e-mail `PASSWORD_CHANGED` et `PASSWORD_RESET`, leur destinataire (`users.email`) et leur statut obligatoire ; les événements optionnels restent à définir avant activation.
- [ ] Configurer et vérifier le fournisseur réel, son domaine, From/Reply-To, la délivrabilité et la rétention en staging.
- [x] Réserver le schéma `misericorde_divine_test` aux tests et ajouter des garde-fous contre un nom incorrect ou un hôte distant non confirmé.
- [x] Définir et implémenter le schéma de rôle/droits : `admin` et `gestionnaire`, avec tests d’accès.
- [ ] Geler les DTO API et exemples d’erreurs consommés par le frontend.

**Méthodes/fichiers :** `environment.js`, `database.js`, `app.js`, `validate.js`, `errors.js`; tests dans `tests/env.js`, `tests/helpers.js`.

**Vérification de sortie :** le périmètre destructif est limité aux tables du schéma de test dédié ; les contrats sont connus et aucune règle financière ouverte n’est codée par supposition.

### Phase 1 — Stabiliser infrastructure, session et persistance

1. **MySQL/Aiven TLS**
   - Modifier `createDatabasePool` pour lire une configuration TLS serveur et charger le CA de façon vérifiée.
   - Ajouter validation d’environnement et test `SELECT 1` avec CA valide, CA absent/invalide et TLS requis.
2. **Application HTTP / Vercel**
   - Extraire la construction pure de l’app dans `createApp()` sans `listen()`, migration ni cron au chargement.
   - Garder un `server.js` pour local ; créer un entrypoint/fonction HTTP exportant le handler pour l’environnement choisi.
   - Exécuter `runMigrations` une seule fois comme étape de livraison contrôlée ; conserver `npm run migrate` comme commande opérateur.
   - Déplacer `revokeExpiredSessions` vers un cron/worker avec exécution observable et idempotente.
3. **Cookies et origine**
   - Ajuster `cookieOptions()` et `cors()` selon les domaines et contraintes SameSite/Secure réellement retenus.
   - Tester login puis appel `/auth/me` dans un vrai navigateur frontend/backend séparés, ainsi que logout, Preview et Production.
4. **Stockage fichier**
   - Créer un adaptateur `storage.put/get/delete`; remplacer les appels `fs` dans `uploadAttachment`, `downloadAttachment`, `deleteAttachment`.
   - Configurer le stockage persistant et tester rollback DB, objet orphelin, absence et retry.

**Endpoints impactés :** aucun nouveau parcours métier requis ; garder `GET /api/sante`, `/api/auth/*`, `/api/justificatifs/*`.

**Critère de sortie :** serveur déployé sans migrations répétées, MySQL TLS vérifié, cookie persistant au bon domaine, fichier récupérable quelle que soit l’invocation.

### Phase 2 — Recetter le cœur métier financier et les données

- [ ] Membres : sécuriser/compléter tests des méthodes `createMember`, `updateMember`, `setMemberStatus`, vues synthèse et historique ; endpoints `/api/membres*`.
- [ ] Rubriques : tests des méthodes `createCategory`, `updateCategory`, `setCategoryActive`, `isCategoryUsable`; endpoints `/api/rubriques/:type*`.
- [ ] Comptes : tests `createAccount`, `updateAccount`, `setAccountActive`, `getAccountBalance`, `getAccountMovements`, `createFinancialMovement`, `lockAccounts`, `assertAccountsSolvent`; endpoints `/api/comptes*` et `/api/tresorerie/synthese`.
- [ ] Opérations : tests par configuration pour `createOperation`, `updateOperation`, `cancelOperation`, `getOperationDetail`; endpoints `/api/cotisations*`, `/api/recettes*`, `/api/dons*`, `/api/depenses*`.
- [ ] Contribution diocésaine : tester `applyRate`, `calculateDiocesanContribution`, `generateDiocesanContribution`, `createDiocesanContribution`, `cancelDiocesanContribution`; endpoints `/api/contribution-diocesaine*`.
- [ ] Contrôler invariants inter-modules : écritures/mouvements, solde, dashboard, rapports, historique et exports.
- [ ] Transmettre systématiquement `Idempotency-Key` depuis le frontend aux créations financières et imports finalisés ; tester mêmes clés et retries.

**Critère de sortie :** chaque mutation a un test de succès, un test de validation/autorisation, et un test d’échec atomique ; les totaux se recoupent.

### Phase 3 — Recherche, pièces jointes, rapports, imports et anomalies

- [ ] Recherche : conserver `globalSearch` et ses `search*`; ajouter tests de chaque catégorie, filtres, sécurité SQL et pagination ; endpoint `/api/recherche`.
- [ ] Justificatifs : terminer l’adaptateur objet de Phase 1, puis vérifier les routes de lien et téléchargement multipart ; endpoints `/api/justificatifs*` et `/api/operations/:type/:id/justificatifs`.
- [ ] Rapports : tester `getReport`, chaque rapport métier et `exportReport` en CSV/XLSX/PDF ; endpoints `/api/rapports*`.
- [ ] Imports : tester `getResource`, `buildImportTemplate`, `exportResource`, `importResource` ; endpoint `/api/echanges/:resource/import`; vérifier simulation non mutante et rollback total.
- [ ] Anomalies : faire approuver `ANOMALY_RULES`, tester `runAnomalyChecks`, `createAnomaly`, `updateAnomalyStatus`, `resolveAnomaly`; endpoints `/api/anomalies*`.
- [ ] Ajouter un résumé d’import durable (job ID + statut) uniquement si les limites de temps de la fonction ne permettent pas le traitement synchrone ; dans ce cas, ajouter `POST /api/echanges/:resource/imports`, `GET /api/echanges/imports/:id` et méthodes `startImport/getImportStatus/processImport`.

**Critère de sortie :** export lisible, import vérifiable et reproductible, simulation sans écriture, anomalies avec aucun doublon involontaire, fichiers persistants.

### Phase 4 — Notifications e-mail (socle et sécurité)

**Ordre technique précis :**

1. [ ] Compléter les secrets et valider sandbox, domaine, From/Reply-To et DNS avant l’activation en ligne.
2. [x] Créer migration `005_notification_outbox.sql` avec outbox indexée ; les abonnements et tokens de reset ne sont pas inclus.
3. [x] Ajouter `notificationEventSchema` et catalogue fermé avec l’événement `PASSWORD_CHANGED`.
4. [x] Développer `enqueueNotification(executor,event)` transactionnel avec clé unique. Aucun endpoint public d’envoi libre.
5. [x] Ajouter provider Resend injectable et provider fake pour tests.
6. [x] Ajouter template texte + HTML échappé d’avis de sécurité.
7. [x] Connecter `changePassword` à l’outbox dans sa transaction ; un rollback métier annule l’événement.
8. [x] Développer `claimPendingNotifications`, `deliverNotification`, `retryFailedNotifications` avec lease, backoff borné, idempotence et erreurs expurgées.
9. [x] Ajouter un script local et `GET /api/cron/notifications` protégé par `CRON_SECRET`, sans timer dans Express.
10. [x] Ajouter `GET/PUT /api/notifications/preferences`, authentifié et lié à l’utilisateur courant ; les événements de sécurité restent obligatoires et les préférences sont préparées pour les événements optionnels futurs.
11. [x] Ajouter `GET/POST /api/admin/notifications/outbox*` ; admin seulement, liste expurgée, statut `dead` requis pour relancer, audit et clé provider distincte par relance manuelle.
12. [x] Tester les méthodes d’administration/préférences, l’isolation/session, l’expurgation des données et l’idempotence de livraison ; [ ] recette staging et délivrabilité fournisseur restent à faire.

**Événement de première livraison conseillé :** avis de changement de mot de passe vers l’adresse du compte et/ou notification de résumé d’import vers l’initiateur, après validation produit. Pour les opérations financières, valider le destinataire et le contenu avant activation.

**Endpoints e-mail :** les notifications d’événements ne nécessitent pas de route d’envoi appelée par le frontend. L’envoi réel est effectué par le worker ; `GET/PUT /api/notifications/preferences` stocke le choix pour de futurs événements optionnels sans désactiver les deux messages de sécurité. Le reset utilise `POST /api/auth/password-reset/request` et `POST /api/auth/password-reset/confirm` avec token à usage unique.

**Critère de sortie :** un échec fournisseur ne fait pas échouer une écriture métier ; il génère une tentative/retry, les doublons sont maîtrisés et le staging n’envoie qu’à des adresses contrôlées.

### Phase 5 — Fonctions optionnelles métier et administration

- [x] **Utilisateurs/permissions :** rôles `admin` et `gestionnaire`; seuls les admins gèrent `/api/admin/users*`; dernier admin actif protégé, désactivation révoque ses sessions et les changements sont audités.
- [x] **Reset mot de passe :** `requestPasswordReset`, `confirmPasswordReset`; `POST /api/auth/password-reset/request` et `/confirm`; réponse non énumérable, limitation persistante par IP/adresse, token aléatoire à usage unique et hashé en base, token chiffré dans l’outbox e-mail.
- [x] **Ajustement de compte :** `accountAdjustmentSchema`, `createAccountAdjustment`; `POST /api/comptes/:id/ajustements`; admin seulement, motif obligatoire, justificatif facultatif, mouvement et audit dans la même transaction, invariants de solde conservés.
- [x] **Modification diocésaine :** `diocesanUpdateSchema`, `updateDiocesanContribution`; `PUT /api/contribution-diocesaine/:id`; période/calcul immuables, ancienne écriture conservée, contre-écriture et mouvement corrigé atomiques ; rollback testé.
- [x] **Préférences e-mail :** `getNotificationPreferences`, `updateNotificationPreferences`; `GET/PUT /api/notifications/preferences`; préférences par utilisateur, audit et deux alertes de sécurité obligatoires.
- [x] **Supervision e-mail admin :** `listNotificationOutbox`, `retryDeadNotification`; `GET /api/admin/notifications/outbox`, `POST /api/admin/notifications/outbox/:id/retry`; droits admin, données masquées, audit et retry borné.
- [ ] **Filtres recherche/rapport :** ajouter schemas de query et critères whitelistés seulement après spécification ; garder les méthodes service autonomes et tests SQL injection.

### Phase 6 — Recette production et suivi

- [ ] Déployer Preview sur base de staging migrée avec comptes et fichiers factices.
- [x] Créer l’entrée Vercel catch-all du backend, la réécriture SPA du frontend, le cron de notifications et une validation fail-fast des variables Production.
- [x] Préparer le lien frontend de réinitialisation, le chiffrement AES-GCM du token dans l’outbox et les secrets dédiés dans le modèle `.env.production` backend.
- [ ] Exécuter la recette frontend/backend de la section 6 et enregistrer le résultat par endpoint.
- [ ] Vérifier ratios d’erreur, temps réponse, connexions MySQL, files outbox, retards, retries et rebonds.
- [ ] Tester restaurer une sauvegarde de base et récupérer justificatifs depuis le stockage objet.
- [ ] Promouvoir en Production après validation métier ; garder rollback applicatif et procédure de migration documentés.
- [ ] Vérifier que les variables e-mail Production/Preview sont séparées et que les notifications Preview restent en sandbox.

## 11. Format conseillé pour les tickets de développement

Pour chaque ticket, reprendre ce modèle afin que la fonctionnalité reste vérifiable :

```text
Fonctionnalité :
État : existante / à corriger / à développer
Phase :
Endpoint(s) :
Schéma de requête et réponse :
Méthode(s) service :
Tables/migration :
Règle métier approuvée par :
Tests unitaires :
Tests d’intégration :
Tests sécurité/concurrence :
Recette frontend :
Observabilité/alertes :
Critère d’acceptation :
```

## 12. Ordre de développement par sprint

Les sprints ci-dessous donnent un ordre de dépendances, sans imposer de durée. Un sprint est terminé lorsque ses critères de sortie sont vérifiés en base de test et que les parcours concernés ont été recettés depuis le frontend. Les fonctionnalités marquées « optionnelles » attendent une décision métier.

| Ordre | Sprint | Objectif | Fonctionnalités et endpoints/méthodes concernés | Critère de sortie / recette |
| ---: | --- | --- | --- | --- |
| 0 | Contrats et environnement sûr | Établir le périmètre et empêcher les tests sur une base applicative réelle. | Règles métier financières ; base de test dédiée ; `tests/env.js`, `tests/helpers.js`, `tests/safety.js`; décision fournisseur, événements et destinataires e-mail. | Tests destructifs limités au schéma jetable dédié ; confirmations explicites requises à distance ; décisions métier et contrats d’API documentés. |
| 1 | Socle d’exécution et base | Préparer une exécution stable sur Vercel et Aiven. | `createDatabasePool`, `checkDatabaseConnection`, `createApp`, `runMigrations`, `revokeExpiredSessions`, TLS Aiven ; `GET /api/sante`. | Implémentation et tests locaux ; connexion MySQL avec CA Aiven et déploiement Vercel à valider ; migrations explicites ; aucun job permanent dans la fonction. |
| 2 | Session et sécurité navigateur | Garantir que le frontend reste authentifié sur les domaines réels. | `login`, `logout`, `getCurrentUser`, `cookieOptions`, `cors`, `checkOrigin`; `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PUT /api/auth/password`. | Tests locaux CORS/CSRF/cookie ; login/rechargement/logout avec domaines Preview et cookie de production à valider au déploiement. |
| 3 | Membres et rubriques | Stabiliser les référentiels nécessaires aux opérations financières. | `createMember`, `updateMember`, `setMemberStatus`, `listMembers`, `getMemberFinancialSummary`; `createCategory`, `updateCategory`, `setCategoryActive`; `/api/membres*`, `/api/rubriques/:type*`. | Recette backend en base de test verte ; tests ciblés ajoutés ; parcours UI et recherche `%`/`_` à compléter avant de clore la recette frontend. |
| 4 | Comptes et opérations | Vérifier la cohérence comptable fondamentale. | `createAccount`, `getAccountBalance`, `getAccountMovements`, `createFinancialMovement`, `lockAccounts`, `assertAccountsSolvent`; `createOperation`, `updateOperation`, `cancelOperation`; `/api/comptes*`, `/api/tresorerie/synthese`, `/api/cotisations*`, `/api/recettes*`, `/api/dons*`, `/api/depenses*`. | Tests backend de montant, rollback, découvert, concurrence, clé d’idempotence, annulation et invariant des soldes verts ; build frontend réussi ; recette UI complète reste à faire. |
| 5 | Contribution diocésaine et paramètres métier | Valider calculs qui dépendent de règles métier. | `getGeneralSettings`, `updateGeneralSettings`, `calculateDiocesanContribution`, `applyRate`, `generateDiocesanContribution`, `createDiocesanContribution`, `cancelDiocesanContribution`; `/api/parametres/generaux`, `/api/contribution-diocesaine*`; verrouillage par période exacte. | Tests locaux verts : assiettes, taux nul explicite, arrondi, période, génération concurrente identique, mouvement et annulation ; confirmation du métier sur le chevauchement des périodes encore attendue. |
| 6 | Justificatifs persistants | Rendre les pièces jointes fiables sur un environnement serverless. | Adaptateurs local et Vercel Blob privé ; `uploadAttachment`, `linkAttachmentToOperation`, `downloadAttachment`, `deleteAttachment`; `/api/justificatifs*`, `/api/operations/:type/:id/justificatifs`. | Tests locaux verts pour upload, liaison aux cinq types, téléchargement et suppression ; test réel Preview/Production avec store/token et persistance inter-invocations encore attendu. |
| 7 | Recherche, rapports et échanges | Compléter les parcours d’analyse et d’import/export. | `globalSearch`, `search*`, `getReport`, `exportReport`, `buildCsv`, `buildWorkbook`, `buildPdf`, `buildImportTemplate`, `exportResource`, `importResource`; `/api/recherche`, `/api/rapports*`, `/api/echanges*`. | Tests disponibles verts sur rapports, formats CSV/XLSX/PDF, totaux, simulation sans mutation, rollback tout-ou-rien et neutralisation des formules ; recette navigateur et import partiel restent à compléter. |
| 8 | Anomalies et audit | Vérifier la détection et la traçabilité avec les règles approuvées. | `runAnomalyChecks`, `createAnomaly`, `listAnomalies`, `updateAnomalyStatus`, `resolveAnomaly`, `createAuditLog`; `/api/anomalies*`. | Tests verts sur détection d’incohérence, absence de doublon, résolution automatique/manuelle, historique et expurgation récursive ; fixtures pour chaque règle restent à compléter. |
| 9 | Notifications e-mail — socle | Construire les mécanismes de livraison avant d’activer des événements. | Migration `005_notification_outbox.sql` ; `notificationEventSchema`, `enqueueNotification`, `claimPendingNotifications`, `deliverNotification`, `retryFailedNotifications`, `createEmailProvider`, provider factice ; script et cron Vercel. | Tests sans réseau/MySQL couvrent transaction, rollback, retries, concurrence, déduplication, erreurs et absence de secrets dans les logs ; configuration réelle du provider non activée. |
| 10 | Notifications e-mail — premier événement | Livrer un avis de sécurité au propriétaire du compte. | Template texte/HTML ; `PUT /api/auth/password` enfile `PASSWORD_CHANGED` vers l’adresse utilisateur ; `GET /api/cron/notifications` protégé par secret. | Tests d’intégration avec faux provider et rendu validés ; recette sandbox, domaine DNS, variables Vercel et fréquence du cron restent à configurer avant livraison réelle. |
| 11 | Options d’administration | Développé selon l’arbitrage : `admin` + `gestionnaire`, ajustement réservé aux admins. | `listUsers`, `getUserById`, `createUser`, `updateUser`, `setUserActive`; `/api/admin/users*`; `requestPasswordReset`, `confirmPasswordReset`, `/api/auth/password-reset/*`; `createAccountAdjustment`, `POST /api/comptes/:id/ajustements`; écrans Admin et reset frontend. | Tests backend d’autorisations, dernier admin, non-énumération, token à usage unique et rollback de solde ; build frontend vert ; recette navigateur et e-mail staging à faire. |
| 12 | Recette finale et mise en production | Préparer Vercel/Aiven et vérifier tous les parcours intégrés et la reprise après incident. | Catch-all HTTP backend, `vercel.json` front SPA + cron, validation production des variables, migrations contrôlées, sauvegarde/restauration, stockage Blob, cookies/CORS et worker e-mail. | Build et tests locaux ; staging Aiven/Vercel, délivrabilité, restauration, métriques/alertes, promotion et rollback restent à valider avec les comptes de déploiement. |


### Règle de passage entre les sprints

- [ ] Ne pas commencer les écritures financières du Sprint 4 tant que les invariants de compte et les règles du métier ne sont pas arrêtés.
- [ ] Ne pas activer les notifications avant que les destinataires et événements soient approuvés et que le provider sandbox soit testé.
- [ ] Ne pas mettre les justificatifs en production Vercel avant l’adaptateur de stockage persistant.
- [ ] Ne pas promouvoir une migration non testée sur une copie de la base et sauvegarde récente.
- [x] Décision Sprint 11 : rôles `admin` et `gestionnaire`; seuls les admins gèrent les utilisateurs et réalisent les ajustements. L’édition diocésaine et les filtres non spécifiés restent reportés.

### Résultat d’implémentation du Sprint 0 — 25 octobre 2026

- [x] `tests/safety.js` vérifie `NODE_ENV=test`, le nom exact `misericorde_divine_test` et bloque tout hôte distant sans trois confirmations explicites (phrase de confirmation, hôte exact, nom exact).
- [x] `tests/helpers.js` revalide la cible juste avant le reset, crée le schéma de test si nécessaire et supprime uniquement les tables de ce schéma avec les clés étrangères suspendues ; il ne lance plus `DROP DATABASE`.
- [x] `tests/safety.test.js` couvre six cas : localhost accepté, environnement incorrect, base incorrecte, distant sans confirmation, mauvais hôte confirmé et distant correctement confirmé.
- [x] Le guide documente le périmètre, les variables requises pour un serveur de test distant et l’interdiction d’utiliser la base Aiven de production.
- [ ] Les décisions produit (règles financières ouvertes, fournisseur e-mail, événements et destinataires) restent à faire valider avant les sprints qui en dépendent.
- [x] Suite d’intégration exécutée le 25 octobre 2026 depuis `backend` contre MySQL local (`127.0.0.1:3306`) et le schéma réservé `misericorde_divine_test` : **97 tests réussis, 0 échec**.

### Résultat d’implémentation des Sprints 1 et 2 — 25 octobre 2026

- [x] Le pool MySQL ajoute TLS vérifié quand `DB_SSL=true`, accepte le CA multiligne et ne désactive jamais la validation du certificat.
- [x] `src/index.js` exporte l’application Express pour Vercel ; `src/server.js` reste le serveur local et ne lance ni migration ni tâche périodique.
- [x] `npm run migrate` applique les migrations avec les identifiants DB applicatifs sur un schéma précréé ; `npm run db:bootstrap` garde la création locale séparée. `npm run sessions:revoke-expired` fournit un nettoyage ponctuel à un ordonnanceur.
- [x] Cookies Secure/SameSite configurables, CORS à origine exacte, contrôle d’origine des écritures et `TRUST_PROXY` configurable.
- [x] Tests Sprint 1/2 : suite backend exécutée le 25 octobre 2026 contre MySQL local et schéma isolé ; **101 réussis, 0 échec**. Les tests couvrent l’export serverless, la configuration TLS/CA, SameSite, CORS et le rejet d’origine CSRF.
- [ ] Connexion au vrai service Aiven avec son CA et parcours navigateur sur les domaines Vercel restent des validations de déploiement ; ils ne sont pas simulés par la suite locale.

### Résultat d’implémentation et de test des Sprints 3 et 4 — 25 octobre 2026

- [x] Sprint 3 : références membre concurrentes distinctes, membre archivé conservé et refusé en nouvelle cotisation, synthèse vide, quatre familles de rubriques, rubrique désactivée lisible dans l’historique mais refusée en nouvelle opération.
- [x] Sprint 4 : invariants de solde, persistance des métadonnées des comptes, mouvements et soldes à date, découvert, annulations, rollback, opérations concurrentes et cohérence des rapports/dashboard vérifiés par tests d’intégration.
- [x] Idempotence renforcée par empreinte SHA-256 du payload : une clé ne peut pas être réutilisée sur une autre route ni avec un autre corps. Migration `002_idempotency_request_hash.sql` ajoutée.
- [x] Le frontend ajoute `Idempotency-Key` aux POST et conserve la clé en mémoire après une erreur réseau/serveur pour une nouvelle tentative avec le même endpoint et payload.
- [x] `npm test` depuis `backend`, contre MySQL local et le schéma réservé `misericorde_divine_test` : **108 tests réussis, 0 échec**. La migration 002 a été appliquée dans le reset de la base de test.
- [x] `npm run build` depuis la racine frontend : compilation de production réussie.
- [ ] Restent à vérifier en recette navigateur : parcours UX complet, recherche membre avec `%`/`_`, scénarios de champs inconnus/inactifs et comportement inter-instances Vercel pour les POST simultanés portant la même clé.

### Résultat d’implémentation et de test des Sprints 5 et 6 — 25 octobre 2026

- [x] Sprint 5 : calcul diocésain vérifié pour les trois assiettes configurables, taux nul explicite, bornes incluses, annulations exclues et arrondi exact ; le compte inactif est refusé.
- [x] Génération diocésaine protégée par une ligne de verrouillage et une transaction partagée couvrant calcul, contrôle du reste à payer, mouvement, historique et audit ; deux demandes simultanées pour la même période exacte ne produisent qu’un versement.
- [x] Sprint 6 : adaptateurs local et Vercel Blob privé ; le fournisseur est enregistré par justificatif. L’écriture Blob est compensée si la transaction SQL échoue, et la suppression restaure l’objet si sa transaction SQL échoue.
- [x] Tests des cinq types de liaison, téléchargement avec en-têtes de sécurité, validations fichier, absence d’orphelin lors d’une liaison invalide et tests unitaires des deux adaptateurs.
- [x] `npm test` depuis `backend`, sur MySQL local et le schéma isolé `misericorde_divine_test` : **113 tests réussis, 0 échec**.
- [ ] Recette navigateur et test de bout en bout sur Vercel Preview/Production avec un store Blob privé et `BLOB_READ_WRITE_TOKEN` configuré.
- [ ] Décider la politique de chevauchement des périodes diocésaines ; seule la double génération de bornes identiques est actuellement sérialisée.

### Résultat d’implémentation et de test des Sprints 7 à 10 — 25 octobre 2026

- [x] Sprint 7 : rapports disponibles recoupés aux listes et aux invariants de trésorerie ; CSV, XLSX et PDF réellement ouverts par les tests. Tests d’export couvrent l’injection de formules CSV et les cellules XLSX texte.
- [x] Sprint 7 : imports Excel/CSV déjà existants vérifiés en simulation sans mutation, en application tout-ou-rien avec rollback, et sur mise à jour financière persistée.
- [x] Sprint 8 : récurrence de l’analyse sans doublon, détection d’une incohérence, résolution automatique après correction, résolution manuelle avec historique ; l’écriture de la résolution et son audit sont désormais atomiques. L’audit expurge récursivement les clés sensibles.
- [x] Sprint 9 : migration `005_notification_outbox.sql`, catalogue fermé des événements, insertion transactionnelle et déduplication, claims concurrents avec lease, retries exponentiels bornés, erreurs sans corps fournisseur, adaptateur Resend injectable et worker cron protégé par `CRON_SECRET`.
- [x] Sprint 10 : `PUT /api/auth/password` enfile un avis de sécurité texte/HTML vers l’adresse du compte dans la transaction du changement ; le mot de passe, ses hashes et les sessions ne sont pas inclus dans l’e-mail.
- [x] Tests unitaires et d’intégration ajoutés pour templates, échappement HTML, configuration provider, API Resend simulée, rollback de l’outbox, déduplication, compétition de workers, succès, retry, échec permanent, protection cron et expurgation de l’audit.
- [x] `npm test` depuis `backend`, contre MySQL local et le schéma isolé `misericorde_divine_test` : **125 tests réussis, 0 échec**.
- [ ] Recette staging réelle : vérifier le domaine Resend, SPF/DKIM/DMARC, From/Reply-To, le quota, la délivrabilité et la fréquence Cron Vercel avant de passer `EMAIL_PROVIDER` à `resend`.
- [ ] Étendre les fixtures aux règles restantes d’anomalie et tester l’import partiel, les fichiers malformés/volumineux, les webhooks de livraison et la rétention/purge outbox avant leurs mises en production respectives.

### Résultat d’implémentation et de test des Sprints 11 et 12 — 25 octobre 2026

- [x] Sprint 11 : rôles `admin`/`gestionnaire`, CRUD admin `/api/admin/users*`, audit, protection du dernier admin actif et révocation des sessions à la désactivation.
- [x] Sprint 11 : reset du mot de passe avec réponse neutre, limite persistante par IP/adresse, token SHA-256 à usage unique et 48 heures, contenu chiffré AES-GCM en outbox ; page de demande et page de confirmation frontend ajoutées.
- [x] Sprint 11 : ajustement admin uniquement avec motif, référence justificative optionnelle, mouvement comptable immuable et audit dans la même transaction ; refus d’un solde négatif et rollback testés. Ajout des interfaces admin utilisateurs et ajustement sur la page Comptes.
- [x] Sprint 12 : fonction HTTP catch-all sous `backend/api`, cron Vercel configuré quotidiennement, réécriture SPA frontend et validation fail-fast des variables Production.
- [x] `npm test` depuis `backend`, base MySQL locale et schéma isolé `misericorde_divine_test` : **129 tests réussis, 0 échec**.
- [x] `npm run build` frontend : compilation réussie après ajout des pages de reset et d’administration.
- [ ] Recette déploiement : déployer d’abord une Preview avec base Aiven de staging, certificat CA, store Blob privé, cookies/CORS et variables dédiées ; vérifier `/api/sante`, connexion, réinitialisation e-mail, CRUD admin, ajustement, pièces jointes, restauration et journaux.
- [ ] La configuration Vercel Cron dans `backend/vercel.json` utilise une exécution quotidienne compatible Hobby. Un délai maximal d’une journée est possible pour les e-mails ; valider une fréquence supérieure avec le plan Vercel retenu avant de dépendre d’un reset rapide.
- [ ] Vérifier sauvegarde/restauration Aiven et Blob, alertes/observabilité, séparation Preview/Production et procédure de rollback avant toute promotion Production.

### Documentation interactive de l’API

- [x] Le contrat OpenAPI 3.0 est exposé publiquement sur `GET /api/openapi.json` ; il décrit les routes backend, l’authentification par cookie, le secret Bearer du cron et la clé `Idempotency-Key`.
- [x] Swagger UI est disponible sur `/api/docs/`. Les opérations de gestion y indiquent explicitement les droits administrateur requis ; le serveur continue d’appliquer les autorisations réelles.
- [x] Test d’infrastructure ajouté pour vérifier l’accès anonyme au document OpenAPI et à Swagger UI ainsi que la présence des routes sensibles dans le contrat.
- [ ] Maintenir `backend/src/openapi.js` à jour à chaque ajout, retrait ou modification d’une route ou de son schéma de requête/réponse.

## 13. Plan de réalisation frontend associé aux fonctionnalités backend

Cette section complète les checklists backend des sections 4, 9 et 10. Le backend expose déjà une grande partie des contrats listés ci-dessous ; une route backend « terminée » ne clôt pas la fonctionnalité tant que le parcours frontend correspondant ne l’appelle pas, ne présente pas son résultat et ne traite pas ses erreurs. La revue porte sur `src/api`, `src/auth`, `src/app/routes.tsx`, `src/config/navigation.ts` et `src/pages`.

### 13.1 Règle de développement conjoint — tranche verticale

Pour chaque fonctionnalité, développer et livrer dans le même sprint les éléments suivants :

1. **Contrat partagé :** confirmer le chemin, méthode, rôles, DTO de requête/réponse, filtres, pagination et erreurs dans `backend/src/openapi.js` ; créer ou mettre à jour les types TypeScript associés.
2. **Backend :** route, validation, service métier, autorisation, transaction/audit/idempotence selon le cas, et tests API/MySQL isolés.
3. **Frontend :** méthode typée dans `src/api`, formulaire ou vue, états chargement/vide/succès/erreur, rôle/navigation, actualisation des données après écriture.
4. **Recette commune :** tester dans un navigateur connecté à l’API locale, vérifier au moins un cas valide, un cas invalide, un cas sans droit et une erreur réseau ; capturer endpoint et résultat dans la checklist de la fonctionnalité.

Ne pas créer une route sans consommateur frontend prévu ni un écran qui simule une écriture locale alors qu’une méthode backend existe. Les règles d’autorisation d’interface améliorent l’usage, mais le backend demeure la source d’autorité et doit refuser l’appel interdit.

### 13.2 Fonctions transversales à construire en parallèle front/back

| Fonction transversale | Backend / méthodes et contrat | Frontend / méthodes à créer ou compléter | Critères de recette conjoints |
| --- | --- | --- | --- |
| Client HTTP et contrats typés | Enveloppe `{ success, data, meta? }`, enveloppe d’erreur, `attachRequestId`, `errorHandler`, routes OpenAPI | Garder `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `apiUpload`, `apiDownload` dans `src/api/httpClient.ts`; ajouter types par ressource et éviter `Record<string, unknown>` pour les formulaires/DTO métier | Chaque route utilisée a un type de réponse et de payload ; code/message/champs/requestId s’affichent sans masquer les erreurs de validation |
| Session et autorisation | `authenticate`, `requireActiveAccount`, `requireAdmin`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Consolider `AuthProvider`, garde de routes privées, redirection login, affichage du rôle, fermeture de session et état de chargement global | Rechargement conserve la session ; cookie absent/expiré renvoie vers connexion ; un gestionnaire ne voit pas les actions admin et reçoit malgré tout un refus serveur s’il force l’appel |
| Gestion globale des erreurs | Réponses normalisées et request ID pour erreurs HTTP | Intercepteur Axios dans `httpClient.ts`, composant/message commun, association des erreurs `fields` aux champs, écran 401/403/404/500 et action réessayer pour erreur réseau | Tester 401, 403, 404, 409, 413, 422, 429, 500, timeout et absence réseau ; afficher le requestId pour faciliter le support |
| Validation formulaire / règles métier | Schémas Zod des services (membre, compte, opération, paramètres, utilisateurs, reset, ajustement) | Valider format et champs requis côté UI pour guider l’utilisateur, convertir correctement nombres, dates, valeurs vides et `null`; afficher les erreurs serveur par champ | Le contrôle navigateur n’est jamais la seule barrière : les payloads invalides envoyés directement sont refusés par le backend avec un message exploitable |
| Idempotence et reprise d’envoi | Middleware `idempotent`, stockage de l’empreinte et rejeu du résultat sur endpoints compatibles | Dans `apiPost`, conserver la clé d’une intention après une erreur réseau/5xx, ne pas réutiliser une clé si payload/route change ; ne proposer un retry automatique qu’avec la même clé | Double clic, réponse perdue après écriture et retry ne doublent pas l’opération ; erreurs 4xx corrigées repartent avec une nouvelle intention |
| Listes, filtres et pagination | `parsePagination`, filtres serveur, métadonnées `meta`, endpoints de liste | Méthode réutilisable `listResource` ou hooks par domaine ; synchroniser recherche/tri/page/taille avec paramètres API, annuler les requêtes obsolètes, conserver les filtres lors du détail | Total et page affichés viennent du serveur ; navigation entre pages et filtres ne réutilise pas accidentellement les données de la requête précédente |
| Monnaie, dates et périodes | Validation décimale, dates inclusives, filtres temporels et calculs côté service | Fonctions de présentation centralisées (FCFA, date locale, période), conserver la précision d’entrée sans calcul métier, envoyer nombres/dates dans le format API attendu | Valeurs décimales, minuit/fuseau, date début/fin et période inclusive cohérentes entre saisie, liste, détail et export |
| Téléversement et téléchargement | `handleFileUpload`, `handleImportUpload`, services d’attachement/import, réponses binaires | Helpers `apiUpload`/`apiDownload`, progression/nom/taille/type affichés, reset du champ, message pour 413/415, téléchargement Blob et révocation URL | Tester fichier accepté/refusé, upload interrompu, fichier trop lourd, téléchargement authentifié et nom de fichier sûr |
| Journalisation et visibilité des mutations | Audit backend des opérations financières, paramètres, anomalies et administration ; aucun secret dans les logs | Indiquer l’auteur/date si le DTO le permet, demander confirmation pour annulation/suppression/ajustement, empêcher les doubles soumissions et rafraîchir le détail après succès | L’utilisateur comprend la conséquence avant une mutation sensible ; audit enregistré côté serveur ; aucun mot de passe, cookie ou token dans le navigateur/logs |
| E-mails transactionnels | `enqueueNotification`, templates, `retryFailedNotifications`, préférences, `listNotificationOutbox`, `retryDeadNotification`, `GET /api/cron/notifications`; l’API web ne fournit pas un envoi arbitraire | Afficher confirmation neutre pour reset/changement du mot de passe ; ajouter le choix des futurs e-mails optionnels et l’écran admin de supervision/relance ; aucune clé Resend dans Vite | Une action UI déclenche le bon événement métier en outbox ; seules les admins accèdent à la supervision ; le cron seul livre ; l’interface ne prétend pas garantir la livraison si le fournisseur est en échec |
| Paramétrage d’environnement | `VITE_API_BASE_URL`, CORS, cookie sécurisé, validations Production | Vérifier `httpClient.baseURL`, credentials et configuration Preview/Production ; ne jamais exposer les secrets backend dans les variables `VITE_*` | Front Vercel pointe sur le bon backend ; CORS/cookie testés sur origines Preview et Production réelles |

### 13.3 Fonctionnalités métier : écrans, appels API et recette frontend

| Module / état observé | Écrans et comportement frontend à réaliser ou compléter | Appels backend à consommer | Critère frontend d’acceptation |
| --- | --- | --- | --- |
| Connexion et session — connexion, reset et provider existent | Compléter les gardes de routes et les retours visuels de session expirée ; intégrer proprement changement de mot de passe et erreurs de champs | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `PUT /api/auth/password`, `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm` | Login, rechargement, logout, changement de mot de passe et reset par lien fonctionnent depuis le navigateur ; retour de reset reste neutre sur l’existence du compte |
| Membres — CRUD générique et panneau détail existent | Remplacer les formulaires/colonnes génériques par une fiche membre explicite ; filtres statut/archive, détails financiers et historique navigable ; afficher les validations par champ | `GET/POST /api/membres`, `GET/PUT /api/membres/:id`, `PATCH /api/membres/:id/statut`, `GET /api/membres/:id/operations`, `/synthese-financiere`, `/cotisations` | Création/modification/archivage, recherche/pagination et navigation vers opérations/cotisations utilisent les DTO du backend ; archive conservée et indiquée clairement |
| Cotisations, recettes, dons, dépenses — page de ressource générique appelle déjà les endpoints | Construire un formulaire et un détail propres à chaque type ; filtres dates/membre/compte/rubrique/statut, édition contrôlée et confirmation d’annulation ; afficher référence calculée par le serveur | `GET/POST /api/{cotisations,recettes,dons,depenses}`, `GET/PUT /api/:type/:id`, `POST /api/:type/:id/annulation`, plus `/api/operations/:type/:id/justificatifs` | Un succès rafraîchit liste et solde ; erreur métier s’affiche ; annulation exige un motif et son résultat ne peut pas être soumis deux fois |
| Rubriques — écran spécialisé existe | Terminer les formulaires par famille, nature spécifique aux dons, recherche, état actif/inactif et prévention de désactivation utilisée | `GET/POST /api/rubriques/:type`, `GET/PUT /api/rubriques/:type/:id`, `PATCH /api/rubriques/:type/:id/statut` | Les quatre familles se chargent ; les messages de conflit/référence utilisée apparaissent sans effacer les opérations historiques |
| Comptes et trésorerie — détails et ajustement admin existent | Ajouter une vue mouvements/solde à date, filtres et synthèse caisse/banque ; rendre l’ajustement visible uniquement aux admins, confirmer sens/montant/motif et actualiser soldes après écriture | `GET/POST /api/comptes`, `GET/PUT /api/comptes/:id`, `PATCH /api/comptes/:id/statut`, `GET /api/comptes/:id/solde`, `/mouvements`, `POST /api/comptes/:id/ajustements`, `GET /api/tresorerie/synthese` | Le gestionnaire ne voit pas l’ajustement ; admin choisit un compte actif et saisit motif/date/sens ; solde et mouvements concordent après ajustement ou refus de découvert |
| Contribution diocésaine — panneau d’opérations existe | Ajouter un flux guidé : période → prévisualisation calcul → confirmation de génération, correction du compte/montant/date/libellé avec confirmation, vue des règles/taux configurés, détail lié et annulation motivée ; distinguer versement manuel du calcul/génération | `GET/POST /api/contribution-diocesaine`, `/synthese`, `POST /calcul`, `POST /generation`, `GET/PUT /:id`, `GET /:id/operations`, `POST /:id/annulation`, `GET /api/parametres` | Le montant aperçu vient du serveur ; la période calculée demeure en lecture seule lors d’une correction ; les mouvements de correction sont append-only ; cas sans taux/assiette montre une explication et ne propose pas un montant local calculé |
| Justificatifs — liste/actions existent, parcours d’ajout à finaliser | Ajouter sélection fichier, métadonnées, prévisualisation/nom, liste par opération, liaison, suppression confirmée et états de téléchargement ; proposer l’ajout directement depuis le formulaire d’opération | `GET/POST /api/justificatifs`, `GET /:id`, `GET /:id/telechargement`, `POST /:id/liaison`, `DELETE /:id`, `GET /api/operations/:type/:id/justificatifs` | Fichier lié à la bonne opération, erreurs MIME/taille affichées, et les pièces s’actualisent dans son détail après upload/liaison/suppression |
| Recherche globale — endpoint existant, panneau fonctionnel à vérifier | Créer une page de résultats avec champ de recherche, choix de catégories `categoriesDisponibles`, pagination, état sans résultat et liens vers fiches/opérations/justificatifs | `GET /api/recherche?q=…&categories=…` | Chaque résultat ouvre la ressource correspondante, la catégorie est validée, et requêtes lentes/obsolètes ne remplacent pas le résultat le plus récent |
| Rapports — commandes de consultation/export déjà présentes | Remplacer affichage JSON par tableaux/cartes de rapport, filtres période, choix format, bouton téléchargement, indication des filtres appliqués et erreur de génération | `GET /api/rapports`, `GET /api/rapports/:type`, `GET /api/rapports/:type/export?format=csv|xlsx|pdf` | Le frontend affiche le rapport sélectionné et télécharge un nom de fichier/format correct ; totaux et période sont les données renvoyées par le backend |
| Échanges CSV/XLSX — upload/export à terminer en UX | Liste des ressources importables, télécharger modèle, sélectionner fichier, choix simulation/partiel, prévisualiser lignes/erreurs, confirmer l’application et montrer le résultat par ligne | `GET /api/echanges`, `GET /:resource/modele`, `GET /:resource/export`, `POST /:resource/import?simulation=…&partiel=…` | Aucun envoi de mutation avant confirmation après simulation ; simulation n’écrit rien ; erreurs identifient les lignes et mode tout-ou-rien/partiel est explicite |
| Anomalies — lecture et actions génériques existent | Présenter gravité, règle, date, entité liée, historique, statut et commentaire ; confirmation de résolution et filtre statut/gravité ; faciliter le lien vers l’écriture source | `GET /api/anomalies`, `/regles`, `POST /analyse`, `GET /:id`, `PATCH /:id/statut`, `POST /:id/resolution` | Analyse affiche le bilan et empêche les lancements concurrents ; statut/résolution rafraîchissent détail et historique ; règles sont décrites sans les réinventer |
| Paramètres et préférences — formulaires existent | Appliquer vraiment thème, masquage des montants et taille de page à toute l’application ; ajouter une préférence e-mail « événements optionnels » en expliquant que les alertes de sécurité restent obligatoires ; état partagé au démarrage et persistance par utilisateur | `GET /api/parametres`, `PUT /api/parametres/generaux`, `GET/PUT /api/parametres/preferences`, `GET/PUT /api/notifications/preferences`, `PUT /api/auth/password` | Après rechargement, préférences sont appliquées ; les deux événements obligatoires sont présentés comme non désactivables ; le masquage couvre tableaux, cartes, dashboard ; taux non configuré reste `null` |
| Aide — pages génériques existent | Présenter le catalogue de sections et articles lisibles, liens vers les écrans concernés, états slug inconnu | `GET /api/aide`, `GET /api/aide/:slug` | Chaque entrée de catalogue ouvre son article et une entrée inconnue affiche une page 404 propre |
| Administration utilisateurs — écran admin existe | Ajouter détail utilisateur, pagination/recherche si nécessaire, validation métier (dernier admin, soi-même), confirmation de désactivation et retours d’audit/statut ; ne pas remettre le mot de passe en clair après création | `GET/POST /api/admin/users`, `GET/PUT /api/admin/users/:id`, `PATCH /api/admin/users/:id/statut` | Routes protégées par le backend ; interface redirige les non-admins ; les erreurs dernier admin/désactivation sont compréhensibles |
| Notifications e-mail — livraison backend présente | Montrer le résultat applicatif des actions déclenchant un e-mail et ajouter dans Paramètres le choix des futurs e-mails optionnels ; ajouter pour les admins une page de supervision/relance de l’outbox | `GET/PUT /api/notifications/preferences`, `GET /api/admin/notifications/outbox?status&page&limit`, `POST /api/admin/notifications/outbox/:id/retry`; pas d’envoi frontend. Worker `GET /api/cron/notifications` réservé à `CRON_SECRET` | Aucune clé provider/Cron n’est livrée au navigateur ; reset neutre ; seuls les admins voient la file et les adresses sont déjà masquées ; relance seulement si `dead`; e-mail réel vérifié en staging |
| Documentation API — Swagger est disponible | Ajouter un lien « Documentation API » visible seulement aux rôles/outils concernés ou un lien développeur hors navigation métier ; ne jamais exposer les secrets d’environnement | `GET /api/docs/`, `GET /api/openapi.json` | L’interface s’ouvre sur l’environnement courant ; les endpoints protégés restent protégés et l’OpenAPI reflète les routes effectives |

### 13.4 Ordre des lots frontend/backend à partir de maintenant

| Ordre | Lot vertical | Backend à maintenir/tester | Frontend à coder/compléter dans le même lot | Sortie du lot |
| ---: | --- | --- | --- | --- |
| 1 | Contrats transversaux et robustesse client | OpenAPI/DTO, erreurs/requestId, sécurité session/CORS, idempotence | Types communs, client Axios typé, erreurs globales, auth guards, états communs de formulaire/liste | Parcours auth et une mutation protégée passent ensemble ; test de non-session, 422 et erreur réseau |
| 2 | Référentiels et fiches | Membres, rubriques, comptes, filtres, statut | Pages spécialisées list/detail/edit, formulaires, filtres et liens entre entités | CRUD complet sur base de test et validation d’erreur affichée dans UI |
| 3 | Écritures et consultation de trésorerie | Opérations, mouvements, annulation, idempotence et invariants | Formulaires de cotisation/recette/don/dépense, historique, annulation confirmée, synthèse et mouvements | Pas de double écriture ; solde UI reflète celui calculé par API |
| 4 | Diocèse et pièces jointes | Calcul/génération, transaction, stockage Blob, upload/download | Prévisualisation de calcul, confirmation, liaison justificatifs depuis une opération, détail complet | Génération et pièces jointes testées depuis navigateur local puis staging |
| 5 | Analyses et échanges | Recherche, rapports, imports/exports, anomalies | Résultats navigables, graphiques/tableaux, téléchargement, simulation et résolution | Simulation sans mutation et exports réellement ouvrables depuis le navigateur |
| 6 | Utilisateurs, sécurité et e-mail | Rôles, reset, ajustements, outbox/cron et audits | Admin users, ajustement admin, parcours reset/changement mot de passe et messages e-mail neutres | Gestionnaire/admin vérifiés chacun ; e-mail sandbox contrôlé sur staging |
| 7 | Préférences, aide et recette complète | Préférences/settings, routes d’aide et disponibilité | Thème, masquage, pagination globale, centre d’aide, recette de tous les modules | Build frontend, tests API et scénarios navigateur consignés ; pas de module visible sans recette |

### 13.5 Checklist de suivi frontend

- [ ] Créer une liste des DTO TypeScript par domaine et l’aligner sur `backend/src/openapi.js`.
- [ ] Remplacer progressivement les `Record<string, unknown>`/affichages JSON des pages génériques par des composants métier typés.
- [ ] Pour chaque ligne de la matrice 13.3, inscrire le statut `existant`, `à compléter` ou `à développer`, un responsable, les tests frontend/API et la date de recette.
- [ ] Exécuter le parcours intégral de chaque module avec session réelle de test et documenter les endpoints/erreurs observés.
- [ ] Confirmer que dashboard, paramètres, préférences, listes et détails n’affichent pas de données de démonstration lorsqu’une réponse API échoue.
- [ ] Vérifier les vues responsive et l’accessibilité clavier/labels pour formulaires, dialogues de confirmation, messages d’erreur et tableaux.
- [ ] Mettre à jour ce guide dans le même changement que tout endpoint backend ou parcours frontend nouvellement ajouté.

### Résultat d’audit et d’implémentation des méthodes backend absentes — 25 octobre 2026

- [x] Comparaison des cases backend ouvertes du guide avec les routeurs, services et tests ; les éléments encore ouverts liés à Aiven/Vercel, délivrabilité, sauvegarde, recette métier et scénarios frontend restent des validations externes ou de recette, pas des méthodes backend manquantes.
- [x] Ajout de `diocesanUpdateSchema` et `updateDiocesanContribution` avec `PUT /api/contribution-diocesaine/:id`. Seuls compte, montant, date d’opération et libellé sont corrigibles ; période et paramètres du calcul restent immuables. Les écritures antérieures sont conservées, avec contre-écriture et nouvel enregistrement dans une transaction auditée.
- [x] Ajout de `listNotificationOutbox` et `retryDeadNotification`, exposés en admin sur `GET /api/admin/notifications/outbox` et `POST /api/admin/notifications/outbox/:id/retry`. Le listing masque le destinataire et omet payload/token/clé ; la relance n’accepte que `dead`, est auditée, plafonnée et crée une nouvelle clé d’idempotence fournisseur.
- [x] Ajout de la migration `007_notification_outbox_admin_retry.sql` pour compter les relances manuelles.
- [x] Ajout de `getNotificationPreferences`, `updateNotificationPreferences` et `notificationPreferencesSchema`, exposés sur `GET/PUT /api/notifications/preferences`. La préférence est individuelle et auditée ; `PASSWORD_CHANGED` et `PASSWORD_RESET` restent obligatoires. Aucun événement optionnel n’étant encore défini, la préférence ne filtre pas d’e-mail actuellement disponible.
- [x] Mise à jour du contrat OpenAPI et de la matrice front/back pour les nouvelles routes, écrans et critères de recette.
- [x] Tests ciblés admin, diocèse et notifications : **15 réussis, 0 échec**.
- [x] `npm test` depuis `backend`, schéma MySQL local dédié `misericorde_divine_test` : **133 tests réussis, 0 échec**.
- [ ] Développer/recetter côté frontend l’édition contrôlée diocésaine, les préférences e-mail et l’écran admin d’outbox selon la matrice 13.3.
- [ ] Définir des événements non obligatoires avant de donner un effet de filtrage à la préférence e-mail ; préserver les deux messages obligatoires.

### Livraison frontend du parcours 13.3 — 25 octobre 2026

Les pages ci-dessous consomment les routes backend répertoriées dans la matrice 13.3. Plusieurs domaines utilisent encore `ResourcePage` comme écran partagé ; les actions affichées restent spécifiques au type de ressource et la validation finale visuelle est à faire sous session de chaque rôle.

| Ordre 13.3 | État livré | Intégration/recette vérifiée |
| --- | --- | --- |
| Connexion et session | Garde session globale, login/logout, récupération et confirmation du reset, changement de mot de passe dans Paramètres. | Contrats API exercés par la suite backend ; le parcours navigateur avec compte réel reste à recetter. |
| Membres | Création, recherche/pagination, modification, statut/archivage ; fiche agrégée avec opérations, cotisations et synthèse via les endpoints dédiés ; ouverture directe par `?selection=id` depuis la recherche. | API CRUD, unicité, archivage et synthèse vérifiés dans les tests backend. |
| Cotisations, recettes, dons, dépenses | Formulaires de création par ressource, lookups rubrique/compte/membre, filtres période/statut/compte/membre/rubrique, détail, édition, annulation avec motif, justificatifs du détail. | Mutations, idempotence, solde, annulation et justificatifs vérifiés dans la suite backend. |
| Rubriques | Écran spécialisé conservé pour les quatre familles, formulaires adaptés, nature des dons, recherche, édition et activation/désactivation. | CRUD et protection de l’historique vérifiés dans la suite backend. |
| Comptes et trésorerie | Fiche compte, solde à date et mouvements ; synthèse trésorerie ; panneau d’ajustement accessible à l’admin seulement. | Routes d’accès par rôle, ajustement et invariants financiers vérifiés dans la suite backend. |
| Contribution diocésaine | Calcul de prévisualisation avant confirmation de génération ; versement manuel ; détail, opérations liées, justificatifs, correction contrôlée avec compte/montant/date/libellé, annulation motivée ; période non modifiable à la correction. | Création/calcul/génération/correction/annulation validés par les tests backend. |
| Justificatifs | Téléversement avec type/métadonnées et rattachement optionnel, fiche, téléchargement authentifié, liaison aux cinq types acceptés, suppression confirmée et rafraîchissement après action. | Formats/refus, stockage, liens et suppression vérifiés dans les tests backend. |
| Recherche globale | Page de résultats dédiée : catégories, période, pagination, recherche différée et protection contre les réponses obsolètes ; lien vers la fiche source par identifiant. | Routes et catégories/pagination vérifiées côté backend ; parcours navigateur authentifié restant à recetter. |
| Rapports | Sélection du rapport, période, rendu en tableau/totaux, téléchargement CSV/XLSX/PDF ; les valeurs monétaires respectent le masquage utilisateur. | Les rapports et exports des trois formats sont vérifiés dans la suite backend. |
| Échanges Excel/CSV | Export et modèle ; import en deux étapes : simulation d’abord, puis nouvelle sélection du même fichier et confirmation explicite ; un changement de ressource, mode partiel ou empreinte invalide le précontrôle. | L’import simulation puis application et la persistance sont couverts dans les tests backend. |
| Anomalies | Lancement des contrôles, consultation des règles, affichage du détail et actions de statut/résolution avec commentaire. | Analyse et résolution vérifiées par les tests backend. |
| Paramètres et préférences | Paramètres métier et affichage ; application du thème, masquage des montants et taille de page ; préférences e-mail persistées, alertes de sécurité présentées comme obligatoires. | Persistance des préférences et politique des avis obligatoires vérifiées par la suite backend. |
| Aide | Catalogue chargé depuis l’API et article rendu comme contenu lisible. | Catalogue et article vérifiés par les tests backend. |
| Administration utilisateurs | Écran réservé admin, création, édition du rôle et confirmation avant activation/désactivation. | Refus gestionnaire, dernier admin et mutations admin testés côté backend. |
| Notifications e-mail | Préférences dans Paramètres ; page admin de file, filtre/statut/pagination et relance seulement pour les messages `dead`; aucune donnée privée de payload n’est affichée. | Contrôle de rôle, masquage, sécurité, relance auditée testés côté backend. |
| Documentation API | Lien Swagger disponible dans Paramètres, ouvrant `/api/docs/` sur l’API configurée. | Swagger/OpenAPI et préfixe `/api` validés dans les tests backend. |

**Recette exécutée :** `npm run build` à la racine frontend réussit ; `npm test` depuis `backend` réussit avec **133 tests, 29 suites, 0 échec**. La page locale a été ouverte : la garde redirige vers Connexion sans session. Les actions métier nécessitant un compte connecté n’ont pas été soumises dans le navigateur pendant cette recette ; il reste à les parcourir sur les comptes admin et gestionnaire de test, puis à vérifier les vues responsive/clavier.

### Diagnostic et correction du tableau de bord local — 25 octobre 2026

- [x] Cause principale du tableau entièrement vide : la base MySQL locale ne disposait que de la migration `001_init.sql`, alors que les routes protégées et le middleware d’authentification attendent le schéma des migrations suivantes (dont le rôle utilisateur). Les requêtes authentifiées échouaient donc avant d’atteindre l’écran. Les migrations `001` à `007` ont été appliquées sur la base de développement locale `misericorde_divine` (`127.0.0.1`), puis le compte admin local a été confirmé actif avec le rôle `admin`.
- [x] Cause secondaire de l’écran silencieusement vide : le frontend acceptait `response.data.data` sans valider sa forme, tandis que `DashboardPage` n’affichait aucun état de remplacement si la synthèse était absente. `dashboardApi` valide désormais l’enveloppe, les totaux numériques et les tableaux attendus, et retourne une erreur de contrat explicite ; la page affiche un état d’erreur avec action Réessayer au lieu de laisser une zone blanche.
- [x] Disponibilité du backend vérifiée par `GET http://localhost:4000/api/sante` : API et base répondent `ok`. Le service de synthèse fournit la forme complète consommée par le dashboard, avec totaux numériques, six points d’évolution, trois catégories de recettes et les dépenses récentes.
- [x] Vérification des données réelles locales : aucun membre ni mouvement financier n’existe encore ; les comptes, cotisations, recettes, dons, dépenses et contributions diocésaines sont à zéro. Un compte financier est configuré. Les tuiles à zéro et listes vides sont donc le résultat correct jusqu’à la saisie d’opérations réelles ; aucun jeu de démonstration n’a été ajouté.
- [x] Contrôle Gestion : membres, rubriques, CRUD, statuts, historique et validation des opérations sont couverts par les routes et tests d’intégration backend. Contrôle Trésorerie : comptes, mouvements, solde à date, synthèse caisse/banque, ajustements, annulations, invariants de solde, idempotence et concurrence sont testés. Contrôle Analyse : dashboard, rapports et exports, recherche, échanges CSV/XLSX et anomalies sont testés. Les écritures sont transactionnelles et la persistance/relecture après redémarrage est couverte par le scénario dédié.
- [x] Vérification frontend : `npm run build` réussit après ajout de la validation de réponse et de l’état d’erreur du dashboard. Vite signale seulement deux avertissements préexistants de compatibilité dans `vite.config.ts` (`__dirname` et import JSON sans attribut) ; ils ne bloquent pas la compilation.
- [x] Tests d’intégration backend sur la base MySQL isolée `misericorde_divine_test` : `npm test` donne **133 réussis, 0 échec, 29 suites**. Cette suite exerce les endpoints HTTP avec persistance, droits, erreurs et transactions. Elle ne crée ni ne modifie les données de la base métier locale.
- [ ] Recette navigateur authentifiée à faire sur les rôles admin et gestionnaire après connexion, avec au moins une opération métier réelle de test, puis contrôle responsive et clavier. La page non authentifiée redirige vers Connexion ; la recette navigateur précédente ne soumettait pas les parcours métier.
