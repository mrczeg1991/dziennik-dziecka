-- Replaces search_notes to drop the text-rank threshold from the date-bound branch.
--
-- The previous body compared one parameter, `p_similarity_threshold`, against two
-- incomparable scales: cosine similarity (`1 - (embedding <=> q)`, which spans [0,1]
-- and for which 0.5 is a sensible floor) and `ts_rank_cd(..., 32)`, whose normalized
-- values on this project's actual note text measure 0.048-0.091. A single matching
-- term in a short Polish note scores 0.0909. The text arm of the date-bound branch
-- therefore never cleared 0.5 and never contributed a row, making that branch
-- vector-only in practice: a question naming a period returned nothing at all when
-- the embedding call had degraded to null, and silently skipped any note written
-- before the embedding backfill even on a verbatim word match.
--
-- The window is already the hard filter in this branch, and the branch's whole
-- purpose is completeness — "every matching note in the interval, not just the few
-- most similar". A relevance floor contradicts that purpose at any value, so the
-- threshold is removed rather than retuned; `n.fts @@ websearch_to_tsquery(...)`
-- (a match/no-match test, not a score) is the text condition. Ranking sharpness for
-- exact-word questions is slice S-04's job, not this branch's.
--
-- `p_similarity_threshold` keeps its name, signature position and default. It now
-- governs the vector arm only, which is the one scale it was ever valid against.
-- Everything else — the signature, the RRF branch, the ordering, SECURITY INVOKER,
-- and the reliance on `public.notes`'s RLS as the only isolation boundary — is
-- unchanged from 20261017103503_create_search_notes_function.sql; see that file's
-- header for the full design rationale.
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
