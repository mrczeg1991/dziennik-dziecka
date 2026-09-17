---
project: "Dziennik dziecka"
context_type: greenfield
created: 2026-09-15
updated: 2026-09-15
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 1
  hard_deadline: 2026-11-04
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "missing capability — no fast, searchable place to log free-form notes about children"
    - topic: "differentiation vs. existing baby-tracker apps"
      decision: "free-form notes (not rigid forms) + natural-language Q&A with citations to source entries"
    - topic: "primary persona scope"
      decision: "single user (the author), one parent, two children"
    - topic: "access model"
      decision: "account with password + login screen (revised in Phase 3 — originally local profile, corrected on conflict with MVP flow)"
    - topic: "role model"
      decision: "flat — single profile, full access to both children's notes"
    - topic: "first working flow scope"
      decision: "scoped down from 6 to 4 steps — account creation, login, add child, add note. NL query deferred to a fast-follow increment, not v1."
    - topic: "NL-query output shape"
      decision: "returns a list of matching notes with dates/links — not a synthesized text summary"
    - topic: "product type / scale / timeline"
      decision: "web app, small scale (self + maybe a few), hard deadline 2026-11-04, after-hours only"
  frs_drafted: 6
  quality_check_status: accepted
---

## Vision & Problem Statement

A parent of two children struggles to remember and quickly retrieve small facts about them — measurements, symptoms, milestones. A typical moment: measuring a child's height and not remembering when the last measurement was taken, or a child complaining about leg pain and needing to judge how often and how long this has been happening in order to give a doctor a reliable account. Today, without a fast way to capture and retrieve these facts, they live in memory or scattered notes and are effectively lost when needed.

Existing baby-tracker apps impose rigid forms (weight, sleep, feeding) and don't let a parent jot down an arbitrary free-form note or ask a natural-language question about past notes with a link back to the source entry — that gap is what this idea fills.

## User & Persona

**Primary persona**: A parent (the author) tracking notes about two children. Context: everyday moments (taking a measurement, observing a symptom, noting a milestone) and preparing for a doctor's visit. They reach for the product either right after observing something worth recording, or when they need to quickly reconstruct history (e.g., before a medical appointment).

No secondary persona — single-user scope for the MVP (see gray-area decision above).

## Success Criteria

### Primary
- A parent can create an account, log in, add a child, and add a free-form note about that child. This proves the core loop works.

### Secondary
- A parent can ask a natural-language question about past notes (e.g., "how often does she complain about leg pain?") and get an answer with dates and links to the source notes. This is the idea's main differentiator, deferred as a fast-follow after the primary flow ships — not required to prove the MVP works.

### Guardrails
- Notes are never lost or silently overwritten once saved.
- A child's notes are only visible to the logged-in account.

## User Stories

### US-01: Rodzic zapisuje notatkę o dziecku

- **Given** a logged-in parent who has already added at least one child
- **When** they add a free-form text note about that child
- **Then** the note is saved with a date/time and appears on that child's notes list

#### Acceptance Criteria
- Note text can be arbitrary free text (no fixed fields)
- Saved note is immediately visible on the child's notes list
- Note survives logout / re-login

## Functional Requirements

- FR-001: Parent can create an account with a password. Priority: must-have
  > Socrates: Counter-argument considered: "a password account is unneeded friction for a single-user app" / "forgetting the password risks losing access to years of notes with no recovery path." Resolution: kept as written; no counter-argument accepted.
- FR-002: Parent can log in with their account credentials. Priority: must-have
  > Socrates: Counter-argument considered: "logging in every time adds friction at the moment of capture" / "a single-user app could just stay logged in indefinitely." Resolution: kept as written; no counter-argument accepted.
- FR-003: Parent can add a child profile. Priority: must-have
  > Socrates: Counter-argument considered: "a child profile is an unnecessary step before the first note — notes could just be tagged with a name" / "without a profile there's nothing to scope the notes list or future NL query to." Resolution: kept as written; no counter-argument accepted.
- FR-004: Parent can add a free-form note about a child, with a date/time. Priority: must-have
  > Socrates: Counter-argument considered: "free text with no structure will make the future NL query harder to build, since it has to parse everything from raw text." Resolution: kept as written; no counter-argument accepted.
- FR-005: Parent can view the list of notes for a given child. Priority: must-have
  > Socrates: Counter-argument considered: "a flat, unsorted list will become hard to scan as it grows." Resolution: kept as written; no counter-argument accepted.
- FR-006: Parent can ask a natural-language question about a child's notes and get an answer with dates and links to the source notes. Priority: nice-to-have
  > Socrates: Counter-argument considered: "leaving this nice-to-have risks it never getting built, leaving the app as plain CRUD — the anti-pattern rejected earlier." Resolution: kept as nice-to-have; it's an intentional fast-follow after the core loop ships, not an abandonment.

## Non-Functional Requirements

- A natural-language question about a child's notes returns a result within 10 seconds.

## Business Logic

Based on a parent's natural-language question, the application returns the notes that match the question, along with their dates and links to the source entries.

The rule consumes a free-text question from the parent about a child's notes (e.g., about a symptom, a time period, or a milestone). Its output is a list of matching notes, each carrying its original date and a link back to the source entry — not a synthesized summary sentence. The parent encounters this when they want to recall history without manually scrolling the notes list (e.g., before a doctor's visit, or to check how often something has happened). This is FR-006, a nice-to-have fast-follow after the core CRUD loop (FR-001–005) ships.

## Access Control

Account with password; login screen. Flat model — a single account has full access to notes for both children; no role separation.

## Non-Goals

- No shared account between parents — one account per parent, no partner/caregiver co-access in this version.
- No synthesized text summaries — NL-query answers are a list of matching notes, not a generated summary (see Business Logic).
- No data import/export (e.g., no PDF export for doctor visits).
- No native mobile app — web only.

## Quality cross-check

All soft-gate elements present: Access Control, Business Logic (one-sentence rule), project artifacts, timeline-cost (1-week MVP, well under the 3-week default), Non-Goals. No gaps recorded.
