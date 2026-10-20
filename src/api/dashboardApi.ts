import { httpClient } from "./httpClient"

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
  const response = await httpClient.get("/dashboard", { params })
  return response.data.data as DashboardSummary
}
