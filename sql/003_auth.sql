-- =====================================================================
-- 003_auth.sql
-- Login accounts and login-event log for the TrialMatch web app.
--
-- Run ONCE, after 002_note_embeddings.sql:
--   PowerShell: Get-Content sql\003_auth.sql | mysql -u root -p clinical_trial_matcher
--   bash/zsh:   mysql -u root -p clinical_trial_matcher < sql/003_auth.sql
--
-- Then create the first admin account (passwords are hashed by the
-- script, never stored in SQL):
--   node --env-file=.env.local scripts/create-user.mjs admin ADMIN "System Admin"
--
-- These tables are separate from the existing app_user table so this
-- migration cannot break whatever app_user already holds.
-- =====================================================================

USE clinical_trial_matcher;

-- ---------------------------------------------------------------------
-- 1. app_account: who can sign in to the web app, and with which role
-- ---------------------------------------------------------------------
-- Roles mirror the database roles in the report:
--   CLINICIAN  -> attending_clinician_role
--   RESEARCHER -> clinical_researcher_role
--   COMPLIANCE -> compliance_officer_role
--   ADMIN      -> manages web app accounts
CREATE TABLE IF NOT EXISTS app_account (
  account_id      INT AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(50)  NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL
    COMMENT 'scrypt$N$r$p$salt$hash - never a plain password',
  role            ENUM('ADMIN','CLINICIAN','RESEARCHER','COMPLIANCE') NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until    DATETIME     NULL
    COMMENT 'Set after 5 failed logins; sign-in refused until this time',
  session_version INT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Bumped on role change or deactivation to end existing sessions',
  last_login_at   DATETIME     NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_app_account_username UNIQUE (username),
  CONSTRAINT chk_app_account_username CHECK (username REGEXP '^[a-z0-9_.-]{3,50}$')
);

-- ---------------------------------------------------------------------
-- 2. auth_event: append-only record of sign-in activity
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_event (
  event_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  account_id  INT NULL,
  username    VARCHAR(50) NOT NULL
    COMMENT 'As typed at login, so failures for unknown names are kept too',
  event_type  ENUM('LOGIN_SUCCESS','LOGIN_FAILURE','ACCOUNT_LOCKED',
                   'LOGIN_BLOCKED','LOGOUT','ACCOUNT_CHANGED') NOT NULL,
  detail      VARCHAR(255) NULL,
  ip_address  VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auth_event_account FOREIGN KEY (account_id)
    REFERENCES app_account (account_id) ON DELETE SET NULL,
  INDEX idx_auth_event_time (created_at),
  INDEX idx_auth_event_account (account_id, created_at)
);

-- ---------------------------------------------------------------------
-- 3. Privileges for the web app's database account (DB_USER)
-- ---------------------------------------------------------------------
-- The app reads and updates accounts and appends events. It never needs
-- DELETE on either table; auth_event stays append-only from the app.
-- Change 'clinician_app'@'localhost' if your DB_USER/host differ.
GRANT SELECT, INSERT, UPDATE ON clinical_trial_matcher.app_account
  TO 'clinician_app'@'localhost';
GRANT SELECT, INSERT ON clinical_trial_matcher.auth_event
  TO 'clinician_app'@'localhost';

-- ---------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------
-- SELECT account_id, username, role, is_active, failed_attempts,
--        locked_until, last_login_at FROM app_account;
-- SELECT event_id, username, event_type, detail, ip_address, created_at
--   FROM auth_event ORDER BY event_id DESC LIMIT 20;
-- SHOW GRANTS FOR 'clinician_app'@'localhost';
