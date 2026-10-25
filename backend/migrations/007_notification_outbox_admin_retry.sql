ALTER TABLE notification_outbox
  ADD COLUMN manual_retry_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER attempts;
