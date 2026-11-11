# TrialMatch – Clinical Trial Matcher

Next.js + MySQL dashboard for patients, clinical trials, match results, and audit history.

## Setup (Windows PowerShell)
1. Extract the ZIP and open PowerShell in `TrialMatch_Complete`.
2. Run `npm install`.
3. Run `Copy-Item .env.example .env.local`.
4. Edit `.env.local` with your MySQL credentials. Never share or commit this file.
5. Ensure MySQL80 is running, then run `npm run dev`.
6. Open http://localhost:3000.

## Pages
`/` Dashboard · `/patients` Patients · `/clinical-trials` Clinical Trials · `/matches` Match Results · `/audit` Audit Logs.

## Database tables/columns expected
- `patients`: subject_id, gender, anchor_age, anchor_year, anchor_year_group, unit_id
- `clinical_trial`: trial_id, nct_id, title, phase, status, conditions, minimum_age, maximum_age, sex, enrollment
- `match_result`: match_id, subject_id, trial_id, scalar_score, semantic_score, final_score, eligibility_status, matched_at
- `audit_log`: audit_id, table_name, record_id, action_type, changed_by, action_time, old_values, new_values

The API uses the singular core tables. The MySQL account needs SELECT on these tables; Audit Logs also needs SELECT on `audit_log`.

## Scope note
This UI displays values stored in MySQL. It does not generate embeddings or calculate semantic/final scores. NULL scores display as “Not calculated”. Audit logs are trace records, not tamper-proof against a privileged database administrator.
