import { notFound } from "../utils/errors.js"

const SECTIONS = [
  {
    slug: "demarrer",
    titre: "Démarrer",
    resume: "Connexion, navigation et premiers réglages.",
    contenu: [
      "Connectez-vous avec votre adresse e-mail et votre mot de passe. La session expire automatiquement.",
      "Créez d'abord au moins un compte (caisse ou banque) dans « Caisse et comptes », puis vos rubriques dans « Paramètres ».",
      "Toutes les données sont enregistrées dans la base MySQL : elles sont conservées après la fermeture de l'application.",
    ],
  },
  {
    slug: "membres",
    titre: "Membres",
    resume: "Créer, modifier et archiver les membres.",
    contenu: [
      "Le nom et le prénom sont obligatoires. L'e-mail et le téléphone, s'ils sont saisis, doivent être uniques.",
      "Un membre n'est jamais supprimé : il est archivé afin de conserver l'historique de ses opérations.",
    ],
  },
  {
    slug: "operations",
    titre: "Cotisations, recettes, dons et dépenses",
    resume: "Enregistrer et annuler des opérations financières.",
    contenu: [
      "Chaque opération est rattachée à une rubrique et à un compte. Elle génère automatiquement un mouvement de compte.",
      "Une opération ne se supprime pas : on l'annule en indiquant un motif. Une contre-écriture est alors enregistrée et le solde est corrigé.",
      "Une dépense est refusée si elle rend le solde d'un compte négatif (sauf découvert autorisé sur ce compte).",
    ],
  },
  {
    slug: "excel",
    titre: "Export et import Excel",
    resume: "Travailler hors de l'application avec le même format.",
    contenu: [
      "Les ressources importables peuvent être exportées en Excel (.xlsx) ou CSV, modifiées hors de l'application puis réimportées avec les mêmes en-têtes.",
      "Une référence ou un code déjà présent met à jour la ligne correspondante ; une clé nouvelle crée un enregistrement. Les opérations annulées ne peuvent pas être réactivées par import.",
      "Utilisez « Simulation » pour valider le fichier sans rien enregistrer. L'import est « tout ou rien » par défaut ; le mode partiel conserve les lignes valides et signale les autres.",
      "Le type et le solde initial d'un compte existant ne peuvent pas être modifiés par import. Les mouvements financiers et versements diocésains ne sont pas importables.",
    ],
  },
  {
    slug: "tresorerie",
    titre: "Trésorerie",
    resume: "Soldes, mouvements et contribution diocésaine.",
    contenu: [
      "Le solde d'un compte = solde initial + entrées − sorties, annulations comprises.",
      "La contribution diocésaine se calcule à partir d'un taux et d'une assiette à configurer dans les paramètres.",
    ],
  },
  {
    slug: "justificatifs",
    titre: "Justificatifs",
    resume: "Joindre des documents aux opérations.",
    contenu: ["Formats acceptés : PDF, PNG, JPEG, WebP (10 Mo maximum). Les fichiers sont stockés hors de la base, seules leurs métadonnées sont en base."],
  },
]

export const listHelpSections = () => SECTIONS.map(({ slug, titre, resume }) => ({ slug, titre, resume }))

export function getHelpSection(slug) {
  const section = SECTIONS.find((s) => s.slug === slug)
  if (!section) throw notFound("AIDE_NOT_FOUND", "Cette rubrique d'aide n'existe pas.")
  return section
}
