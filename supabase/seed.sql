-- Calibration corpus for `note-search-similarity-floor`. Applied automatically by
-- `npx supabase db reset` (`supabase/config.toml` -> `[db.seed] sql_paths = ["./seed.sql"]`),
-- after every migration has run.
--
-- WHY THIS IS COMMITTED: `public.search_notes`'s `p_similarity_threshold` is a constant that can
-- only be chosen against real Polish notes. A corpus that lives in one developer's local database
-- makes that number unreproducible -- nobody else can re-derive it, and nobody can tell whether a
-- later change moved the threshold or moved the data. This file is the fixed half of the
-- measurement; `scripts/measure-similarity.mjs` is the other half.
--
-- LOCAL LOGIN (seeded so the corpus can be reviewed and searched through the UI):
--
--     e-mail:  rodzic@local.test
--     haslo:   haslo123
--
-- `encrypted_password` is hashed with `extensions.crypt` / `extensions.gen_salt('bf')` -- pgcrypto
-- lives in the `extensions` schema on Supabase, not `public`, so every call below is
-- schema-qualified for the same reason `20261017103455_add_notes_search.sql` qualifies its own.
-- The salt is random, so the hash differs between resets; nothing in the measurement depends on
-- it. `email_confirmed_at` is set because GoTrue's password grant rejects an unconfirmed e-mail
-- even with `[auth.email] enable_confirmations = false`, and the matching `auth.identities` row is
-- what makes the account resolvable by the `email` provider.
--
-- NOT IDEMPOTENT, deliberately: this is a reset-time seed, and `auth.users.email` is uniquely
-- indexed, so a second application without a reset fails loudly instead of silently doubling the
-- corpus and changing what the measurement measures.
--
-- RESERVED ID SPACE: every id here starts `5eed0000-0000-0000-0000-` ("seed"), which is disjoint
-- from the integration harness's `f1c70000-0000-0000-0000-` (`tests/integration/fixtures.ts:72`)
-- and from the pgTAP suite's `00000000-...` fixtures. A seeded database and a test run therefore
-- cannot delete or overwrite each other's rows. Direct inserts into `auth.users` /
-- `public.children` / `public.notes`, following `supabase/tests/04_notes_search.sql:34-74`.
--
-- `embedding` is left null on every note. `npm run backfill:embeddings` fills it after the reset
-- -- embedding at seed time would mean committing 26 x 1536 floats and re-committing them on every
-- model change.

-- One account, two children: enough to tell a per-child note set apart, which is what the
-- `p_child_id` correctness filter needs in order to be visible in a measurement.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '5eed0000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'rodzic@local.test',
  extensions.crypt('haslo123', extensions.gen_salt('bf')),
  now(),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
);

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '5eed0000-0000-0000-0000-00000000d001',
  '5eed0000-0000-0000-0000-000000000001',
  '5eed0000-0000-0000-0000-000000000001',
  '{"sub":"5eed0000-0000-0000-0000-000000000001","email":"rodzic@local.test","email_verified":true,"phone_verified":false}'::jsonb,
  'email',
  now(),
  now(),
  now()
);

insert into public.children (id, user_id, name, birth_date) values
  (
    '5eed0000-0000-0000-0000-0000000000c1',
    '5eed0000-0000-0000-0000-000000000001',
    'Ala',
    '2023-04-18'
  ),
  (
    '5eed0000-0000-0000-0000-0000000000c2',
    '5eed0000-0000-0000-0000-000000000001',
    'Staś',
    '2025-01-09'
  );

-- 26 notes, written the way the parent actually writes: short, abbreviated, inflected, numbers and
-- medication names inline, health interleaved with ordinary life. `occurred_at` is a bare wall
-- clock (`20260927205447_create_notes.sql`), spread across February-October 2026 so a period
-- phrase ("w lipcu", "w zeszłym miesiącu") has something to bound. `fts` is a generated column and
-- is never inserted.
--
-- The topical spread is load-bearing, not decoration: a corpus of twenty fever notes cannot
-- separate a true positive from a true negative, because every pair would score high. Repeated
-- subjects (Nurofen, gorączka, szczepienie, antybiotyk) are deliberate -- they give the question
-- set inflected and base-form targets -- and everything else is there to be a true negative.

