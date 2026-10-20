import {
  BadgeCent,
  BanknoteArrowDown,
  BookOpen,
  Building2,
  CircleAlert,
  FileChartColumn,
  FileText,
  FileSpreadsheet,
  Gift,
  HandCoins,
  LayoutDashboard,
  Search,
  Settings,
  Tags,
  Users,
  WalletCards,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export type NavigationItem = {
  label: string
  path: string
  icon: LucideIcon
  description: string
  apiDependency: string
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export const navigationItems: NavigationGroup[] = [
  {
    label: "Vue d’ensemble",
    items: [
      {
        label: "Tableau de bord",
        path: "/",
        icon: LayoutDashboard,
        description:
          "Synthèse de l’activité financière et des dernières opérations.",
        apiDependency: "GET /api/dashboard",
      },
    ],
  },
  {
    label: "Gestion",
    items: [
      {
        label: "Membres",
        path: "/membres",
        icon: Users,
        description: "Répertoire des membres, fiches détaillées et historique.",
        apiDependency: "/api/membres",
      },
      {
        label: "Cotisations",
        path: "/cotisations",
        icon: HandCoins,
        description: "Enregistrement et suivi des cotisations par membre.",
        apiDependency: "/api/cotisations",
      },
      {
        label: "Recettes",
        path: "/recettes",
        icon: BanknoteArrowDown,
        description:
          "Suivi des recettes distinctes des cotisations et des dons.",
        apiDependency: "/api/recettes",
      },
      {
        label: "Dons et offrandes",
        path: "/dons",
        icon: Gift,
        description: "Consultation des dons et offrandes selon leur catégorie.",
        apiDependency: "/api/dons",
      },
      {
        label: "Dépenses",
        path: "/depenses",
        icon: BadgeCent,
        description: "Enregistrement, contrôle et consultation des dépenses.",
        apiDependency: "/api/depenses",
      },
      {
        label: "Rubriques",
        path: "/rubriques",
        icon: Tags,
        description: "Gérer les rubriques utilisées par les opérations financières.",
        apiDependency: "/api/rubriques",
      },
    ],
  },
  {
    label: "Trésorerie",
    items: [
      {
        label: "Caisse et comptes",
        path: "/comptes",
        icon: WalletCards,
        description:
          "Soldes et mouvements de la caisse et des comptes bancaires.",
        apiDependency: "/api/comptes",
      },
      {
        label: "Contribution diocésaine",
        path: "/contribution-diocesaine",
        icon: Building2,
        description:
          "Suivi distinct des opérations de contribution diocésaine.",
        apiDependency: "/api/contribution-diocesaine",
      },
      {
        label: "Justificatifs",
        path: "/justificatifs",
        icon: FileText,
        description: "Documents associés aux opérations financières.",
        apiDependency: "/api/justificatifs",
      },
    ],
  },
  {
    label: "Analyse",
    items: [
      {
        label: "Recherche",
        path: "/recherche",
        icon: Search,
        description: "Recherche contrôlée dans les données accessibles.",
        apiDependency: "/api/recherche",
      },
      {
        label: "Rapports",
        path: "/rapports",
        icon: FileChartColumn,
        description: "Rapports financiers et exports validés par le backend.",
        apiDependency: "/api/rapports",
      },
      {
        label: "Échanges Excel / CSV",
        path: "/echanges",
        icon: FileSpreadsheet,
        description: "Importer et exporter les ressources avec simulation préalable.",
        apiDependency: "/api/echanges",
      },
      {
        label: "Anomalies",
        path: "/anomalies",
        icon: CircleAlert,
        description: "Anomalies issues des contrôles métier du système.",
        apiDependency: "/api/anomalies",
      },
    ],
  },
  {
    label: "Application",
    items: [
      {
        label: "Paramètres",
        path: "/parametres",
        icon: Settings,
        description: "Configuration générale et préférences autorisées.",
        apiDependency: "/api/parametres",
      },
      {
        label: "Aide",
        path: "/aide",
        icon: BookOpen,
        description: "Documentation et guides d’utilisation de l’application.",
        apiDependency: "Contenu documentaire à fournir",
      },
    ],
  },
]
