-- Replaces search_notes to give the no-date-range (RRF) branch a relevance floor, and to let the
-- HNSW index actually serve the semantic arm.
--
-- !! UNVALIDATED BEHAVIOR CHANGE -- see the warning at the end of this comment before deploying.
--
-- Two changes, both confined to the `semantic` CTE:
--
-- 1. Relevance floor (was: none). The CTE admitted every embedded note of the child, so RRF
--    always returned min(p_match_count, note_count) rows regardless of relevance: for a child
--    with six notes, any question whatsoever returned all six, and the UI's
--    "Brak notatek pasujących do pytania." was unreachable except for a child with no notes.
--    The arm is now gated on `1 - distance >= p_similarity_threshold`, which makes the RRF branch
--    symmetric with the date-bound branch (where that same parameter has always governed the
--    vector arm) rather than each branch having its own unstated rule.
--
-- 2. Index-friendly top-k (was: a window function over every row). `p_match_count` was applied
--    only in `rrf_candidates`, after row_number() had already ranked the child's entire embedded
--    set, so notes_embedding_hnsw_idx could not be used -- pgvector needs the
--    `order by <=> ... limit n` shape to use an HNSW index. The ordering and limit now sit in an
--    inner subquery and row_number() runs over its result, so the index can serve the scan. The
--    limit is deliberately much larger than p_match_count: RRF fuses this arm's *rank* with the
--    text arm's, so the candidate pool must stay wide enough that fusion still has something to
--    reorder.
--
-- Everything else -- the signature, the date-bound branch, the full_text CTE, the ordering,
-- SECURITY INVOKER, and the reliance on public.notes's RLS as the only isolation boundary -- is
-- unchanged from 20261019215004_fix_search_notes_text_threshold.sql.
--
-- WARNING, and the reason this migration is worth a second look before it reaches production:
-- p_similarity_threshold's 0.5 default has never been measured against this project's real
-- Polish, abbreviated notes -- the roadmap carries that as an open unknown (owner: user), and
-- change 1 above is the first thing that makes the number actually decide what a parent sees on
-- the common no-date-range path. If 0.5 turns out to be too strict for text-embedding-3-small on
-- short Polish text, the symptom is a question returning "Brak notatek pasujących do pytania."
-- for a note that plainly matches -- worse for a parent than the over-broad results this
-- replaces. Validate against real notes and lower the default if needed before relying on it.
create or replace function public.search_notes(
  p_child_id uuid,
  p_query_text text,
  p_query_embedding extensions.vector(1536),
  p_date_start timestamp default null,
  p_date_end timestamp default null,
  p_match_count int default 10,
  p_rrf_k int default 50,
  p_similarity_threshold float default 0.5
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
