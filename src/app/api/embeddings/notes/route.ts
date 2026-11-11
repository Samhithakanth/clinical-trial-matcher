import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { schema } from "@/lib/schema";
import { compact, embedText, embeddingModelName, EMBEDDING_DIM } from "@/lib/embeddings";

// ONNX embedding runtime needs Node.js; always run against live data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { table, id, text } = schema.notes;

// GET /api/embeddings/notes -> how many notes have embeddings
export async function GET() {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(note_embedding IS NOT NULL) AS embedded,
              GROUP_CONCAT(DISTINCT embedding_model) AS models
         FROM ${table}`,
    );
    const { total, embedded, models } = rows[0];
    return NextResponse.json({
      success: true,
      total: Number(total),
      embedded: Number(embedded ?? 0),
      pending: Number(total) - Number(embedded ?? 0),
      models: models ? String(models).split(",") : [],
      activeModel: embeddingModelName(),
    });
  } catch (error) {
    console.error("Embedding status error:", error);
    return NextResponse.json(
      { success: false, message: "Unable to read embedding status. Has sql/002_note_embeddings.sql been run?" },
      { status: 500 },
    );
  }
}

// POST /api/embeddings/notes?limit=100&force=false
// Generates note_embedding for notes that have none (or all notes with
// force=true, e.g. after switching models). Call repeatedly until pending = 0.
export async function POST(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 1000);
  const force = params.get("force") === "true";
  const model = embeddingModelName();

  try {
    const [notes] = await pool.query<RowDataPacket[]>(
      `SELECT ${id} AS note_id, ${text} AS note_text
         FROM ${table}
        WHERE ${text} IS NOT NULL
          AND (? OR note_embedding IS NULL OR embedding_model <> ?)
        ORDER BY ${id}
        LIMIT ?`,
      [force, model, limit],
    );

    let embedded = 0;
    const failed: Array<{ note_id: unknown; error: string }> = [];

    for (const note of notes) {
      try {
        const vector = compact(await embedText(String(note.note_text)));
        await pool.query(
          `UPDATE ${table}
              SET note_embedding = CAST(? AS JSON),
                  embedding_model = ?, embedding_dim = ?, embedded_at = NOW()
            WHERE ${id} = ?`,
          [JSON.stringify(vector), model, EMBEDDING_DIM, note.note_id],
        );
        embedded++;
      } catch (err) {
        failed.push({ note_id: note.note_id, error: (err as Error).message });
        if (failed.length >= 5 && embedded === 0) break; // model/DB is down
      }
    }

    const [left] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending FROM ${table}
        WHERE ${text} IS NOT NULL
          AND (note_embedding IS NULL OR embedding_model <> ?)`,
      [model],
    );

    return NextResponse.json({
      success: failed.length === 0,
      model,
      processed: notes.length,
      embedded,
      failed,
      pending: Number(left[0].pending),
    });
  } catch (error) {
    console.error("Embedding generation error:", error);
    return NextResponse.json(
      { success: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}
