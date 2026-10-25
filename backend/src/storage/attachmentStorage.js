import fs from "node:fs/promises"
import path from "node:path"

const validKey = (key) => {
  if (!/^[a-f0-9]{48}\.(pdf|png|jpg|webp)$/.test(key)) throw new Error("Clé de stockage invalide.")
  return key
}

export function createLocalAttachmentStorage({ dir, filesystem = fs } = {}) {
  if (!dir) throw new Error("Un répertoire de stockage local est requis.")
  const filePath = (key) => path.join(dir, validKey(key))
  return {
    async put(key, contents) {
      await filesystem.mkdir(dir, { recursive: true })
      await filesystem.writeFile(filePath(key), contents, { flag: "wx" })
    },
    async get(key) {
      try {
        return await filesystem.readFile(filePath(key))
      } catch (error) {
        if (error.code === "ENOENT") return null
        throw error
      }
    },
    async delete(key) {
      try {
        await filesystem.unlink(filePath(key))
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
    },
  }
}

export function createVercelBlobAttachmentStorage({ put, get, del }) {
  return {
    async put(key, contents, mimeType) {
      validKey(key)
      await put(key, contents, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: mimeType,
      })
    },
    async get(key) {
      validKey(key)
      const result = await get(key, { access: "private" })
      if (!result || result.statusCode !== 200 || !result.stream) return null
      const chunks = []
      for await (const chunk of result.stream) chunks.push(Buffer.from(chunk))
      return Buffer.concat(chunks)
    },
    async delete(key) {
      validKey(key)
      await del(key)
    },
  }
}
