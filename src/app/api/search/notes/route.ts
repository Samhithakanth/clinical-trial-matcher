import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { schema } from "@/lib/schema";
import { cosineSimilarity, embedText, embeddingModelName, parseVector } from "@/lib/embeddings";

// ONNX embedding runtime needs Node.js; always run against live data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { table, id, subject, text } = schema.notes;

// GET /api/search/notes?q=type 2 diabetes on metformin&k=5[&trial_id=3]
// Semantic search over clinical notes: embeds the query (or a trial's
// cached embedding when trial_id is given) and ranks notes by cosine
// similarity. Brute-force scan, which is fine at prototype scale.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  const trialId = params.get("trial_id");
  const k = Math.min(Math.max(Number(params.get("k")) || 5, 1), 50);
  const model = embeddingModelName();

  if (!q && !trialId) {
    return NextResponse.json(
      { success: false, message: "Provide ?q=<text> or ?trial_id=<id>." },
      { status: 400 },
    );
  }

  try {
    let queryVector: number[] | null;
    if (trialId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT embedding FROM trial_embedding WHERE trial_id = ? AND embedding_model = ?`,
        [trialId, model],
      );
      queryVector = rows.length ? parseVector(rows[0].embedding) : null;
      if (!queryVector) {
        return NextResponse.json(
          { success: false, message: "No embedding for this trial yet. POST /api/matches/semantic-score first." },
          { status: 404 },
        );
      }
    } else {
      queryVector = await embedText(q!);
    }

    // Only compare vectors from the same model: different models live in
    // different vector spaces.
    const [notes] = await pool.query<RowDataPacket[]>(
      `SELECT ${id} AS note_id, ${subject} AS subject_id,
              LEFT(${text}, 200) AS snippet, note_embedding
         FROM ${table}
        WHERE note_embedding IS NOT NULL AND embedding_model = ?`,
      [model],
    );

    const results = notes
      .map((n) => ({
        note_id: n.note_id,
        subject_id: n.subject_id,
        snippet: n.snippet,
        similarity: cosineSimilarity(queryVector!, parseVector(n.note_embedding) ?? []),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k)
      .map((r) => ({ ...r, similarity: Math.round(r.similarity * 10000) / 10000 }));

    return NextResponse.json({
      success: true,
      model,
      query: q ?? null,
      trial_id: trialId ? Number(trialId) : null,
      searched: notes.length,
      results,
    });
  } catch (error) {
    console.error("Semantic search error:", error);
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
