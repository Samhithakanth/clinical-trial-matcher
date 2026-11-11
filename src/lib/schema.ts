// Column names used by the embedding pipeline. The defaults follow the
// project report; override any of them in .env.local if your deployed
// schema differs (check with DESCRIBE clinical_notes / trial_criterion).

function ident(envName: string, fallback: string): string {
  const value = process.env[envName] || fallback;
  // Identifiers cannot be bound as SQL parameters, so only allow plain
  // names to rule out SQL injection through configuration.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${envName} must be a plain column name, got "${value}"`);
  }
  return value;
}

export const schema = {
  notes: {
    table: "clinical_notes",
    id: ident("NOTES_ID_COLUMN", "note_id"),
    subject: ident("NOTES_SUBJECT_COLUMN", "subject_id"),
    text: ident("NOTES_TEXT_COLUMN", "note_text"),
  },
  criterion: {
    table: "trial_criterion",
    trial: ident("CRITERION_TRIAL_COLUMN", "trial_id"),
    text: ident("CRITERION_TEXT_COLUMN", "criterion_text"),
    type: ident("CRITERION_TYPE_COLUMN", "criterion_type"),
    inclusionValue: process.env.CRITERION_INCLUSION_VALUE || "INCLUSION",
  },
};
