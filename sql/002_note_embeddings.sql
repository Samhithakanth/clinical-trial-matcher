-- =====================================================================
-- 002_note_embeddings.sql
-- Turns the note_embedding placeholder into a working vector column and
-- adds a cache table for trial embeddings.
--
-- Target: MySQL 8.0.33 (no native VECTOR type, so vectors are stored as
-- JSON arrays of floats and cosine similarity is computed in the API).
--
-- Run ONCE, after the main schema:
--   PowerShell: Get-Content sql\002_note_embeddings.sql | mysql -u root -p clinical_trial_matcher
--   bash/zsh:   mysql -u root -p clinical_trial_matcher < sql/002_note_embeddings.sql
--
-- Before running, check your column names:
--   DESCRIBE clinical_notes;
--   DESCRIBE trial_criterion;
-- If they differ from the defaults in src/lib/schema.ts, set the
-- matching variables in .env.local (see .env.example).
-- =====================================================================

USE clinical_trial_matcher;

-- ---------------------------------------------------------------------
-- 1. clinical_notes.note_embedding  ->  JSON vector column
-- ---------------------------------------------------------------------
-- The placeholder column holds no real vectors, so clear it first so the
-- type change cannot fail on non-JSON placeholder values.
UPDATE clinical_notes SET note_embedding = NULL;

ALTER TABLE clinical_notes
  MODIFY COLUMN note_embedding JSON NULL
    COMMENT 'Sentence embedding of the note text (JSON array of floats)',
  ADD COLUMN embedding_model VARCHAR(100) NULL
    COMMENT 'Model that produced note_embedding',
  ADD COLUMN embedding_dim SMALLINT UNSIGNED NULL
    COMMENT 'Number of dimensions in note_embedding',
  ADD COLUMN embedded_at TIMESTAMP NULL
    COMMENT 'When note_embedding was last generated',
  ADD CONSTRAINT chk_note_embedding_array
    CHECK (note_embedding IS NULL OR JSON_TYPE(note_embedding) = 'ARRAY');

-- Finding notes that still need embedding.
CREATE INDEX idx_notes_embedded_at ON clinical_notes (embedded_at);

-- ---------------------------------------------------------------------
-- 2. trial_embedding  ->  cached vector per clinical trial
-- ---------------------------------------------------------------------
-- Built from the trial title + inclusion criteria text. Exclusion
-- criteria are deliberately NOT embedded: text that matches an
-- exclusion criterion must not raise a patient's similarity score.
CREATE TABLE IF NOT EXISTS trial_embedding (
  trial_id      INT PRIMARY KEY,
  embedding     JSON NOT NULL,
  embedding_model VARCHAR(100) NOT NULL,
  embedding_dim SMALLINT UNSIGNED NOT NULL,
  source_hash   CHAR(64) NOT NULL
    COMMENT 'SHA-256 of the embedded text; re-embed when it changes',
  embedded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_trial_embedding_trial
    FOREIGN KEY (trial_id) REFERENCES clinical_trial (trial_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_trial_embedding_array
    CHECK (JSON_TYPE(embedding) = 'ARRAY')
);

-- ---------------------------------------------------------------------
-- 3. Access control
-- ---------------------------------------------------------------------
-- The app connects as DB_USER (clinician_app in .env.example). That
-- account must hold attending_clinician_role as an active default role:
--   GRANT 'attending_clinician_role' TO 'clinician_app'@'localhost';
--   SET DEFAULT ROLE 'attending_clinician_role' TO 'clinician_app'@'localhost';
-- If your app user gets privileges directly instead of via a role,
-- replace the role names below with 'clinician_app'@'localhost'.
-- Clinical note text and its embedding are patient data, so only the
-- clinician role may read them or write embeddings. The researcher role
-- keeps its existing denial on patient data.
GRANT SELECT ON clinical_trial_matcher.clinical_notes
  TO 'attending_clinician_role';
GRANT UPDATE (note_embedding, embedding_model, embedding_dim, embedded_at)
  ON clinical_trial_matcher.clinical_notes
  TO 'attending_clinician_role';
GRANT SELECT, INSERT, UPDATE ON clinical_trial_matcher.trial_embedding
  TO 'attending_clinician_role';
GRANT SELECT ON clinical_trial_matcher.trial_embedding
  TO 'clinical_researcher_role';
-- Writing semantic_score fires the existing match_result audit triggers.
GRANT UPDATE (semantic_score) ON clinical_trial_matcher.match_result
  TO 'attending_clinician_role';

-- ---------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------
-- DESCRIBE clinical_notes;
-- SHOW CREATE TABLE trial_embedding;
-- SELECT COUNT(*) AS total,
--        SUM(note_embedding IS NOT NULL) AS embedded
--   FROM clinical_notes;
-- SELECT note_id, embedding_model, embedding_dim,
--        JSON_LENGTH(note_embedding) AS dims, embedded_at
--   FROM clinical_notes WHERE note_embedding IS NOT NULL LIMIT 5;
