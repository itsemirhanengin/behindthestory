# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

The primary user is a **serious indie novelist** — someone writing a book they
intend to publish, not an experiment. They arrive with an idea and the
intention to finish, and they expect to own and revise every word that ends up
in the manuscript.

The AI's role for them is a **drafter, not an author**: it produces prose the
writer then owns and revises. Its most valuable job is holding continuity
across a manuscript far longer than anyone can keep in their head — the pain
that actually breaks a long novel.

Collaboration exists but is not the centre of gravity: every plan but one is
single-seat, and Team is five seats.

## Product Purpose

BehindTheStory is a novel-writing studio where the story's canon is a
first-class structure rather than something the writer re-explains to a chat
box every session. It holds the story bible (characters, locations, elements,
relationships), a chapter spine, and an event log, and every generation is
assembled from that canon plus semantically retrieved prose from earlier
chapters.

Success is a finished manuscript that stayed coherent — the author reaching the
end without the story quietly contradicting itself, and without having become
the model's continuity checker.

## Positioning

Four mechanisms a neighbouring product could not truthfully copy by adding a
chat panel:

- **The reading is corrected before it becomes canon.** The new-novel wizard
  turns the author's description into an explicit `Reading` — logline, premise,
  protagonist, conflict, world, stakes, themes — and separately surfaces the
  `assumptions` the model filled in on its own. The author corrects that
  artefact until it is right. Corrections are replayed in order and the reading
  is re-derived from scratch each round rather than patched, so it cannot
  drift. The point is to make a misunderstanding *visible* before it hardens
  into canon.
- **Story state is derived, never stored.** "What was true in chapter N" is
  folded from an append-only event log rather than kept as a mutable field, so
  the author can scrub across the novel's timeline and see when a character's
  status or a relationship actually turned, and why.
- **Continuity is grounded in the prose, not in a summary.** Chapters are
  chunked on paragraph boundaries with carry-over and embedded, so a generation
  retrieves the passages that actually matter once chapter summaries alone stop
  being enough.
- **It is sold in words, not tokens.** A chapter draft sends ~40,000 tokens of
  context to produce ~2,400 tokens of prose, so "100,000 tokens" would read to
  a writer as ~70,000 words and deliver two chapters. The unit billed is the
  output the writer keeps.

## Operating Context

Four deployed pieces, one product:

- **Studio** (`apps/studio`, Next.js) at `studio.behindthestory.co` — the
  primary working surface: the novel shelf, the new-novel wizard, the story
  bible, characters, locations, the story canvas, the chapter editor, and the
  reading view.
- **Native app** (`apps/mobile`, Expo Router) — shipping on iOS and Android,
  and expected to feel native on both. Covers the novel, its chapters,
  characters, locations, bonds, the reading view, and the new-novel wizard.
- **API** (`apps/api`, Hono) at `api.behindthestory.co` — the single authority
  for auth, novels, chapters, entities, timeline, merge, search, billing, and
  every AI route.
- **Worker** (`apps/worker`) — background jobs, including chapter indexing.

Deployment is Railway. `behindthestory.co` itself is still undecided (see
`BACKLOG.md`): the apex serves a GoDaddy parking page because GoDaddy does not
support CNAME on `@`, so pointing it at Railway is a nameserver migration
rather than a record change.

The author's real working scene is long-haul and returning: work in progress
lives on the account rather than the device, so a novel started on a phone must
be findable on the desk — a shelf that looks empty reads as lost work.

## Capabilities and Constraints

Confirmed today:

- **Onboarding wizard** — description → correctable `Reading` → proposed style
  (genre, tone, POV, tense, target chapter words, style notes), each control
  carrying a one-line rationale so the autofill is inspectable. No novel row is
  written until the last step; the wizard snapshots itself into `novel_drafts`
  as the author works, so several half-described novels can sit side by side.
  A description under **40 words** means the model is inventing a novel rather
  than reading one, and is refused.
- **Story bible** — characters (main/side/minor, summary, backstory, traits),
  locations, elements, and relationships, all AI-draftable and author-editable.
- **Chapters** — a spine of slots, each with one *active* variant plus
  alternative takes and revisions. Inactive variants must never leak into
  context, the reading view, or an export.
- **Writing** — streamed chapter drafts, beat-scoped drafts, and inline actions
  on a selection (rewrite, expand, tighten, …) that change prose without
  introducing new plot facts.
