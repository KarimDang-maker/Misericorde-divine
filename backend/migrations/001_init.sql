-- Schéma initial Miséricorde Divine. Tous les montants sont en DECIMAL(15,2).

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  nom VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_exp (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE reference_counters (
  prefix VARCHAR(10) NOT NULL,
  annee SMALLINT NOT NULL,
  derniere_valeur INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, annee)
) ENGINE=InnoDB;

CREATE TABLE members (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL,
  nom VARCHAR(120) NOT NULL,
  prenom VARCHAR(120) NOT NULL,
  sexe ENUM('M','F') NULL,
  telephone VARCHAR(30) NULL,
  email VARCHAR(190) NULL,
  adresse VARCHAR(255) NULL,
  date_naissance DATE NULL,
  date_adhesion DATE NULL,
  statut ENUM('actif','inactif','archive') NOT NULL DEFAULT 'actif',
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_members_reference (reference),
  UNIQUE KEY uq_members_email (email),
  UNIQUE KEY uq_members_telephone (telephone),
  KEY idx_members_name (nom, prenom),
  KEY idx_members_statut (statut)
) ENGINE=InnoDB;

CREATE TABLE financial_accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  nom VARCHAR(150) NOT NULL,
  type ENUM('caisse','banque') NOT NULL,
  banque VARCHAR(150) NULL,
  numero_compte VARCHAR(60) NULL,
  solde_initial DECIMAL(15,2) NOT NULL DEFAULT 0,
  autoriser_solde_negatif TINYINT(1) NOT NULL DEFAULT 0,
  actif TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accounts_code (code)
) ENGINE=InnoDB;

-- Rubriques (une table par famille, structure commune)
CREATE TABLE contribution_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  libelle VARCHAR(150) NOT NULL,
  description VARCHAR(255) NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_code (code)
) ENGINE=InnoDB;

CREATE TABLE revenue_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  libelle VARCHAR(150) NOT NULL,
  description VARCHAR(255) NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rc_code (code)
) ENGINE=InnoDB;

CREATE TABLE donation_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  libelle VARCHAR(150) NOT NULL,
  description VARCHAR(255) NULL,
  nature ENUM('don','offrande','autre') NOT NULL DEFAULT 'don',
  actif TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dc_code (code)
) ENGINE=InnoDB;

CREATE TABLE expense_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  libelle VARCHAR(150) NOT NULL,
  description VARCHAR(255) NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ec_code (code)
) ENGINE=InnoDB;

-- Opérations financières
CREATE TABLE contributions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL,
  member_id INT UNSIGNED NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  montant DECIMAL(15,2) NOT NULL,
  date_operation DATE NOT NULL,
  periode VARCHAR(7) NULL,
  mode_paiement VARCHAR(40) NULL,
  libelle VARCHAR(255) NULL,
  statut ENUM('valide','annule') NOT NULL DEFAULT 'valide',
  motif_annulation VARCHAR(500) NULL,
  annule_par INT UNSIGNED NULL,
  annule_le DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contributions_reference (reference),
  KEY idx_contributions_date (date_operation),
  KEY idx_contributions_member (member_id),
  KEY idx_contributions_category (category_id),
  KEY idx_contributions_account (account_id),
  CONSTRAINT chk_contributions_montant CHECK (montant > 0),
  CONSTRAINT fk_contributions_member FOREIGN KEY (member_id) REFERENCES members(id),
  CONSTRAINT fk_contributions_category FOREIGN KEY (category_id) REFERENCES contribution_categories(id),
  CONSTRAINT fk_contributions_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE revenues (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL,
  member_id INT UNSIGNED NULL,
  category_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  tiers VARCHAR(190) NULL,
  montant DECIMAL(15,2) NOT NULL,
  date_operation DATE NOT NULL,
  mode_paiement VARCHAR(40) NULL,
  libelle VARCHAR(255) NULL,
  statut ENUM('valide','annule') NOT NULL DEFAULT 'valide',
  motif_annulation VARCHAR(500) NULL,
  annule_par INT UNSIGNED NULL,
  annule_le DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_revenues_reference (reference),
  KEY idx_revenues_date (date_operation),
  KEY idx_revenues_category (category_id),
  KEY idx_revenues_account (account_id),
  CONSTRAINT chk_revenues_montant CHECK (montant > 0),
  CONSTRAINT fk_revenues_member FOREIGN KEY (member_id) REFERENCES members(id),
  CONSTRAINT fk_revenues_category FOREIGN KEY (category_id) REFERENCES revenue_categories(id),
  CONSTRAINT fk_revenues_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE donations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL,
  member_id INT UNSIGNED NULL,
  category_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  tiers VARCHAR(190) NULL,
  montant DECIMAL(15,2) NOT NULL,
  date_operation DATE NOT NULL,
  mode_paiement VARCHAR(40) NULL,
  libelle VARCHAR(255) NULL,
  statut ENUM('valide','annule') NOT NULL DEFAULT 'valide',
  motif_annulation VARCHAR(500) NULL,
  annule_par INT UNSIGNED NULL,
  annule_le DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_donations_reference (reference),
  KEY idx_donations_date (date_operation),
  KEY idx_donations_category (category_id),
  KEY idx_donations_account (account_id),
  CONSTRAINT chk_donations_montant CHECK (montant > 0),
  CONSTRAINT fk_donations_member FOREIGN KEY (member_id) REFERENCES members(id),
  CONSTRAINT fk_donations_category FOREIGN KEY (category_id) REFERENCES donation_categories(id),
  CONSTRAINT fk_donations_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE expenses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL,
  category_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  tiers VARCHAR(190) NULL,
  montant DECIMAL(15,2) NOT NULL,
  date_operation DATE NOT NULL,
  mode_paiement VARCHAR(40) NULL,
  libelle VARCHAR(255) NULL,
  statut ENUM('valide','annule') NOT NULL DEFAULT 'valide',
  motif_annulation VARCHAR(500) NULL,
  annule_par INT UNSIGNED NULL,
  annule_le DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_expenses_reference (reference),
  KEY idx_expenses_date (date_operation),
  KEY idx_expenses_category (category_id),
  KEY idx_expenses_account (account_id),
  CONSTRAINT chk_expenses_montant CHECK (montant > 0),
  CONSTRAINT fk_expenses_category FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT fk_expenses_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE diocesan_contributions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(30) NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  montant DECIMAL(15,2) NOT NULL,
  date_operation DATE NOT NULL,
  periode_debut DATE NOT NULL,
  periode_fin DATE NOT NULL,
  assiette DECIMAL(15,2) NULL,
  taux DECIMAL(7,4) NULL,
  libelle VARCHAR(255) NULL,
  statut ENUM('valide','annule') NOT NULL DEFAULT 'valide',
  motif_annulation VARCHAR(500) NULL,
  annule_par INT UNSIGNED NULL,
  annule_le DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_diocesan_reference (reference),
  KEY idx_diocesan_date (date_operation),
  CONSTRAINT chk_diocesan_montant CHECK (montant > 0),
  CONSTRAINT chk_diocesan_periode CHECK (periode_fin >= periode_debut),
  CONSTRAINT fk_diocesan_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
) ENGINE=InnoDB;

