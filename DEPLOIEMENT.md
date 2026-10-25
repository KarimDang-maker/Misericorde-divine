# Déploiement : Vercel, Aiven et Vite

Ce document décrit le déploiement du frontend React/Vite et du backend Express sur deux projets Vercel distincts, avec MySQL hébergé chez Aiven. Les fichiers `.env.production` du dépôt sont des modèles uniquement : ils ne contiennent aucun secret et ne sont pas automatiquement lus par Vercel.

## 1. Préparer MySQL sur Aiven

1. Créer un service MySQL et une base dédiée à l’application.
2. Depuis la console Aiven, relever l’hôte, le port, le nom de base, l’utilisateur et le mot de passe.
3. Télécharger le certificat CA TLS depuis Aiven. Ne pas le committer dans le dépôt.
4. Vérifier que le service Aiven accepte les connexions entrantes depuis Vercel. Si une liste d’IP autorisées est utilisée, prévoir les plages de sortie adaptées à l’offre Vercel choisie ou une solution réseau fixe ; ne pas laisser l’accès public ouvert sans restriction sans avoir évalué ce choix.

## 2. Configurer le projet Vercel du backend

Importer le dépôt dans Vercel et définir `backend` comme **Root Directory**. Le projet utilise `backend/package.json`; `backend/api/[...path].js` expose l'application Express comme fonction HTTP Vercel. `npm start` reste réservé au serveur local.

Ajouter ces variables dans **Project Settings → Environment Variables**, pour Production et, si nécessaire, Preview :

| Variable | Valeur |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_HOST` | Hôte MySQL fourni par Aiven |
| `DB_PORT` | Port MySQL fourni par Aiven |
| `DB_NAME` | Nom de la base Aiven |
| `DB_USER` | Utilisateur applicatif Aiven |
| `DB_PASSWORD` | Mot de passe applicatif Aiven |
| `DB_SSL` | `true` |
| `DB_SSL_CA` | Contenu complet du certificat CA fourni par Aiven (multiligne accepté ; validation du certificat activée) |
| `ALLOWED_ORIGINS` | Origine exacte du frontend, par exemple `https://mon-frontend.vercel.app` |
| `SESSION_COOKIE_NAME` | `md_session` |
| `SESSION_DURATION_HOURS` | `8` |
| `SESSION_COOKIE_SECURE` | `true` |
| `SESSION_COOKIE_SAME_SITE` | `none` pour deux domaines Vercel distincts ; `lax` si frontend et API sont sur le même site |
| `TRUST_PROXY` | `1` derrière Vercel, afin que l’IP client transmise par le proxy soit prise en compte |
| `UPLOAD_STORAGE` | `vercel-blob` en Production ; créez un store Blob **privé** dans le projet backend |
| `BLOB_READ_WRITE_TOKEN` | Token fourni par le store Vercel Blob privé, enregistré dans les variables Vercel du backend uniquement |
| `UPLOAD_MAX_MB` | `4` : l’upload transite par la fonction Vercel, dont la limite de corps de requête est 4,5 MB |
| `EMAIL_PROVIDER` | `disabled` par défaut ; passer à `resend` seulement après validation du domaine d’envoi |
| `EMAIL_API_KEY` | Secret API Resend, uniquement dans les variables du projet backend Vercel |
| `EMAIL_FROM` | Expéditeur sur un domaine vérifié chez Resend |
| `EMAIL_REPLY_TO` | Adresse de réponse supervisée |
| `EMAIL_BATCH_LIMIT` | `3` par invocation cron (maximum applicatif : 5) |
| `CRON_SECRET` | Secret aléatoire d’au moins 32 caractères, dans Vercel uniquement |
| `FRONTEND_URL` | Origine HTTPS du frontend utilisée dans le lien de réinitialisation |
| `PASSWORD_RESET_ENCRYPTION_KEY` | Clé AES-256 encodée en base64 (32 octets), générée et stockée uniquement dans Vercel |
| `SEED_ADMIN_EMAIL` | Adresse de l’administrateur initial |
| `SEED_ADMIN_NAME` | Nom de l’administrateur initial |
| `SEED_ADMIN_PASSWORD` | Mot de passe initial fort et unique |

Ne définissez pas `DB_ROOT_PASSWORD` ni `DB_ROOT_USER` comme identifiants d’exploitation. Avant la mise en ligne, exécutez `npm run migrate` depuis `backend` avec un compte autorisé à modifier le schéma, puis `npm run seed` si la base est neuve. `npm start` et la fonction Vercel ne lancent pas de migration. Le script `npm run sessions:revoke-expired` est prévu pour une tâche planifiée séparée ; aucun timer permanent n’est démarré dans les requêtes serverless.

Les justificatifs utilisent un store Vercel Blob privé en Production. Les fichiers sont servis par l’API authentifiée, qui vérifie la session avant d’appeler le SDK Blob ; ne rendez pas le store public. La fonction reçoit le multipart avant son transfert vers Blob, donc la limite configurée est de 4 MB. Un upload privé exécuté dans Vercel Preview/Production doit être validé après création du store et configuration du token.

### Notifications par e-mail