- **Review** — continuity checks, chapter analysis, and relationship
  extraction, which write turning points into the event log with duplicate
  detection so re-running an analysis cannot stack a second copy of the same
  event.
- **Retrieval** — per-chapter embedded index, queried from the scene about to
  be written.
- **Also** — manuscript search, novel merge, export, per-novel usage, and
  workspaces with members.

Durable constraints:

- **Context is capped at 40,000 tokens** (`AI_CONTEXT_BUDGET`) for every
  prompt, with per-section ceilings so no single section (usually the parent
  chapter's tail) crowds out the rest. What actually made it into the prompt is
  surfaced in the UI, not hidden.
- **Every generation is metered and charged in words.** The studio prices an
  action before running it and the API enforces the same numbers from the same
  table. Prose routes charge what they produced above a floor; structured
  routes charge a published flat number. Reserve → settle → release, idempotent
  per request.
- **Plan words do not roll over; top-up words never expire.** Plan words are
  spent first, so a top-up behaves like a reserve rather than a balance that
  evaporates at the month boundary.
- **Free is pinned to one model and renders no model picker.** A chooser whose
  every option but one is locked sells nothing and looks broken. A workspace
  that downgrades keeps its stored model preference, but generations resolve
  back to what the plan actually allows.
- Plans: Free (10,000 words, 1 seat), Starter ($6, 60,000), Pro ($14, 150,000),
  Team ($39, 400,000, 5 seats). Top-ups: 30k/$5, 100k/$14, 300k/$36.
- Auth is email OTP. Locally, OTP mail does not send.
- **Chapter length** ranges 600–5,000 words, step 100.

Terminology to keep consistent, in and out of the product: **novel**,
**chapter** (with **variants** and a **spine**), **story bible**,
**character** / **location** / **element**, **bond** (the native app's word for
a relationship), **story event**, **reading** (the wizard's artefact),
**draft** (a wizard work-in-progress, not a chapter revision), **workspace**,
and **words** (never tokens, credits, or generations, in anything the author
sees).

## Brand Commitments

- Name: **BehindTheStory**, one word, capitalised as written. Domain
  `behindthestory.co`.
- Shipped assets exist: app icon, adaptive Android icon, splash. Any brand
  colour they imply is incumbent, not a confirmed commitment.
- The studio's visual system is established in code and deliberate. It is not
  recorded here — `$impeccable document` owns that.
- **Undecided:** there is no confirmed voice or tone-of-voice guide for
  author-facing copy. Future work should propose one rather than assume the
  codebase's internal commentary style is the product's voice.

## Evidence on Hand

**Pre-launch. No users, and nothing publishable as proof.**

Future work must not fabricate any of the following, because none of it exists:
customer names, testimonials, quotes, case studies, author counts, words
written, novels finished, retention or satisfaction numbers, press mentions,
awards, funding, team size, or claims of being used by published authors.

What is real and citable:

- The plan and top-up prices above, which are implemented in
  `packages/core/src/plans.ts`.
- The cost derivation behind them: 40,000 input + ~2,400 output tokens for
  1,800 words on the reference model, i.e. `USD_PER_WORD = 0.000052`.
- The product's own behaviour, demonstrable on a real novel — the wizard, the
  bible, the timeline, continuity checks.

No marketing surface exists yet, and the apex domain that would host one is
still undecided.

## Product Principles

1. **Make the misunderstanding visible before it hardens.** Anywhere the model
   inferred, assumed, or filled a gap, show the inference as a correctable
   artefact rather than a finished result. The wizard's `assumptions` list is
   the pattern, not the exception.
2. **The author owns the manuscript; the AI owns the bookkeeping.** Generated
   prose is a draft to be revised. The product's defensible work is continuity,
   canon, and retrieval — never persuading the author that the output is
   finished.
3. **Show the cost before it is spent, in the unit the author thinks in.**
   Price an action before running it, and denominate it in words. Never surface
   tokens to an author.
4. **Derive state, don't store it.** Truth is folded from an append-only log so
   that "why is this true now?" always has an answer the author can trace.
5. **Nothing half-finished is allowed to look like nothing.** Drafts, works in
   progress, and partial descriptions live on the account and stay visible; an
   empty-looking surface reads as lost work.
