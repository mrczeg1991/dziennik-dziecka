import { OPENAI_API_KEY } from "astro:env/server";

const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";

// A stalled connection is accepted and then never answers, so it never rejects and the
// catch below never runs -- the Worker would be killed by the platform wall clock first,
// taking the parent's unsaved note with it. AbortSignal.timeout rejects, which is what
// routes a stall into the `null` degradation the rest of this module promises.
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Computes an embedding for `text` via OpenAI's embeddings endpoint. Degrades to `null`
 * on missing configuration, a non-OK response, or a thrown error — the same contract
 * `createClient()` (`src/lib/supabase.ts`) uses for a missing configuration — so every
 * caller already knows how to handle it: a note's save never depends on, or is blocked
 * by, this call succeeding.
 *
 * `text-embedding-3-small` returns 1536 dimensions natively, which is what
 * `notes.embedding extensions.vector(1536)` expects; no truncation is applied.
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) {
    return null;
  }

  try {
    const response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { data?: { embedding?: number[] }[] };
    const embedding = body.data?.[0]?.embedding;
    return embedding ?? null;
  } catch {
    return null;
  }
}
