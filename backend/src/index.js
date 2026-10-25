// Entrée Vercel : la fonction exporte uniquement l'application HTTP.
// Les migrations et tâches de maintenance sont lancées séparément.
import { createApp } from "./app.js"
import { validateProductionEnvironment } from "./config/environment.js"

validateProductionEnvironment()
export default createApp()
