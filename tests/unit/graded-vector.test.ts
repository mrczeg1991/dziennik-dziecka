// The math under `tests/support/graded-vector.ts`, asserted in the only seat that can block a
// deploy: `npm run gates` runs the unit suite's count through `gate:scope`, while the integration
// suite that *uses* this helper runs only in the advisory smoke job. If the construction were
// wrong, the threshold assertions in `tests/integration/notes-search.test.ts` would be comparing
// the floor against a similarity nobody had checked -- green for the wrong reason.
//
// Follows `tests/unit/wall-clock.test.ts` (the reference unit test, §6.2 of
// context/foundation/test-plan.md): helpers imported explicitly rather than via Vitest globals,
// and every expectation derived from the definition of cosine similarity rather than from running
// the function under test.
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, GRADED_QUERY_VECTOR, gradedVector } from "../support/graded-vector";

// Written out here rather than imported, deliberately: this is the independent definition the
// helper is held to. Normalizing both sides means the assertion checks the *cosine*, not the dot
// product of two vectors assumed to be unit length -- so "the helper returns a unit vector" has to
// be asserted separately, and is, below.
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

// The two the threshold fixture actually seeds (0.434 +/- 0.02, see `SEARCH_FIXTURE`), the two
// boundaries the plan names, a negative value, and a couple in between. Every one is a similarity
// the database will have to reproduce, so each is checked here first.
const SIMILARITIES = [1, 0.9, 0.454, 0.434, 0.414, 0.25, 0, -0.5, -1];

describe("gradedVector", () => {
  it("returns a vector of the stored embedding's dimension", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
    expect(gradedVector(0.5)).toHaveLength(1536);
  });

  for (const similarity of SIMILARITIES) {
    it(`has cosine similarity ${similarity} to the query vector`, () => {
      // 1e-12, not Vitest's default `toBeCloseTo` precision: the construction is exact in real
      // arithmetic, so the only error here is IEEE-754 rounding in sqrt and the dot product. The
      // float4 truncation that `vector(1536)` adds (~1e-7) happens in the database, not here.
      expect(cosine(gradedVector(similarity), GRADED_QUERY_VECTOR)).toBeCloseTo(similarity, 12);
    });

    it(`returns a unit vector at similarity ${similarity}`, () => {
      // Unit length is what makes the similarity readable off the first element at all, and it is
      // what keeps the value stable under pgvector's own normalization.
      expect(norm(gradedVector(similarity))).toBeCloseTo(1, 12);
    });
  }

  it("puts the whole vector in the first element at similarity 1", () => {
    // The upper boundary: sqrt(1 - 1) is 0, so the result is e1 itself -- identical to the query
    // vector. Asserted explicitly because this is the case where a naive sqrt can return NaN.
    const vector = gradedVector(1);
    expect(vector[0]).toBe(1);
    expect(vector[1]).toBe(0);
    expect(vector).toStrictEqual(GRADED_QUERY_VECTOR);
  });

  it("is orthogonal to the query vector at similarity 0", () => {
    // The lower boundary of the range that matters: no component along e1 at all.
    const vector = gradedVector(0);
    expect(vector[0]).toBe(0);
    expect(vector[1]).toBe(1);
  });

  it("leaves every dimension past the second at zero", () => {
    // The vector has to be sparse in exactly this way for the first-element reading to hold.
    expect(
      gradedVector(0.454)
        .slice(2)
        .every((value) => value === 0),
    ).toBe(true);
  });

  it("rejects a similarity cosine cannot express", () => {
    // Clamping would seed a note at a similarity other than the one the fixture asked for, which
    // is the silent direction: the threshold assertion would still be green, against the wrong
    // vector.
    expect(() => gradedVector(1.0001)).toThrow(/\[-1, 1\]/);
    expect(() => gradedVector(-1.0001)).toThrow(/\[-1, 1\]/);
    expect(() => gradedVector(Number.NaN)).toThrow(/\[-1, 1\]/);
    expect(() => gradedVector(Number.POSITIVE_INFINITY)).toThrow(/\[-1, 1\]/);
  });
});

describe("GRADED_QUERY_VECTOR", () => {
  it("is the one-hot vector the similarities are expressed against", () => {
    expect(GRADED_QUERY_VECTOR).toHaveLength(1536);
    expect(GRADED_QUERY_VECTOR[0]).toBe(1);
    expect(GRADED_QUERY_VECTOR.slice(1).every((value) => value === 0)).toBe(true);
  });

  it("has cosine similarity 1 to itself", () => {
    expect(cosine(GRADED_QUERY_VECTOR, GRADED_QUERY_VECTOR)).toBeCloseTo(1, 12);
  });
});
