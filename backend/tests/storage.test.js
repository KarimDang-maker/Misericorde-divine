import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { createLocalAttachmentStorage, createVercelBlobAttachmentStorage } from "../src/storage/attachmentStorage.js"

const key = `${"a".repeat(48)}.pdf`

describe("Adaptateurs de stockage des justificatifs", () => {
  it("le stockage local écrit, relit, supprime de façon idempotente et bloque les chemins", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "md-storage-test-"))
    const storage = createLocalAttachmentStorage({ dir })
    const contents = Buffer.from("contenu-test")
    try {
      await storage.put(key, contents, "application/pdf")
      assert.deepEqual(await storage.get(key), contents)
      await assert.rejects(storage.put(key, contents), { code: "EEXIST" })
      await assert.rejects(storage.get("..\\secret.pdf"), /Clé de stockage invalide/)
      await storage.delete(key)
      await storage.delete(key)
      assert.equal(await storage.get(key), null)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("Vercel Blob utilise un accès privé, préserve les octets et délègue suppression/erreurs", async () => {
    const objects = new Map()
    const calls = []
    const sdk = {
      async put(name, body, options) {
        calls.push(["put", name, options])
        objects.set(name, Buffer.from(body))
      },
      async get(name, options) {
        calls.push(["get", name, options])
        const body = objects.get(name)
        if (!body) return null
        return { statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(body); controller.close() } }) }
      },
      async del(name) {
        calls.push(["del", name])
        objects.delete(name)
      },
    }
    const storage = createVercelBlobAttachmentStorage(sdk)
    const contents = Buffer.from([0, 1, 2, 255])
    await storage.put(key, contents, "application/pdf")
    assert.deepEqual(await storage.get(key), contents)
    await storage.delete(key)
    assert.equal(await storage.get(key), null)
    assert.equal(calls[0][2].access, "private")
    assert.equal(calls[0][2].contentType, "application/pdf")
    assert.deepEqual(calls[1][2], { access: "private" })
    await assert.rejects(storage.get("../../secret"), /Clé de stockage invalide/)
  })
})