-- Ala (c1): 14 notes.
insert into public.notes (id, user_id, child_id, content, occurred_at) values
  (
    '5eed0000-0000-0000-0000-00000000a001',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Gorączka 38,4 w nocy. Dałam Nurofen 5 ml ok. 2. Spała niespokojnie, dużo piła.',
    '2026-02-03T08:40'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a002',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Temp. już 37,1, bez leków. Apetyt wrócił, zjadła całą zupę pomidorową.',
    '2026-02-04T17:10'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a003',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Wizyta u pediatry, dr Kowalska. Osłuchała, gardło czyste, katar wirusowy. Bez antybiotyku.',
    '2026-02-19T09:00'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a004',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Pierwszy raz sama zjechała ze zjeżdżalni na placu zabaw. Strasznie dumna.',
    '2026-03-07T16:30'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a005',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Szczepienie MMR w przychodni. Po południu marudna, temp. 37,3, nic nie dawałam.',
    '2026-03-21T11:15'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a006',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Urodziny, 3 latka. Tort marchewkowy, byli Zosia i Kuba. Spała dopiero o 22.',
    '2026-04-18T18:00'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a007',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Kaszel suchy od 2 dni, w nocy gorzej. Syrop na noc, włączyłam nawilżacz.',
    '2026-05-06T07:50'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a008',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Zapalenie oskrzeli. Antybiotyk Augmentin 2x dziennie przez 7 dni, do 16.05.',
    '2026-05-09T10:20'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a009',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Wysypka na brzuchu po truskawkach. Zeszła po godzinie, bez leków. Na razie odstawiam.',
    '2026-06-02T18:00'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a010',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Gorączka 39,1 wieczorem. Nurofen o 21:30, czopek niepotrzebny. Dzwoniłam na nocną pomoc.',
    '2026-07-14T21:30'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a011',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Rano 37,8. Dałam Nurofenu drugi raz, 5 ml. Dużo piła, siku normalnie.',
    '2026-07-15T06:40'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a012',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Przedszkole, adaptacja. Została 2 h bez płaczu, zjadła drugie śniadanie.',
    '2026-08-11T12:00'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a013',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Ząb trzonowy wychodzi, śliniła się cały dzień. Żel na dziąsła wieczorem.',
    '2026-09-09T19:45'
  ),
  (
    '5eed0000-0000-0000-0000-00000000a014',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c1',
    'Kontrola u stomatologa, zęby bez ubytków. Kupiłam pastę z fluorem i małą szczoteczkę.',
    '2026-10-06T15:30'
  );

-- Staś (c2): 12 notes.
insert into public.notes (id, user_id, child_id, content, occurred_at) values
  (
    '5eed0000-0000-0000-0000-00000000b001',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Karmienie o 3 w nocy, potem spał do 7. Waga 9,8 kg, ważony w domu.',
    '2026-02-11T03:20'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b002',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Wizyta kontrolna. 82 cm i 10,1 kg, pediatra zadowolony. Witamina D dalej 1 kropla.',
    '2026-03-02T10:00'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b003',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Katar od tygodnia, odciągam aspiratorem. Sól fizjologiczna 3x dziennie.',
    '2026-03-30T14:15'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b004',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Szczepienie: błonica, tężec, krztusiec. Udko lekko czerwone, zimny okład wieczorem.',
    '2026-04-22T08:30'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b005',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Pierwsze kroki bez trzymania! 4 kroki do kanapy i brawa.',
    '2026-05-17T16:00'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b006',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Nie chce obiadu, tylko jogurt i banan. Mleko normalnie, więc nie walczę.',
    '2026-06-08T12:30'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b007',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Ząbkowanie, płacz w nocy. Dałam Nurofen dla dzieci 2,5 ml i pomogło po 20 min.',
    '2026-06-25T22:10'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b008',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Zapalenie ucha środkowego. Dr Nowak przepisał Amoksiklav na 7 dni, 2x dziennie.',
    '2026-07-03T11:40'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b009',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Pierwszy raz na basenie, w ogóle nie bał się wody. Spał potem 2 h.',
    '2026-07-28T17:20'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b010',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Biegunka od wczoraj, 4 luźne stolce. Smecta i dużo płynów, bez gorączki.',
    '2026-08-19T09:10'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b011',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Kupiłam buciki, rozmiar 22. Stare już ciasne, mierzyliśmy w sklepie.',
    '2026-09-14T18:50'
  ),
  (
    '5eed0000-0000-0000-0000-00000000b012',
    '5eed0000-0000-0000-0000-000000000001',
    '5eed0000-0000-0000-0000-0000000000c2',
    'Spadł z kanapy, guz na czole. Zimny okład, bez wymiotów, obserwuję do wieczora.',
    '2026-10-12T07:30'
  );
