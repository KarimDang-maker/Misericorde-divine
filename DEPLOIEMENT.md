# Déploiement : Vercel, Aiven et Vite

Ce document décrit le déploiement du frontend React/Vite et du backend Express sur deux projets Vercel distincts, avec MySQL hébergé chez Aiven. Les fichiers `.env.production` du dépôt sont des modèles uniquement : ils ne contiennent aucun secret et ne sont pas automatiquement lus par Vercel.

## 1. Préparer MySQL sur Aiven

1. Créer un service MySQL et une base dédiée à l’application.
2. Depuis la console Aiven, relever l’hôte, le port, le nom de base, l’utilisateur et le mot de passe.
3. Télécharger le certificat CA TLS depuis Aiven. Ne pas le committer dans le dépôt.
4. Vérifier que le service Aiven accepte les connexions entrantes depuis Vercel. Si une liste d’IP autorisées est utilisée, prévoir les plages de sortie adaptées à l’offre Vercel choisie ou une solution réseau fixe ; ne pas laisser l’accès public ouvert sans restriction sans avoir évalué ce choix.

## 2. Configurer le projet Vercel du backend

Importer le dépôt dans Vercel et définir `backend` comme **Root Directory**. Le projet utilise `backend/package.json`; le script de démarrage local est `npm start`.

Ajouter ces variables dans **Project Settings → Environment Variables**, pour Production et, si nécessaire, Preview :

| Variable | Valeur |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_HOST` | Hôte MySQL fourni par Aiven |
| `DB_PORT` | Port MySQL fourni par Aiven |
| `DB_NAME` | Nom de la base Aiven |
| `DB_USER` | Utilisateur applicatif Aiven |
| `DB_PASSWORD` | Mot de passe applicatif Aiven |
| `DB_SSL` | `true` (à prendre en charge dans le pool avant déploiement) |
| `DB_SSL_CA` | Certificat CA fourni par Aiven, si le pilote est configuré pour le lire |
| `ALLOWED_ORIGINS` | Origine exacte du frontend, par exemple `https://mon-frontend.vercel.app` |
| `SESSION_COOKIE_NAME` | `md_session` |
| `SESSION_DURATION_HOURS` | `8` |
| `UPLOAD_MAX_MB` | `10` |
| `SEED_ADMIN_EMAIL` | Adresse de l’administrateur initial |
| `SEED_ADMIN_NAME` | Nom de l’administrateur initial |
| `SEED_ADMIN_PASSWORD` | Mot de passe initial fort et unique |

Ne définissez pas `DB_ROOT_PASSWORD` ni `DB_ROOT_USER` comme identifiants d’exploitation. Les migrations et le seed doivent être exécutés explicitement avec un compte autorisé à modifier le schéma, puis les identifiants de runtime devraient être limités aux droits requis.

### Adaptations backend requises avant mise en production

- `backend/src/config/database.js` ne configure actuellement aucun paramètre `ssl`. Aiven exige généralement une connexion TLS ; les variables `DB_SSL`/`DB_SSL_CA` ci-dessus sont un contrat souhaité, pas une fonctionnalité déjà implémentée. Il faut adapter le pool et valider la connexion TLS avant la mise en ligne.
- `backend/src/server.js` vérifie la base, exécute les migrations et démarre un serveur avec `app.listen()` au chargement. Dans Vercel, le backend doit être exposé comme une fonction HTTP adaptée. Ne lancez pas les migrations automatiquement à chaque démarrage/cold start : exécutez-les séparément, une fois par version, via une tâche de déploiement contrôlée. Le timer d’expiration de sessions doit aussi être déplacé vers une tâche planifiée, car une fonction serverless ne reste pas active en continu.
- Les téléchargements locaux (`backend/uploads`) ne constituent pas un stockage persistant adapté aux fonctions serverless. Utiliser un stockage objet externe pour les pièces jointes et exports qui doivent survivre aux invocations.
- Le code de session utilise des cookies. Tester le flux avec les domaines de production réels ; si frontend et backend sont sur des domaines distincts, les cookies inter-sites peuvent nécessiter `SameSite=None; Secure` et un client navigateur configuré avec les identifiants. La politique actuelle doit être vérifiée avant la mise en production.

Le point de santé est `/api/sante`. Il doit renvoyer `baseDeDonnees: "ok"` après déploiement. Vercel injecte les variables d’environnement dans les fonctions ; les modifications de variables n’affectent que les nouveaux déploiements.

## 3. Configurer le projet Vercel du frontend

Créer un second projet Vercel depuis le même dépôt et conserver la racine du dépôt comme **Root Directory**. La configuration Vite utilise `npm run build`; le répertoire de sortie est `dist`.

Définir dans Vercel, avant le build de production :

| Variable | Valeur |
| --- | --- |
| `VITE_API_BASE_URL` | URL publique du backend suivie de `/api`, par exemple `https://mon-backend.vercel.app/api` |

Les variables `VITE_*` sont incorporées aux fichiers JavaScript visibles par les utilisateurs. N’y placer aucun mot de passe ni secret. Après ajout ou changement de variable, relancer un déploiement du frontend.

La note de réécriture SPA n’est à ajouter (`vercel.json` avec une réécriture vers `/`) que si les routes React renvoient 404 après rechargement direct. Vérifier notamment `/connexion` et une page métier.

## 4. Ordre de mise en ligne

1. Créer la base Aiven et enregistrer les secrets backend dans le projet Vercel du backend.
2. Implémenter et vérifier TLS Aiven ainsi que l’entrée HTTP serverless et le lancement contrôlé des migrations.
3. Déployer le backend et vérifier `https://<backend>/api/sante`.
4. Enregistrer l’origine réelle du frontend dans `ALLOWED_ORIGINS` du backend, sans barre oblique finale.
5. Configurer `VITE_API_BASE_URL` dans le projet frontend, puis déployer le frontend.
6. Vérifier connexion, session/cookies, navigation après rechargement, créations de données et téléversements.

Pour des URL de prévisualisation Vercel, configurer séparément les origines nécessaires pour Preview ; n’autoriser que les domaines de confiance.

## Fichiers de modèles

- Frontend : `.env.production`
- Backend : `backend/.env.production`

Pour la production, saisir les secrets dans les paramètres Vercel appropriés plutôt que de versionner ces fichiers.