-- Mouvements financiers : source unique de vérité des soldes
CREATE TABLE financial_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id INT UNSIGNED NOT NULL,
  sens ENUM('entree','sortie') NOT NULL,
  montant DECIMAL(15,2) NOT NULL,
  date_operation DATE NOT NULL,
  source_type ENUM('contribution','revenue','donation','expense','diocesan','ajustement') NOT NULL,
  source_id INT UNSIGNED NOT NULL,
  nature ENUM('normal','contre_ecriture') NOT NULL DEFAULT 'normal',
  reference VARCHAR(30) NOT NULL,
  libelle VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_movements_account_date (account_id, date_operation),
  KEY idx_movements_source (source_type, source_id),
  CONSTRAINT chk_movements_montant CHECK (montant > 0),
  CONSTRAINT fk_movements_account FOREIGN KEY (account_id) REFERENCES financial_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE operation_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operation_type ENUM('contribution','revenue','donation','expense','diocesan') NOT NULL,
  operation_id INT UNSIGNED NOT NULL,
  ancien_statut VARCHAR(20) NULL,
  nouveau_statut VARCHAR(20) NOT NULL,
  motif VARCHAR(500) NULL,
  user_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_history_operation (operation_type, operation_id)
) ENGINE=InnoDB;

CREATE TABLE attachments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  storage_key VARCHAR(80) NOT NULL,
  nom_original VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  taille INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  description VARCHAR(255) NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attachments_key (storage_key)
) ENGINE=InnoDB;

CREATE TABLE operation_attachments (
  attachment_id INT UNSIGNED NOT NULL,
  operation_type ENUM('contribution','revenue','donation','expense','diocesan') NOT NULL,
  operation_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attachment_id, operation_type, operation_id),
  KEY idx_attachments_operation (operation_type, operation_id),
  CONSTRAINT fk_opatt_attachment FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE anomalies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL,
  gravite ENUM('info','avertissement','critique') NOT NULL DEFAULT 'avertissement',
  entite_type VARCHAR(30) NULL,
  entite_id INT UNSIGNED NULL,
  message VARCHAR(500) NOT NULL,
  empreinte CHAR(64) NOT NULL,
  statut ENUM('ouverte','en_cours','resolue','ignoree') NOT NULL DEFAULT 'ouverte',
  resolution VARCHAR(500) NULL,
  detectee_le TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolue_le DATETIME NULL,
  UNIQUE KEY uq_anomalies_empreinte (empreinte),
  KEY idx_anomalies_statut (statut)
) ENGINE=InnoDB;

CREATE TABLE anomaly_history (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  anomaly_id INT UNSIGNED NOT NULL,
  ancien_statut VARCHAR(20) NULL,
  nouveau_statut VARCHAR(20) NOT NULL,
  commentaire VARCHAR(500) NULL,
  user_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_anomaly_history (anomaly_id),
  CONSTRAINT fk_anomaly_history FOREIGN KEY (anomaly_id) REFERENCES anomalies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE settings (
  cle VARCHAR(80) PRIMARY KEY,
  valeur JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE user_preferences (
  user_id INT UNSIGNED PRIMARY KEY,
  preferences JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  entite_type VARCHAR(40) NOT NULL,
  entite_id VARCHAR(40) NULL,
  anciennes_valeurs JSON NULL,
  nouvelles_valeurs JSON NULL,
  request_id VARCHAR(40) NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_entity (entite_type, entite_id),
  KEY idx_audit_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE idempotency_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cle VARCHAR(100) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  route VARCHAR(120) NOT NULL,
  statut_http SMALLINT NOT NULL,
  corps JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem (user_id, cle)
) ENGINE=InnoDB;
