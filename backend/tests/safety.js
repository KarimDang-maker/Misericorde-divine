export const TEST_DATABASE_NAME = "misericorde_divine_test"

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const REMOTE_CONFIRMATION = "I_UNDERSTAND_THIS_IS_A_DISPOSABLE_TEST_DATABASE"

/**
 * The integration suite drops every table in its target schema. Fail closed unless
 * the schema is the dedicated test schema and the target is local or explicitly
 * confirmed as a disposable remote test database.
 */
export function assertSafeTestTarget(target, confirmation = process.env) {
  if (target.nodeEnv !== "test") {
    throw new Error("Refus des tests destructifs : NODE_ENV doit être test.")
  }
  if (target.databaseName !== TEST_DATABASE_NAME) {
    throw new Error(`Refus des tests destructifs : DB_NAME doit être exactement ${TEST_DATABASE_NAME}.`)
  }

  const host = String(target.host ?? "").trim().toLowerCase()
  if (LOCAL_DATABASE_HOSTS.has(host)) return { host, remote: false }

  const explicitlyConfirmed =
    confirmation.TEST_ALLOW_REMOTE_DATABASE === REMOTE_CONFIRMATION &&
    confirmation.TEST_DB_HOST_CONFIRMATION === target.host &&
    confirmation.TEST_DB_NAME_CONFIRMATION === TEST_DATABASE_NAME

  if (!explicitlyConfirmed) {
    throw new Error(
      "Refus des tests destructifs sur une base distante. Pour une base de test jetable uniquement, confirmez explicitement TEST_ALLOW_REMOTE_DATABASE, TEST_DB_HOST_CONFIRMATION et TEST_DB_NAME_CONFIRMATION.",
    )
  }

  return { host, remote: true }
}
