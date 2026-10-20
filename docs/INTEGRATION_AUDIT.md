# Audit d’intégration frontend, API et MySQL

## Résultat

Le frontend utilise une API Express persistée dans MySQL. Les calculs financiers sensibles sont exécutés côté serveur. Une écriture métier et son mouvement de compte sont créés ou corrigés dans la même transaction ; une annulation conserve l’écriture d’origine et ajoute une contre-écriture. Les soldes proviennent du solde initial et de la somme des mouvements, pas d’un montant modifiable dans le navigateur.

## Parcours fonctionnels vérifiés

| Fonction | Frontend | Méthodes API principales | Persistance / calcul |
| --- | --- | --- | --- |
| Session | Restauration, connexion, déconnexion, changement de mot de passe | `GET /auth/me`, `POST /auth/login`, `POST /auth/logout`, `PUT /auth/password` | `users`, `sessions`, hachage du mot de passe, révocation de session |
| Membres | Liste paginée, recherche, création, fiche détaillée, modification, statut et archivage | `GET/POST /membres`, `GET/PUT /membres/:id`, `PATCH /membres/:id/statut`, `GET /membres/:id/operations`, `/synthese-financiere`, `/cotisations` | `members`; vérification d’unicité et journal d’audit; archivage logique |
| Rubriques | Quatre familles, liste, détail, création, modification, activation/désactivation | `GET/POST /rubriques/:type`, `GET/PUT /rubriques/:type/:id`, `PATCH /rubriques/:type/:id/statut` | Tables de rubriques dédiées; une rubrique utilisée reste conservée |
| Cotisations, recettes, dons, dépenses | Liste paginée, création, modification, fiche avec mouvements/historique/justificatifs, annulation motivée | `GET/POST/PUT /:type`, `GET /:type/:id`, `POST /:type/:id/annulation` | Tables métier, `financial_movements`, historique et `audit_logs`; transactions et contrôle du solde |
| Comptes et trésorerie | Liste, création, modification des coordonnées, activation, solde et mouvements détaillés, synthèse caisse/banque/consolidée | `GET/POST /comptes`, `GET/PUT /comptes/:id`, `PATCH /comptes/:id/statut`, `GET /comptes/:id/solde`, `/mouvements`, `GET /tresorerie/synthese` | `financial_accounts` et `financial_movements`; solde = initial + entrées − sorties |
| Contribution diocésaine | Liste, saisie manuelle, calcul, synthèse, génération, détails/opérations associées et annulation | `GET/POST /contribution-diocesaine`, `GET /contribution-diocesaine/:id`, `/synthese`, `GET /:id/operations`, `POST /calcul`, `/generation`, `/:id/annulation` | `diocesan_contributions`, mouvement sortant, historique et audit; calcul en centimes entiers |
| Justificatifs | Téléversement, fiche, liaison après téléversement ou au téléversement, téléchargement et suppression | `GET/POST /justificatifs`, `GET /:id`, `POST /:id/liaison`, `GET /:id/telechargement`, `DELETE /:id`, `GET /operations/:type/:id/justificatifs` | Métadonnées et liaisons MySQL; fichier dans `UPLOAD_DIR`, type et empreinte vérifiés |
| Recherche et rapports | Recherche globale; consultation et exports CSV/XLSX/PDF | `GET /recherche`, `GET /rapports`, `GET /rapports/:type`, `GET /rapports/:type/export` | Les rapports réutilisent les services de lecture des listes, soldes et mouvements |
| Import / export | Export XLSX/CSV, modèles, simulation, import total ou partiel | `GET /echanges`, `GET /echanges/:ressource/export`, `GET /:ressource/modele`, `POST /:ressource/import` | Import transactionnel; création ou mise à jour via les services métier; audit |
| Anomalies | Liste, fiche, règles, analyse, changement de statut et résolution commentée | `GET /anomalies`, `GET /:id`, `GET /regles`, `POST /analyse`, `PATCH /:id/statut`, `POST /:id/resolution` | `anomalies` et historique; l’analyse détecte notamment des incohérences de mouvements |
| Paramètres et aide | Paramètres généraux, préférences, sécurité de session et guides | `GET/PUT /parametres`, `/parametres/generaux`, `/parametres/preferences`, `GET /aide`, `GET /aide/:slug` | `settings`, `user_preferences`; mot de passe via le service d’authentification |

