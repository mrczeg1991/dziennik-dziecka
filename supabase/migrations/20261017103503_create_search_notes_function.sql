-- search_notes: the one ranking function both the write path (none — this is
-- read-only) and the question UI call through the session-scoped client.
--
-- SECURITY INVOKER (the `language sql` default) and no ownership check in
-- the body: `public.notes`'s own RLS policies already restrict every row
-- this function can select to the calling account, exactly as `listNotes`
-- relies on today (see `src/lib/notes.ts`). `p_child_id` is a correctness
-- filter — it narrows the result to one child — never a security boundary;
-- the research confirmed that chaining `.eq()` after `.rpc()` only filters
-- the function's output *after* its own ranking/limit already ran, which is
-- exactly why `p_child_id` is a parameter of the function itself instead.
--
-- Two ranking modes, selected by whether a date range was recognized by the
-- caller (both parameters non-null) or not:
--   * no date range — Reciprocal Rank Fusion over the text-search rank and
--     the vector-similarity rank, top `p_match_count` rows.
--   * date range present — every row in the window whose text-rank or
--     vector-similarity clears `p_similarity_threshold` is returned, ordered
--     chronologically, with no top-N truncation.
--
-- `p_similarity_threshold = 0.5` and `p_rrf_k = 50` (Supabase's own
-- hybrid-search guide default, not the RRF paper's 60) are unvalidated
-- defaults, not measured values — real match quality against this project's
-- actual Polish, abbreviated notes is an open unknown the roadmap carries
-- (owner: user). Both are named parameters specifically so they are cheap to
-- retune once real usage exists; do not hard-code them elsewhere.
--
-- `language sql` has no branching construct, so the two modes are expressed
-- as two mutually-exclusive CTEs (each guarded by the same date-range
-- null-check, so only one ever produces rows for a given call) unioned
-- together, with the final ordering decided by an outer CASE over which
-- branch actually produced the row — never by relying on a sub-select's own
-- ORDER BY surviving a UNION ALL unordered.
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
      n.id,
      row_number() over (order by n.embedding <=> p_query_embedding) as rank_ix
    from public.notes n
    where n.child_id = p_child_id
      and n.deleted_at is null
      and n.embedding is not null
      and p_query_embedding is not null
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
        (
          n.fts @@ websearch_to_tsquery('simple', public.immutable_unaccent(p_query_text))
          and ts_rank_cd(n.fts, websearch_to_tsquery('simple', public.immutable_unaccent(p_query_text)), 32) >= p_similarity_threshold
        )
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
