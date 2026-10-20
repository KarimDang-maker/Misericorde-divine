import { env } from "./environment.js"

const silent = env.nodeEnv === "test"

function write(level, message, meta) {
  if (silent && level !== "error") return
  const line = { time: new Date().toISOString(), level, message, ...meta }
  // Jamais de secrets : les appelants ne passent que des métadonnées techniques.
  console[level === "error" ? "error" : "log"](JSON.stringify(line))
}

export const logger = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
}
