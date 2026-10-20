// Doit être importé AVANT tout module applicatif : fixe une base de test isolée.
process.env.NODE_ENV = "test"
process.env.DB_NAME = "misericorde_divine_test"
process.env.UPLOAD_DIR = "uploads-test"
process.env.SEED_ADMIN_PASSWORD = "MotDePasseTest123"
