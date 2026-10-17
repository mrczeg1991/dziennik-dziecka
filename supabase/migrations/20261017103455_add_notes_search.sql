-- Search foundation for FR-006 (note-search-by-meaning): enables the two
-- extensions the ranking function needs, adds the semantic (vector) and
-- exact-text (tsvector) search surfaces to `notes`, and indexes both.
--
-- Supabase installs extensions into the `extensions` schema, not `public`
-- (confirmed in `context/changes/fr-006-research/research.md:70`) — every
-- reference below is schema-qualified for exactly that reason.
create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;

-- `extensions.unaccent` is STABLE, not IMMUTABLE (its behavior depends on the
-- installed dictionary), but a generated column's expression — and any index
-- on one — requires IMMUTABLE. This thin wrapper is the standard fix: it
-- pins the dictionary by name so Postgres accepts the immutability claim.
-- See the plan's "Critical Implementation Details" for the exact signature.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
as $$ select extensions.unaccent('extensions.unaccent', $1) $$;

-- Nullable: a note without an embedding (write-time AI call failed, or the
-- note predates this feature) is simply excluded from the semantic ranking
-- arm, never an error. 1536 matches OpenAI's `text-embedding-3-small`.
alter table public.notes
  add column embedding extensions.vector(1536) null;

-- Generated, not trigger-maintained: `'simple'` is the ceiling available for
-- Polish (no stemming config exists on hosted Supabase — see the research's
-- Correction #2), so this arm gives exact/accent-insensitive word matching
-- only. Inflection and synonym coverage is the embedding arm's job.
alter table public.notes
  add column fts tsvector
  generated always as (to_tsvector('simple', public.immutable_unaccent(content))) stored;

-- Both indexes are filtered `where deleted_at is null`, matching the
-- existing `notes_child_id_occurred_at_idx` convention — a soft-deleted note
-- should never surface through either search arm.
create index notes_embedding_hnsw_idx
  on public.notes
  using hnsw (embedding extensions.vector_cosine_ops)
  where deleted_at is null;

create index notes_fts_gin_idx
  on public.notes
  using gin (fts)
  where deleted_at is null;
