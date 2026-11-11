import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { schema } from "@/lib/schema";
import {
  compact,
  cosineSimilarity,
  embedText,
  embeddingModelName,
  EMBEDDING_DIM,
  meanVector,
  parseVector,
  sha256,
  toScore,
} from "@/lib/embeddings";

// ONNX embedding runtime needs Node.js; always run against live data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notes = schema.notes;
const crit = schema.criterion;

/** Returns the trial's vector, (re)embedding title + inclusion criteria if needed. */
async function getTrialVector(trialId: number, model: string): Promise<number[] | null> {
  const [trialRows] = await pool.query<RowDataPacket[]>(
    `SELECT title FROM clinical_trial WHERE trial_id = ?`,
    [trialId],
  );
  if (!trialRows.length) return null;

  const [criteria] = await pool.query<RowDataPacket[]>(
    `SELECT ${crit.text} AS criterion_text
       FROM ${crit.table}
      WHERE ${crit.trial} = ? AND UPPER(${crit.type}) = UPPER(?)
      ORDER BY 1`,
    [trialId, crit.inclusionValue],
  );

  const sourceText = [trialRows[0].title, ...criteria.map((c) => c.criterion_text)]
    .filter(Boolean)
    .join(". ");
  const sourceHash = sha256(`${model}\n${sourceText}`);

  const [cached] = await pool.query<RowDataPacket[]>(
    `SELECT embedding FROM trial_embedding WHERE trial_id = ? AND source_hash = ?`,
    [trialId, sourceHash],
  );
  if (cached.length) return parseVector(cached[0].embedding);

  const vector = compact(await embedText(sourceText));
  await pool.query(
    `INSERT INTO trial_embedding (trial_id, embedding, embedding_model, embedding_dim, source_hash)
     VALUES (?, CAST(? AS JSON), ?, ?, ?)
     ON DUPLICATE KEY UPDATE embedding = VALUES(embedding),
       embedding_model = VALUES(embedding_model),
       embedding_dim = VALUES(embedding_dim),
       source_hash = VALUES(source_hash)`,
    [trialId, JSON.stringify(vector), model, EMBEDDING_DIM, sourceHash],
  );
  return vector;
}

/** Patient vector = mean of that patient's note embeddings (same model). */
async function getPatientVector(subjectId: number, model: string): Promise<number[] | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT note_embedding FROM ${notes.table}
      WHERE ${notes.subject} = ? AND note_embedding IS NOT NULL AND embedding_model = ?`,
    [subjectId, model],
  );
  const vectors = rows.map((r) => parseVector(r.note_embedding)).filter((v): v is number[] => !!v);
  return vectors.length ? meanVector(vectors) : null;
}

// POST /api/matches/semantic-score            -> all matches
// POST /api/matches/semantic-score?match_id=5 -> one match
// Writes match_result.semantic_score = clamp(cosine(patient, trial), 0, 1).
// eligibility_status is NOT changed: the rule-based evaluate_match
// procedure remains the eligibility decision; semantic_score is a ranking
// signal for clinician review. Updates fire the existing audit triggers.
export async function POST(request: NextRequest) {
  const matchId = request.nextUrl.searchParams.get("match_id");
  const model = embeddingModelName();

  try {
    const [matches] = await pool.query<RowDataPacket[]>(
      `SELECT match_id, subject_id, trial_id FROM match_result
        ${matchId ? "WHERE match_id = ?" : ""} ORDER BY match_id`,
      matchId ? [matchId] : [],
    );

    const trialCache = new Map<number, number[] | null>();
    const patientCache = new Map<number, number[] | null>();
    const results: Array<Record<string, unknown>> = [];

    for (const m of matches) {
      if (!trialCache.has(m.trial_id)) trialCache.set(m.trial_id, await getTrialVector(m.trial_id, model));
      if (!patientCache.has(m.subject_id)) patientCache.set(m.subject_id, await getPatientVector(m.subject_id, model));
      const trialVec = trialCache.get(m.trial_id);
      const patientVec = patientCache.get(m.subject_id);

      if (!trialVec || !patientVec) {
        results.push({
          match_id: m.match_id,
          semantic_score: null,
          skipped: !patientVec ? "patient has no embedded notes" : "trial not found",
        });
        continue;
      }

      const score = toScore(cosineSimilarity(patientVec, trialVec));
      await pool.query(`UPDATE match_result SET semantic_score = ? WHERE match_id = ?`, [score, m.match_id]);
      results.push({ match_id: m.match_id, subject_id: m.subject_id, trial_id: m.trial_id, semantic_score: score });
    }

    return NextResponse.json({
      success: true,
      model,
      scored: results.filter((r) => r.semantic_score !== null).length,
      skipped: results.filter((r) => r.semantic_score === null).length,
      results,
    });
  } catch (error) {
    console.error("Semantic scoring error:", error);
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
