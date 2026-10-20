import multer from "multer"
import { env } from "../config/environment.js"

// Stockage mémoire : le contenu est vérifié (type + signature) avant toute écriture disque.
export const handleFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxBytes, files: 1 },
}).single("fichier")

export const handleImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
}).single("fichier")
