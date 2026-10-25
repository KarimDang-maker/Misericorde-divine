import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true })

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
export const parseBoolean = (value, fallback = false) => value == null ? fallback : ["1", "true", "yes"].includes(String(value).toLowerCase())
export const parseSameSite = (value) => {
  const normalized = String(value || "lax").toLowerCase()
  if (!["lax", "strict", "none"].includes(normalized)) throw new Error("SESSION_COOKIE_SAME_SITE doit valoir lax, strict ou none.")
  return normalized
}
const secureCookie = parseBoolean(process.env.SESSION_COOKIE_SECURE, process.env.NODE_ENV === "production")
const cookieSameSite = parseSameSite(process.env.SESSION_COOKIE_SAME_SITE)
if (cookieSameSite === "none" && !secureCookie) throw new Error("SameSite=None nécessite SESSION_COOKIE_SECURE=true.")
const dbSsl = parseBoolean(process.env.DB_SSL)
export function buildDatabaseSsl(enabled, ca) {
  return enabled ? { ...(ca ? { ca: ca.replace(/\\n/g, "\n") } : {}), rejectUnauthorized: true } : undefined
}

export const env = {
  rootDir,
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: int(process.env.PORT, 4000),
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: int(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || "misericorde_divine",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    connectionLimit: int(process.env.DB_CONNECTION_LIMIT, 10),
    ssl: buildDatabaseSsl(dbSsl, process.env.DB_SSL_CA),
    rootUser: process.env.DB_ROOT_USER || "root",
    rootPassword: process.env.DB_ROOT_PASSWORD || "",
  },
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || "md_session",
    durationHours: int(process.env.SESSION_DURATION_HOURS, 8),
    secureCookie,
    sameSite: cookieSameSite,
  },
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  trustProxy: process.env.TRUST_PROXY || "loopback",
  upload: {
    dir: path.resolve(rootDir, process.env.UPLOAD_DIR || "uploads"),
    maxBytes: int(process.env.UPLOAD_MAX_MB, process.env.NODE_ENV === "production" ? 4 : 10) * 1024 * 1024,
    storageProvider: process.env.UPLOAD_STORAGE || (process.env.NODE_ENV === "production" ? "vercel-blob" : "local"),
  },
  email: {
    provider: process.env.EMAIL_PROVIDER || "disabled",
    apiKey: process.env.EMAIL_API_KEY || "",
    from: process.env.EMAIL_FROM || "",
    replyTo: process.env.EMAIL_REPLY_TO || "",
    batchLimit: int(process.env.EMAIL_BATCH_LIMIT, 3),
  },
  cronSecret: process.env.CRON_SECRET || "",
  frontendUrl: process.env.FRONTEND_URL || "",
  passwordResetEncryptionKey: process.env.PASSWORD_RESET_ENCRYPTION_KEY || "",
  seed: {
    email: process.env.SEED_ADMIN_EMAIL || "admin@misericorde.local",
    name: process.env.SEED_ADMIN_NAME || "Gestionnaire",
    password: process.env.SEED_ADMIN_PASSWORD || "",
  },
}

export function validateProductionEnvironment(config = env) {
  if (config.nodeEnv !== "production") return
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL_CA", "ALLOWED_ORIGINS", "CRON_SECRET", "FRONTEND_URL", "PASSWORD_RESET_ENCRYPTION_KEY"]
  const missing = required.filter((key) => !String(process.env[key] || "").trim())
  if (missing.length) throw new Error(`Configuration Production incomplète : ${missing.join(", ")}.`)
  if (!config.db.ssl) throw new Error("DB_SSL=true est requis en Production.")
  if (config.allowedOrigins.some((origin) => {
    try { const parsed = new URL(origin); return parsed.origin !== origin || parsed.protocol !== "https:" }
    catch { return true }
  })) throw new Error("ALLOWED_ORIGINS doit contenir uniquement des origines HTTPS exactes.")
  try { if (new URL(config.frontendUrl).protocol !== "https:") throw new Error() }
  catch { throw new Error("FRONTEND_URL doit être une URL HTTPS valide.") }
  if (config.session.sameSite === "none" && !config.session.secureCookie) throw new Error("SESSION_COOKIE_SECURE=true est requis avec SameSite=None.")
  if (config.cronSecret.length < 32) throw new Error("CRON_SECRET doit contenir au moins 32 caractères.")
  if (config.upload.storageProvider === "vercel-blob" && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN est requis avec UPLOAD_STORAGE=vercel-blob.")
  if (config.email.provider === "resend" && (!config.email.apiKey || !config.email.from)) throw new Error("EMAIL_API_KEY et EMAIL_FROM sont requis avec EMAIL_PROVIDER=resend.")
  if (Buffer.from(config.passwordResetEncryptionKey, "base64").length !== 32) throw new Error("PASSWORD_RESET_ENCRYPTION_KEY doit encoder 32 octets.")
}