## Contrat d’import des fichiers exportés

- Un export XLSX ou CSV garde des en-têtes reconnus par l’import correspondant. Les filtres d’export peuvent réduire le jeu de lignes ; l’import valide chaque ligne avec le schéma métier.
- Une référence existante met à jour le membre ou l’opération. Un code existant met à jour le compte ou la rubrique. Une clé absente crée une nouvelle ligne et la référence métier est générée par l’API.
- Les opérations déjà annulées dans le fichier sont ignorées. Une opération annulée côté base ne peut pas être réactivée par import ; les règles normales de modification s’appliquent.
- Le mode simulation exécute les validations et les traitements puis annule la transaction. Le mode par défaut en exécution est « tout ou rien » ; le mode partiel conserve uniquement les lignes valides et rapporte les erreurs.
- Une modification financière utilise `updateOperation`, qui met à jour le mouvement normal dans la même transaction, revérifie les soldes et écrit l’audit. Si le compte devient insolvable, la ligne est annulée et un import global est rejeté.
- Pour un compte existant, le type et le solde initial sont immuables par import. Le solde courant est calculé à partir du grand livre et n’est pas importé. Les mouvements et contributions diocésaines restent exportables uniquement ; leur import direct pourrait contourner les invariants comptables.
- Limite d’un fichier d’import : 50 000 lignes. Les exports de membres et d’opérations sont limités à la même taille.

## Intégrité financière

- MySQL stocke les montants en `DECIMAL`; le pilote conserve les décimales sous forme de chaînes.
- Les validations convertissent les montants en centimes entiers. Le calcul du taux diocésain utilise également l’arithmétique entière et un arrondi commercial explicite.
- La création, la modification et l’annulation synchronisent les opérations et les mouvements sous transaction. Les comptes sont verrouillés dans l’ordre des identifiants ; le niveau d’isolation `READ COMMITTED` évite de contrôler un solde sur un ancien instantané concurrent.
- Les dépenses contrôlent le découvert autorisé. Une annulation est auditée et ajoute une contre-écriture au lieu de supprimer le mouvement d’origine.
- Les tests vérifient des sommes par SQL, les erreurs d’arrondi, le rollback, les soldes après changement de compte, les annulations simultanées, l’idempotence et la persistance après redémarrage.

## Exécution et vérification

Depuis `backend/`, `npm test` exécute la suite d’intégration. Le garde-fou dans `backend/tests/helpers.js` interdit de lancer les tests sur une base autre que `misericorde_divine_test`; la suite réinitialise cette base et son dossier d’uploads de test. Depuis la racine, `npm run build` vérifie le typage utilisé par Vite et produit le build frontend.

Les variables, migrations et commandes de démarrage sont décrites dans [README.md](../README.md) et [backend/.env.example](../backend/.env.example). Le backend charge `backend/.env`, vérifie la connexion MySQL au démarrage et attend la migration initiale avant le seed administrateur.

## Limites restantes

- Le backend exige une session de compte actif, mais ne définit pas encore de permissions fines par rôle ou par fonctionnalité.
- Les fichiers sont stockés dans le répertoire local configuré par `UPLOAD_DIR`. En production, ce chemin doit être un volume durable sauvegardé, ou être remplacé par un stockage objet.
- Les préférences de nombre de lignes influencent les listes paginées. Le thème sombre et le masquage visuel des montants sont enregistrés, mais ne sont pas encore appliqués globalement à toutes les pages.
- Le dépôt contient une suite d’intégration backend et un build frontend ; il ne contient pas encore de tests de parcours navigateur automatisés.
- Le taux et l’assiette diocésains sont paramétrables. Leur validation métier formelle, les droits de validation des écritures et les procédures de sauvegarde/restauration restent à définir avant une mise en production.
- Le build signale deux avertissements de configuration Vite (`__dirname` et import JSON sans attribut). Ils n’empêchent pas la compilation actuelle.
