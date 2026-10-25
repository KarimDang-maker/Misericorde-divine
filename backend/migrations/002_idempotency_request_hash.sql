ALTER TABLE idempotency_keys
  ADD COLUMN request_hash CHAR(64) NULL AFTER route;
