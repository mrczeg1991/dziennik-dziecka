// A vector at a *chosen* cosine similarity -- the one thing the integration harness could not
// express. `tests/integration/fixtures.ts`'s `SEARCH_ONE_HOT_EMBEDDING` is reused as both the
// seeded `embedding` and the `p_query_embedding` argument, so every similarity that harness can
// produce is either 1.0 or absent, which is exactly why its own comment says the one-hot vector
// clears `p_similarity_threshold` "regardless of how that default is later tuned". A threshold
// cannot be pinned from either side with only those two values available.
//
// This module lives outside `tests/integration/` on purpose. `fixtures.ts` reads the service-role
// key and is built on "absent credentials fail, they do not skip"; the math below has to be
// assertable with no database and no credentials at all, from `tests/unit/`. So the dependency
// runs one way -- `fixtures.ts` imports this, never the reverse.
//
// THE CONSTRUCTION. For unit vectors, cosine similarity is the dot product. With the query vector
// fixed at e1 = [1, 0, 0, ...], the vector [s, sqrt(1 - s^2), 0, ...] is itself a unit vector and
// its dot product with e1 is exactly `s`. pgvector's `<=>` is cosine *distance*, and `search_notes`
// compares `1 - distance` against the threshold, so what it recovers is `s`.
//
// `notes.embedding` is `extensions.vector(1536)`, which stores float4, so the value the database
// computes agrees with the requested one to roughly 1e-7 -- five orders of magnitude inside the
// 0.02 margins the threshold fixture straddles the floor with.

/** Matches `notes.embedding extensions.vector(1536)` and `text-embedding-3-small`'s native size. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * e1 -- the query vector every `gradedVector` similarity is expressed against. Pass this as
 * `p_query_embedding` and a note seeded with `gradedVector(s)` has cosine similarity `s` to the
 * query. It is the same vector as `SEARCH_ONE_HOT_EMBEDDING`, which is harmless: the two are used
 * on different children, and `search_notes` is always scoped by `p_child_id`.
 */
export const GRADED_QUERY_VECTOR: number[] = buildGradedVector(1);

/**
 * A 1536-element unit vector whose cosine similarity to `GRADED_QUERY_VECTOR` is `similarity`.
 *
 * Rejects anything outside [-1, 1] rather than clamping: a caller asking for a similarity cosine
 * cannot express has made a mistake, and silently seeding a different vector than the one asked for
 * would make the test that depends on it pass or fail for an unrelated reason.
 */
export function gradedVector(similarity: number): number[] {
  if (!Number.isFinite(similarity) || similarity < -1 || similarity > 1) {
    throw new Error(`cosine similarity must be a finite number in [-1, 1]; received ${similarity}`);
  }
  return buildGradedVector(similarity);
}

// Split out so `GRADED_QUERY_VECTOR` can be built at module scope without the exported function's
// validation running before its own declaration is initialized.
function buildGradedVector(similarity: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = similarity;
  // Math.max guards the one case floating point can produce: for |similarity| at exactly 1,
  // 1 - similarity * similarity can round a hair below zero, and Math.sqrt of that is NaN.
  vector[1] = Math.sqrt(Math.max(0, 1 - similarity * similarity));
  return vector;
}