Le backend ajoute une outbox MySQL et envoie un avis de sécurité après chaque changement de mot de passe. La réinitialisation de mot de passe ajoute un token à usage unique, conservé sous forme de hash en base et chiffré dans l'outbox. Configurez `FRONTEND_URL` et `PASSWORD_RESET_ENCRYPTION_KEY` ainsi que `EMAIL_PROVIDER=resend`, la clé API et un expéditeur appartenant à un domaine vérifié avant d’autoriser l’envoi. Laissez `EMAIL_PROVIDER=disabled` tant que le domaine, le Reply-To et la boîte de réception de test ne sont pas validés. Preview doit utiliser un compte/domaine de sandbox et des destinataires contrôlés.

L’endpoint cron est `GET /api/cron/notifications`, protégé par `Authorization: Bearer <CRON_SECRET>`. `backend/vercel.json` le planifie chaque jour à 09:00 UTC. Vercel ajoute automatiquement l’en-tête Bearer depuis la variable `CRON_SECRET`. La fréquence quotidienne est compatible avec le plan Hobby ; les tâches Cron Vercel s’exécutent seulement sur le déploiement Production. Pour exercer l’outbox en Preview, invoquez cette route manuellement avec le secret Preview ou lancez `npm run notifications:process` avec les variables Preview. Augmentez la fréquence de Production seulement si le plan Vercel le permet et si le délai de livraison le justifie. Le worker traite au plus cinq messages par invocation et ne démarre aucun timer dans Express.

Les retries peuvent rejouer un appel lorsque le fournisseur a accepté le message mais que le worker s’est arrêté avant l’écriture SQL. Le provider reçoit donc une clé d’idempotence stable dérivée de l’identifiant outbox. Une livraison exactement une fois n’est pas garantie entre MySQL et le service e-mail.

### Vérifications à effectuer avant la mise en production

- `backend/src/config/database.js` applique TLS vérifié lorsque `DB_SSL=true`; fournir le certificat CA Aiven dans `DB_SSL_CA` et vérifier `GET /api/sante` après déploiement.
- `backend/src/index.js` exporte l'application sans lancer de serveur, et `backend/api/[...path].js` l'expose comme fonction HTTP. La fonction ne lance pas de migrations : exécuter `npm run migrate` séparément, une fois par version, avant de basculer le trafic.
- Les justificatifs utilisent un store Vercel Blob privé en Production. Vérifier l'accès depuis la fonction Vercel et la persistance entre invocations ; le stockage local est réservé au développement.
- Tester les cookies avec les domaines Preview/Production réels. Pour des domaines Vercel distincts, le contrat prévu est `SameSite=None; Secure`, avec client navigateur autorisant les credentials et `ALLOWED_ORIGINS` limité aux origines nécessaires.
- Le cron de notifications est défini dans `backend/vercel.json`; les cron Vercel ne s'exécutent qu'en Production. La livraison réelle nécessite `CRON_SECRET`, un provider e-mail configuré et une recette sandbox préalable.

Le point de santé est `/api/sante`. Il doit renvoyer `baseDeDonnees: "ok"` après déploiement. Vercel injecte les variables d’environnement dans les fonctions ; les modifications de variables n’affectent que les nouveaux déploiements.

## 3. Configurer le projet Vercel du frontend

Créer un second projet Vercel depuis le même dépôt et conserver la racine du dépôt comme **Root Directory**. La configuration Vite utilise `npm run build`; le répertoire de sortie est `dist`.

Définir dans Vercel, avant le build de production :

| Variable | Valeur |
| --- | --- |
| `VITE_API_BASE_URL` | URL publique du backend suivie de `/api`, par exemple `https://mon-backend.vercel.app/api` |

Les variables `VITE_*` sont incorporées aux fichiers JavaScript visibles par les utilisateurs. N’y placer aucun mot de passe ni secret. Après ajout ou changement de variable, relancer un déploiement du frontend.

Le fichier racine `vercel.json` réécrit les routes frontend vers `index.html` pour que les URLs SPA, dont le lien de réinitialisation, fonctionnent après un rechargement direct. Le projet backend garde son propre `backend/vercel.json` et sa fonction catch-all.

## 4. Ordre de mise en ligne

1. Créer la base Aiven et enregistrer les secrets backend dans le projet Vercel du backend.
2. Vérifier TLS Aiven, le stockage privé Blob, l’entrée HTTP serverless et le lancement contrôlé des migrations.
3. Déployer le backend et vérifier `https://<backend>/api/sante`.
4. Enregistrer l’origine réelle du frontend dans `ALLOWED_ORIGINS` du backend, sans barre oblique finale.
5. Configurer `VITE_API_BASE_URL` dans le projet frontend, puis déployer le frontend.
6. Vérifier connexion, session/cookies, navigation après rechargement, créations de données et téléversements.

Pour des URL de prévisualisation Vercel, configurer séparément les origines nécessaires pour Preview ; n’autoriser que les domaines de confiance.

## Fichiers de modèles

- Frontend : `.env.production`
- Backend : `backend/.env.production`

Pour la production, saisir les secrets dans les paramètres Vercel appropriés plutôt que de versionner ces fichiers.
