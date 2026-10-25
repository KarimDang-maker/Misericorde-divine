ALTER TABLE attachments
  ADD COLUMN storage_provider VARCHAR(32) NOT NULL DEFAULT 'local' AFTER storage_key;
