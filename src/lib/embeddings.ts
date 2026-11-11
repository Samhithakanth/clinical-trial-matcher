import { createHash } from "node:crypto";

// ---------------------------------------------------------------------
// Embedding providers
//   transformers (default): all-MiniLM-L6-v2 sentence-transformer run
//     locally in Node via @huggingface/transformers (ONNX). 384 dims.
//     No API key; note text never leaves the machine. The model (~23 MB)
//     downloads once on first use and is cached.
//   hash: dependency-free feature hashing of words and word pairs into
//     384 dims. Lexical (keyword overlap), not semantic. Use only when
//     the model cannot be downloaded, e.g. offline demos and tests.
// ---------------------------------------------------------------------

export const EMBEDDING_DIM = 384;
const PROVIDER = process.env.EMBEDDING_PROVIDER || "transformers";
const MODEL_ID = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";

// MiniLM truncates input at 256 tokens. Long clinical notes are split into
// word windows, embedded separately and averaged so the whole note counts.
const WORDS_PER_CHUNK = 180;
const MAX_CHUNKS = 20;

export function embeddingModelName(): string {
  return PROVIDER === "hash" ? `hash-${EMBEDDING_DIM}` : MODEL_ID;
}

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - optional dependency, installed with npm install
      const { pipeline } = await import("@huggingface/transformers");
      return (await pipeline("feature-extraction", MODEL_ID)) as Extractor;
    })().catch((err) => {
      extractorPromise = null; // allow a retry after a failed download
      throw err;
    });
  }
  return extractorPromise;
}

export function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  return norm === 0 ? vec.map(() => 0) : vec.map((v) => v / norm);
}

export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const out = new Array<number>(vectors[0].length).fill(0);
  for (const vec of vectors) for (let i = 0; i < out.length; i++) out[i] += vec[i];
  return out.map((v) => v / vectors.length);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Maps cosine similarity to the [0, 1] range required by match_result. */
export function toScore(cosine: number): number {
  return Math.round(Math.min(1, Math.max(0, cosine)) * 10000) / 10000;
}

export function chunkText(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length && chunks.length < MAX_CHUNKS; i += WORDS_PER_CHUNK) {
    chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(" "));
  }
  return chunks;
}

function hashEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const features = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`)];
  for (const feature of features) {
    const h = createHash("md5").update(feature).digest();
    const index = h.readUInt32LE(0) % EMBEDDING_DIM;
    vec[index] += h[4] & 1 ? 1 : -1; // signed hashing reduces collision bias
  }
  return normalize(vec);
}

/** Embeds one document (any length). Returns a unit-length vector. */
export async function embedText(text: string): Promise<number[]> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return new Array<number>(EMBEDDING_DIM).fill(0);
  if (PROVIDER === "hash") return normalize(meanVector(chunks.map(hashEmbed)));

  const extractor = await getExtractor();
  const output = await extractor(chunks, { pooling: "mean", normalize: true });
  return normalize(meanVector(output.tolist()));
}

/** Rounds to 6 decimals so the stored JSON stays compact. */
export function compact(vec: number[]): number[] {
  return vec.map((v) => Math.round(v * 1e6) / 1e6);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** mysql2 returns JSON columns as parsed values; older setups return strings. */
export function parseVector(value: unknown): number[] | null {
  if (value == null) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? (parsed as number[]) : null;
}
