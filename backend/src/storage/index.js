import { AppError } from "../utils/errors.js"
import { env } from "../config/environment.js"
import { createLocalAttachmentStorage, createVercelBlobAttachmentStorage } from "./attachmentStorage.js"

const adapters = new Map([["local", createLocalAttachmentStorage({ dir: env.upload.dir })]])

export async function getAttachmentStorage(provider = env.upload.storageProvider) {
  if (adapters.has(provider)) return adapters.get(provider)
  if (provider !== "vercel-blob") throw new AppError(500, "STOCKAGE_INVALIDE", "Le fournisseur de stockage est invalide.")
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new AppError(503, "STOCKAGE_INDISPONIBLE", "Le stockage des justificatifs n’est pas configuré.")
  }
  const sdk = await import("@vercel/blob")
  const adapter = createVercelBlobAttachmentStorage(sdk)
  adapters.set(provider, adapter)
  return adapter
}
