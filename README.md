<<<<<<< HEAD
# Miséricorde Divine

Application de gestion financière : frontend React/Vite et API Express/MySQL.

## Démarrage local

Prérequis : Node.js 20 ou supérieur, npm, MySQL 8.0 (le schéma utilise `utf8mb4_0900_ai_ci`).

1. Démarrer le service MySQL et créer/copier `backend/.env.example` vers `backend/.env`. Renseigner les mots de passe MySQL `DB_ROOT_PASSWORD`, `DB_PASSWORD` et `SEED_ADMIN_PASSWORD`. Le script de migration crée la base, l’utilisateur SQL et applique les migrations ; il a donc besoin du compte d’administration MySQL.
2. Installer et initialiser le backend :

   ```powershell
   cd backend
   npm install
   npm run migrate
   npm run seed
   npm run dev
   ```

   L’API écoute sur `http://localhost:4000`. `GET /api/sante` vérifie l’API et MySQL. `npm start` lance le même serveur sans redémarrage automatique.

3. Dans un second terminal, à la racine, installer puis lancer le frontend :

   ```powershell
   npm install
   npm run dev
   ```

   Vite écoute sur le port configuré par `PORT` (8443 dans Figma Make, généralement 5173 hors de Figma). Définir `VITE_API_BASE_URL=http://localhost:4000/api` dans `.env.local` à la racine si le frontend ne tourne pas sur la même origine que l’API. Ajouter l’origine exacte du frontend à `ALLOWED_ORIGINS` dans `backend/.env`.

Le frontend utilise des cookies de session `HttpOnly`. En développement local, gardez frontend et API sur des origines locales (même site) pour que le cookie `SameSite=Lax` fonctionne. En production, HTTPS est requis pour le cookie `Secure`.

## Variables backend

Voir [backend/.env.example](backend/.env.example). `backend/src/config/environment.js` charge `backend/.env` et applique des valeurs de repli ; ces replis ne constituent pas une configuration de production. Pour une base neuve, les étapes d’initialisation sont `npm run migrate`, puis `npm run seed`. Le démarrage normal (`npm run dev` ou `npm start`) vérifie la connexion, applique les migrations déjà initialisées, puis démarre l’API ; il ne crée pas l’utilisateur initial.

## API et frontend

Les routes sont montées sous `/api`. Les réponses JSON suivent `{ success: true, data, meta? }` ; les erreurs suivent `{ success: false, error: { code, message, fields, requestId } }`. Les opérations financières et la validation de leurs règles restent côté API. Les modules UI consomment ces routes avec un compte connecté.

Commandes frontend : `npm run build`, `npm run format`. Commandes backend depuis `backend/` : `npm test`, `npm run migrate`, `npm run seed`.

## Documentation

- [Architecture frontend](docs/FRONTEND_ARCHITECTURE.md)
- [Audit d’intégration frontend/API/MySQL](docs/INTEGRATION_AUDIT.md)
- [Spécification backend](backend.md)
=======
# Misericorde-divine
Plateforme monoutilisateur de gestion de caisse diocésaine 
>>>>>>> 62bf639854ea45aaa9a2df923028b3909c837d7a
