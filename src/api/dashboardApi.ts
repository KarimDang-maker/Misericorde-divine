import { httpClient, type ApiError } from "./httpClient"

export type DashboardSummary = {
  periode: { dateDebut?: string; dateFin?: string }
  membresActifs: number
  totalCotisations: number
  totalRecettes: number
  totalDons: number
  totalDepenses: number
  totalEntrees: number
  resultat: number
  soldeCaisse: number
  soldeBanque: number
  dernieresOperations: Array<{ id?: number; type: string; reference: string; dateOperation: string; montant: number; libelle?: string }>
  evolution: { periode: { dateDebut: string; dateFin: string }; points: Array<{ libelle: string; recettes: number; depenses: number }> }
  repartitionRecettes: Array<{ nom: string; valeur: number; pourcentage: number }>
}

export async function getDashboardSummary(params?: { dateDebut?: string; dateFin?: string }) {
  const response = await httpClient.get<{ success?: boolean; data?: unknown }>("/dashboard", { params })
  const summary = response.data?.data
  if (!response.data?.success || !summary || typeof summary !== "object") {
    const error: ApiError = {
      status: response.status,
      code: "REPONSE_DASHBOARD_INVALIDE",
      message: "Le serveur a répondu, mais les données du tableau de bord sont incomplètes.",
      fields: {},
    }
    throw error
  }

  const value = summary as Partial<DashboardSummary>
  const totals = [
    value.membresActifs,
    value.totalCotisations,
    value.totalRecettes,
    value.totalDons,
    value.totalDepenses,
    value.totalEntrees,
    value.resultat,
    value.soldeCaisse,
    value.soldeBanque,
  ]
  if (
    totals.some((total) => !Number.isFinite(Number(total))) ||
    !Array.isArray(value.dernieresOperations) ||
    !Array.isArray(value.repartitionRecettes) ||
    !Array.isArray(value.evolution?.points)
  ) {
    const error: ApiError = {
      status: response.status,
      code: "CONTRAT_DASHBOARD_INVALIDE",
      message: "Le tableau de bord a reçu un format de données inattendu. Réessayez ou transmettez le code d’erreur au support.",
      fields: {},
    }
    throw error
  }

  return value as DashboardSummary
}
