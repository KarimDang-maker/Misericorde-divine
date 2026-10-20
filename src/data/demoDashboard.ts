export const demoDashboard = {
  updatedAt: "Données de démonstration · mise à jour fictive à 09:45",
  stats: [
    {
      label: "Membres actifs",
      value: "248",
      detail: "Référentiel de démonstration",
      tone: "rose",
    },
    {
      label: "Cotisations",
      value: "1 284 500 F",
      detail: "Période : janvier à juin",
      tone: "plum",
    },
    {
      label: "Solde de caisse",
      value: "486 200 F",
      detail: "Valeur illustrative",
      tone: "green",
    },
    {
      label: "Solde bancaire",
      value: "2 143 800 F",
      detail: "Valeur illustrative",
      tone: "blue",
    },
  ],
  evolution: [
    { month: "Jan", recettes: 520, depenses: 280 },
    { month: "Fév", recettes: 650, depenses: 390 },
    { month: "Mar", recettes: 590, depenses: 350 },
    { month: "Avr", recettes: 780, depenses: 420 },
    { month: "Mai", recettes: 720, depenses: 510 },
    { month: "Juin", recettes: 890, depenses: 460 },
  ],
  repartition: [
    { name: "Cotisations", value: 58, fill: "var(--color-chart-primary)" },
    { name: "Dons", value: 24, fill: "var(--color-chart-secondary)" },
    { name: "Autres recettes", value: 18, fill: "var(--color-chart-tertiary)" },
  ],
  operations: [
    {
      reference: "CT-2025-0148",
      label: "Cotisation mensuelle",
      type: "Cotisation",
      amount: "+ 25 000 F",
      date: "24 juin",
    },
    {
      reference: "DP-2025-0082",
      label: "Fournitures administratives",
      type: "Dépense",
      amount: "− 48 500 F",
      date: "23 juin",
    },
    {
      reference: "DN-2025-0036",
      label: "Don libre",
      type: "Don",
      amount: "+ 100 000 F",
      date: "21 juin",
    },
    {
      reference: "RC-2025-0054",
      label: "Recette exceptionnelle",
      type: "Recette",
      amount: "+ 75 000 F",
      date: "20 juin",
    },
  ],
}
