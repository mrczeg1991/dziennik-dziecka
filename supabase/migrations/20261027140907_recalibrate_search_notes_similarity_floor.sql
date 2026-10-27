-- Replaces search_notes to put a measured number under the vector arm's relevance floor:
-- `p_similarity_threshold`'s default moves from 0.5 to 0.434. Nothing else changes.
--
-- 20261020200647_tune_search_notes_rrf_relevance.sql introduced that floor on the RRF branch and
-- closed with a warning about its own constant -- 0.5 had never been measured against this
-- project's real Polish, abbreviated notes, and change 1 of that migration is what made the number
-- start deciding what a parent sees on the common no-date-range path. The warning named the
-- symptom precisely, and the symptom happened: `Czy dostawał Nurofenu w lipcu?` returned
-- "Brak notatek pasujących do pytania." over a note reading "Gorączka 39,1 wieczorem. Nurofen 5 ml
-- o 21:00." An inflected question form costs 0.12-0.20 of cosine similarity against base-form note
-- text and a recognized period phrase another 0.03-0.07, while `to_tsvector('simple', ...)` does no
-- Polish stemming -- so for an inflected keyword the vector arm is the ONLY arm that can match, and
-- 0.5 sat inside the band where the matches live.
--
-- WHERE 0.434 COMES FROM. A corpus committed to the repository, so anyone can re-derive it rather
-- than take this number on trust: `supabase/seed.sql` (26 notes, two children, `occurred_at` spread
-- over 2026-02-03 .. 2026-10-12, every one embedded with text-embedding-3-small), measured by
-- `scripts/measure-similarity.mjs` against a frozen set of 18 Polish questions whose expected note
-- was written down before the first value was read. The full question x note table, the sweep and
-- the derivation live in context/changes/note-search-similarity-floor/change.md (`## Pomiar`).
--
-- Bands counted the way this function actually filters -- within one child, since every call is
-- scoped by `p_child_id`:
--
--     true positives    37 pairs    0.247 .. 0.640
--     true negatives   245 pairs   -0.003 .. 0.481
--     overlap                       0.247 .. 0.481   (width 0.234)
--
-- THE BANDS OVERLAP. There is no empty gap to take a midpoint of, and a value just under the
-- lowest true positive (0.247) would admit 142 of 468 measured values -- functionally no floor at
-- all, and the one thing this change ruled out from the start. So the value sits in the single gap
-- of width >= 0.008 anywhere inside the decision window 0.390 .. 0.470: 0.430 -> 0.438, midpoint
-- 0.434. Every other pair of values in that window stands 0.001-0.006 apart. The 0.004 margin on
-- each side holds against the endpoint's own non-determinism, which is real and was measured
-- rather than assumed: over three full runs -- two that chose the value and one that re-measured
-- it after `db reset` + `backfill:embeddings` had recomputed every note vector as well -- 455 of
-- 468 values are identical to three decimals, the largest drift in any single value is 0.002, and
-- every value inside 0.426 .. 0.442 (the gap plus a margin either side) reproduced exactly. So no
-- re-measurement moves the decision across this boundary.
--
-- WHAT IT BUYS, AND WHAT IT COSTS. Recall is favoured by decision: the parent would rather scan
-- one extra note than miss the one they were looking for, the RRF branch truncates to
-- `p_match_count` anyway, and the date-bound branch's contract is completeness.
--
--     answerable questions returning at least one right note    13/15   (was 8/15)
--     questions returning the single expected note              11/15   (was 6/15)
--     true negatives admitted                                   13 across 21 question x child scopes
--
-- Because the bands overlap, that admitted count is part of the number's provenance, not a
-- footnote. Eleven of the thirteen sit BELOW a true positive in the same result, so the parent
-- still reads the right note first; the other two belong to the one question the corpus
-- deliberately does not answer, which now returns a single irrelevant note instead of the
-- empty-result message. Two true positives stay below the floor and are left there knowingly:
-- `Czy uderzył się w głowę?` (0.402 -- reachable only by dropping to 0.40, which raises admitted
-- noise from 13 to 32 and puts the constant where values stand 0.001 apart, i.e. chosen on noise)
-- and `Co z uchem?` (0.347, with a true negative ranking ABOVE it -- a ranking problem in the
-- embedding of a short elliptical question, which no position of this threshold can fix).
--
-- `tests/integration/notes-search.test.ts` now seeds two notes straddling this value at +/-0.02 on
-- a child of their own, so moving the default in either direction turns that suite red.
-- `scripts/measure-similarity.mjs`'s CURRENT_THRESHOLD moves with this default in the same commit,
-- as its own header requires.
--
-- Everything else -- the 8-parameter signature apart from this one default, the date-bound branch,
-- all five CTEs, the index-friendly top-k shape that lets notes_embedding_hnsw_idx serve the
-- semantic arm, the ordering, SECURITY INVOKER, and the reliance on public.notes's RLS as the only
-- isolation boundary -- is unchanged from 20261020200647_tune_search_notes_rrf_relevance.sql.
create or replace function public.search_notes(
  p_child_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536),
  p_date_start timestamp default null,
  p_date_end timestamp default null,
  p_match_count int default 10,
  p_rrf_k int default 50,
  p_similarity_threshold float default 0.434
)
returns table (
  id uuid,
  content text,
  occurred_at timestamp,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
as $$
  with
  full_text as (
    select
      n.id,
      row_number() over (
        order by ts_rank_cd(n.fts, websearch_to_tsquery('simple', public.immutable_unaccent(p_query_text)), 32) desc
      ) as rank_ix
    from public.notes n
    where n.child_id = p_child_id
      and n.deleted_at is null
      and n.fts @@ websearch_to_tsquery('simple', public.immutable_unaccent(p_query_text))
  ),
  semantic as (
    select
      top_k.id,
      row_number() over (order by top_k.distance) as rank_ix
    from (
      select
        n.id,
        n.embedding <=> p_query_embedding as distance
      from public.notes n
      where n.child_id = p_child_id
        and n.deleted_at is null
        and n.embedding is not null
        and p_query_embedding is not null
      order by n.embedding <=> p_query_embedding
      limit greatest(p_match_count * 10, 100)
    ) top_k
    where 1 - top_k.distance >= p_similarity_threshold
  ),
  rrf_candidates as (
    select
      n.id,
      n.content,
      n.occurred_at,
      n.created_at,
      n.updated_at,
      (coalesce(1.0 / (p_rrf_k + full_text.rank_ix), 0.0)
        + coalesce(1.0 / (p_rrf_k + semantic.rank_ix), 0.0))::double precision as combined_score
    from full_text
    full outer join semantic on full_text.id = semantic.id
    join public.notes n on n.id = coalesce(full_text.id, semantic.id)
    where p_date_start is null or p_date_end is null
    order by combined_score desc
    limit p_match_count
  ),
  date_range_candidates as (
    select
      n.id,
      n.content,
      n.occurred_at,
      n.created_at,
      n.updated_at
    from public.notes n
    where n.child_id = p_child_id
      and n.deleted_at is null
      and p_date_start is not null
      and p_date_end is not null
      and n.occurred_at >= p_date_start
      and n.occurred_at < p_date_end
      and (
        n.fts @@ websearch_to_tsquery('simple', public.immutable_unaccent(p_query_text))
        or
        (
          n.embedding is not null
          and p_query_embedding is not null
          and 1 - (n.embedding <=> p_query_embedding) >= p_similarity_threshold
        )
      )
  ),
  combined as (
    select id, content, occurred_at, created_at, updated_at, combined_score, 0 as branch
    from rrf_candidates
    union all
    select id, content, occurred_at, created_at, updated_at, null::float as combined_score, 1 as branch
    from date_range_candidates
  )
  select id, content, occurred_at, created_at, updated_at
  from combined
  order by
    case when branch = 0 then combined_score end desc,
    case when branch = 1 then occurred_at end asc
$$;
