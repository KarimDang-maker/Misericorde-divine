# Architecture et état du frontend

## Architecture

- `src/app/routes.tsx` relie React Router à la navigation et aux pages métier.
- `src/auth/AuthProvider.tsx` restaure la session via `GET /api/auth/me`, expose connexion/déconnexion et protège l’espace de gestion.
- `src/api/httpClient.ts` centralise Axios, les enveloppes `{ success, data, meta? }` et les erreurs `{ success:false, error:{code,message,fields,requestId} }`.
- `src/pages/dashboard/DashboardPage.tsx` consomme `GET /api/dashboard` avec les filtres `dateDebut` et `dateFin`.
- `src/pages/shared/ResourcePage.tsx` gère les listes filtrables des domaines métier, la création des membres/comptes/opérations et les actions d’édition, statut et annulation disponibles.
- `src/pages/categories/CategoryPage.tsx` gère les rubriques de cotisations, recettes, dons et dépenses.
- `src/pages/shared/ModuleTools.tsx` expose les outils spécifiques des écrans d’échanges, de rapports, de contribution diocésaine, de justificatifs, d’anomalies, de paramètres et d’aide.
- `src/components/layout` contient la navigation et le shell ; les couleurs et composants partagés sont centralisés.

## Capacités principales

| Domaine | Fonctions exposées |
| --- | --- |
| Membres | Recherche, création, modification, activation/désactivation et archivage |
| Opérations financières | Liste, recherche, création, modification et annulation avec motif |
| Comptes | Création, modification des coordonnées et activation/désactivation |
| Rubriques | Création, modification et activation/désactivation pour les quatre familles |
| Contribution diocésaine | Liste, calcul, génération d’une écriture et annulation avec motif |
| Justificatifs | Téléversement, association facultative à une opération, téléchargement et suppression |
| Rapports | Consultation, filtres de période et exports CSV, XLSX et PDF |
| Échanges | Modèles, exports CSV/XLSX et import avec simulation et mode partiel |
| Anomalies | Exécution des règles, changement de statut et résolution commentée |
| Paramètres | Mise à jour des paramètres généraux et préférences ; lecture des paramètres de session |
| Recherche et aide | Recherche globale et consultation des guides disponibles |

Les montants, le statut des écritures et les contrôles de validation restent calculés et validés par le backend. L’interface collecte les motifs obligatoires avant les annulations. La simulation d’import est sélectionnée par défaut.

## Configuration et démarrage

Le frontend lit `VITE_API_BASE_URL` depuis `.env.local` (exemple dans `.env.example`). Le backend charge `backend/.env` ; les variables et la procédure MySQL sont documentées dans [README.md](../README.md) et [backend/.env.example](../backend/.env.example). En développement, les cookies sont `SameSite=Lax`; servez le frontend et l’API sur des origines locales compatibles et ajoutez l’origine exacte à `ALLOWED_ORIGINS`.

## Points à confirmer avant mise en production

- Confirmer le workflow d’approbation des opérations et les droits par utilisateur : le backend actuel utilise un seul rôle opérationnel.
- Confirmer les règles de calcul et de période diocésaine avec la personne responsable ; l’écran appelle les règles configurées dans Paramètres.
- Confirmer si l’import partiel doit être autorisé en exploitation. Le backend expose ce mode et l’interface le propose explicitement.
- Définir HTTPS, les origines autorisées, les secrets de production, les sauvegardes MySQL et le stockage durable des justificatifs.

Les appels sont branchés sur les routes et schémas backend présents dans le dépôt. Les actions ayant un effet financier sont transmises à l’API qui effectue les contrôles et contre-écritures. Le workflow d’approbation n’est pas défini dans le backend ; les créations sont donc soumises aux contrôles actuels de l’API, sans circuit de validation supplémentaire. Confirmer les droits, l’usage du mode d’import partiel et les règles diocésaines avant la mise en production.

## Vérifications d’intégration

- Les listes paginées appliquent la préférence backend `lignesParPage` et exposent la navigation de page.
- Les fiches membres chargent les données membre, la synthèse financière, les opérations et les cotisations depuis leurs endpoints dédiés. Les fiches de compte chargent le solde et les mouvements. Les fiches d’opération chargent l’historique et les justificatifs.
- Le formulaire des comptes conserve les valeurs texte des choix `caisse` / `banque` et les choix de sexe ; seuls les identifiants de référence deviennent des nombres.
- L’écran de contribution diocésaine expose les routes de lecture, de calcul, de synthèse, de génération, de saisie manuelle et d’annulation.
- Les téléchargements utilisent les réponses binaires de l’API ; les erreurs JSON renvoyées avec un type de réponse binaire restent lisibles dans le frontend.
- Les exports Excel/CSV sont réimportables. Une référence ou un code existant met à jour la ligne correspondante à travers les validations et transactions métier. La simulation annule les écritures ; les comptes protègent le type et le solde initial.

Le tableau par endpoint, les invariants financiers, les règles d’import et les limites de production sont détaillés dans [l’audit d’intégration](INTEGRATION_AUDIT.md).
