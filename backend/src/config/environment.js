import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
dotenv.config({ path: path.join(rootDir, ".env"), quiet: true })

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) ? parsed : fallback
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
    rootUser: process.env.DB_ROOT_USER || "root",
    rootPassword: process.env.DB_ROOT_PASSWORD || "",
  },
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || "md_session",
    durationHours: int(process.env.SESSION_DURATION_HOURS, 8),
  },
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  upload: {
    dir: path.resolve(rootDir, process.env.UPLOAD_DIR || "uploads"),
    maxBytes: int(process.env.UPLOAD_MAX_MB, 10) * 1024 * 1024,
  },
  seed: {
    email: process.env.SEED_ADMIN_EMAIL || "admin@misericorde.local",
    name: process.env.SEED_ADMIN_NAME || "Gestionnaire",
    password: process.env.SEED_ADMIN_PASSWORD || "",
  },
}
