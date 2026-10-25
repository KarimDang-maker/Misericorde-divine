ALTER TABLE users
  ADD COLUMN role ENUM('admin', 'gestionnaire') NOT NULL DEFAULT 'gestionnaire' AFTER nom,
  ADD KEY idx_users_role_active (role, actif);

CREATE TABLE password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_password_reset_hash (token_hash),
  KEY idx_password_reset_user (user_id, expires_at),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE password_reset_rate_limits (
  key_hash CHAR(64) PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  request_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  KEY idx_password_reset_rate_window (window_started_at)
) ENGINE=InnoDB;

CREATE TABLE account_adjustments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id INT UNSIGNED NOT NULL,
  sens ENUM('entree','sortie') NOT NULL,
  montant DECIMAL(15,2) NOT NULL,
  date_operation DATE NOT NULL,
  motif VARCHAR(500) NOT NULL,
  justificatif_reference VARCHAR(190) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_adjustment_amount CHECK (montant > 0),
  CONSTRAINT fk_adjustment_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id),
  CONSTRAINT fk_adjustment_user FOREIGN KEY (created_by) REFERENCES users(id),
  KEY idx_adjustment_account_date (account_id, date_operation)
) ENGINE=InnoDB;
