# Open Questions

## Process

This file contains unresolved decisions. When resolved:

1. Record the decision in the authoritative document.
2. Move the item to the Resolved section.
3. Update affected tasks, tests, and schema documentation.

Do not preserve decisions only in chat history.

Priority labels:

- `BLOCKER`
- `HIGH`
- `MEDIUM`
- `LOW`

## Repository reconciliation

### OQ-REPO-002 — Missing task specifications

Priority: HIGH

Question:

Do separate task files already exist for the campaign shell/dashboard and basic
characters?

If not, create them before modifying those features further.

## Rules questions


### OQ-RULE-006 — Spoilage timing

Priority: HIGH

Question:

For fresh food that spoils after two campaign weeks:

- Does acquisition week count?
- Can part of a stack spoil?
- Is spoilage previewed or automatically committed?
- Can the GM override a spoilage date?

## Product questions

### OQ-PROD-002 — Number of campaigns

Priority: MEDIUM

Question:

Does the current UI support one campaign or multiple campaigns? The schema
should remain multi-campaign capable unless deliberately changed.

Update (2026-07-22): In-app campaign creation is now implemented (the Campaign
page empty state offers a validated, RLS-scoped **Create campaign** action;
`src/app/(app)/dashboard/campaign-actions.ts`). The application still operates a
single active campaign — data access selects the earliest `active` campaign
(`getActiveCampaign`) — so there is no multi-campaign switcher yet. The schema
remains multi-campaign capable. A campaign selector/switcher is deferred until a
task explicitly requires multiple simultaneous campaigns; this item stays open
for that decision.

### OQ-PROD-003 — Implemented character fields

Priority: HIGH during reconciliation

Question:

Which character fields are currently implemented and tested?

Current finding (2026-07-18, Task 003):

The `characters` table is implemented with: `id`, `campaign_id`, `name`
(trimmed 1–100), `pronouns`, `ancestry`, `community`, `class_name`,
`subclass_name`, `level` (default 1, constrained 1–10), `portrait_url`,
`notes`, `status` (`active`/`archived`), and audit/archival timestamps. No
character UI exists yet, so these fields are schema-verified only. This remains
open until a character feature exercises and tests them end to end.

Update (2026-07-22, Task 010):

The Characters module now exercises and tests `name`, `notes`, and `status`
end to end through the guided builder, workspace, and the `create_character` /
`update_character` functions. Task 010 also added `class_id` and
`sheet_template_id` (same-campaign composite foreign keys) and introduced the
`character_classes` and `sheet_templates` tables. The legacy Phase 1 columns
(`pronouns`, `ancestry`, `community`, `class_name`, `subclass_name`, `level`,
`portrait_url`) are intentionally not surfaced by the Task 010 UI and are
superseded in intent by the structured class/template links; they remain in the
schema for backward compatibility. This item stays open for those legacy fields
and for character-sheet depth (see `OQ-PROD-006`).

### OQ-PROD-004 — Player-safe display

Priority: LOW

Question:

Is a temporary display mode needed that hides GM-only information?

### OQ-PROD-005 — Undo eligibility

Priority: HIGH before compound operations

Question:

Which operations can be undone, for how long, and what later operations block an
undo?

### OQ-PROD-006 — Character-sheet depth

Priority: MEDIUM

Question:

Should the final product contain the complete mechanical character sheet or only
the GM-relevant subset?

## Architecture and data questions

### OQ-ARCH-001 — Deployment state

Priority: MEDIUM

Question:

Is the project local-only, connected to hosted Supabase, deployed to Vercel, or
using another deployment?

### OQ-ARCH-002 — Real-time subscriptions

Priority: LOW

Question:

Has real-time behavior been introduced? If so, what single-user requirement
justifies it?

### OQ-ARCH-004 — Offline behavior

Priority: LOW

Question:

Is offline read access or queued mutation support needed during sessions?

### OQ-DATA-001 — Location ownership

Priority: MEDIUM for inventory

Question:

Should locations be first-class records or deferred until settlement features?

### OQ-DATA-003 — Character resources

Priority: HIGH for expanded characters

Question:

Which resources are implemented, and which require current and maximum values in
a related table?

### OQ-DATA-004 — Slot inventory model

Priority: HIGH before capacity enforcement

Question:

What is a character's slot capacity, how many slots does each item use, how do
stacks and containers work, and what happens when overloaded?

## Resolved

### OQ-ARCH-005 — PDF storage and rendering dependencies

Resolved: 2026-07-22

Decision:

Task 011A introduces PDF-backed character-sheet templates, which the approved
stack could not support without new libraries. Two dependencies were approved by
the campaign owner:

- `pdfjs-dist` for client-side, read-only PDF rendering to a canvas (page
  navigation and zoom).
- `unpdf` for server-side page-count extraction and corruption validation during
  upload.

PDF bytes are stored in a private Supabase Storage bucket
(`character-sheet-templates`) reachable only through short-lived signed URLs;
immutable version metadata lives in `sheet_template_versions`. No editable field
system, overlay, or interactive sheet runtime is introduced (Tasks 011B–011C).

Also corrected: the reference character-sheet PDF path referenced by the 011A
task document was `docs/references/official/`, which does not exist. The canonical
file is `reference/official/Daggerheart - Gillus - Character Sheets US.pdf`. Only
`.reference-private/` is off-limits to builds/tests; `reference/` may be used as a
file-existence-gated test input.

Recorded in:

- `docs/architecture.md` (Technology stack; Task 011A reconciliation)
- `docs/data-model.md` (`sheet_template_versions`, storage)
- `docs/tasks/TASK-011A-pdf-template-storage-and-rendering.md`
- `supabase/migrations/20260723090000_sheet_template_versions.sql`

### OQ-DATA-002 — Unified operations table

Resolved: 2026-07-19

Decision:

Task 006 introduced the central `operations` table in migration
`20260719120000_operations_foundation.sql`. It provides campaign ownership,
campaign-scoped UUID idempotency, operation type and summary, actor identity,
timestamp, optional JSON-object metadata, and optional same-campaign reversal
provenance. Existing Fear and Countdown event `operation_id` columns now have
foreign keys to `operations(id)`.

The owner-authorized `record_operation(...)` function locks the campaign and
returns the original operation with `was_applied = false` for an identical
retry. The unique `(campaign_id, idempotency_key)` constraint is the final
concurrency-safe duplicate guard. Integration tests verify matching and
conflicting retries, concurrent duplicate requests, same-key use across
campaigns, owner/RLS behavior, blocked direct mutations, reversal constraints,
event foreign keys, and existing Fear/Countdown behavior.

This resolution does not decide generic undo eligibility. `OQ-PROD-005`
remains open.

Recorded in:

- `supabase/migrations/20260719120000_operations_foundation.sql`
- `tests/integration/operations-foundation.db.test.ts`
- `docs/data-model.md`
- `docs/tasks/006-operations-foundation.md`

### OQ-REPO-001 — Actual implementation state

Resolved: 2026-07-19

Decision:

Tasks 001–007 satisfy their documented acceptance criteria. Evidence includes
the actual source and migration chain, a clean database reset, exact generated
types, authorization and RLS coverage, lint, strict typecheck, production
build, 97 unit/component/integration tests, both complementary Playwright modes,
and a browser-bundle credential scan. The campaign-time tracker is complete.
Task 008 was subsequently reconciled against this existing implementation: its
one-day advancement scope was already delivered by Task 007, so Task 008 added
only the contract-named `getNextCampaignTime` and an all-14-state RPC test
rather than recreating the feature. See `docs/tasks/TASK-008-week-advancement.md`.

### OQ-RULE-008 — Countdown categories

Resolved: 2026-07-19

Decision:

Task 005 uses the constrained Phase 1 categories `threat`, `project`,
`consequence`, and `other`. These are application organization labels rather
than claims that every label is official SRD terminology. Arbitrary custom
category values are deferred.

Recorded in:

- `docs/game-interpretation.md`
- `docs/product-spec.md`
- `docs/tasks/005-countdown-tracker.md`

### OQ-ARCH-003 — Cached total maintenance

Resolved: 2026-07-19

Decision:

Compound cached-state and history changes use explicit transactional
PostgreSQL functions rather than separate browser or server writes. Task 004
implements the first such path with `adjust_campaign_fear()`.

Fear-specific rules:

- The function authenticates and authorizes the campaign owner even though it
  executes as `security definer`.
- It locks the campaign-state row, validates the resulting `0–12` total, and
  changes `campaign_state.current_fear` in the same transaction that inserts
  one `fear_events` row.
- Authenticated callers cannot directly update cached Fear or directly mutate
  Fear history.
- A campaign-scoped UUID request key keeps Fear retries idempotent. Task 006
  introduced the shared operations foundation without retrofitting this
  existing single-resource mutation.

Other cached totals must receive their own approved transactional mutation
paths in the task that implements them.

Recorded in:

- `supabase/migrations/20260719090000_fear_tracker.sql`
- `docs/data-model.md`
- `docs/tasks/004-fear-tracker.md`

### OQ-PROD-001 — Authentication method

Resolved: 2026-07-18

Decision:

The application uses Supabase email-and-password authentication for one private
Game Master account.

Rules:

- No public registration UI.
- The initial user is created manually through Supabase.
- No magic links.
- No social login.
- No player accounts.
- No roles.
- No password-reset workflow in Task 002.

Recorded in:

- `docs/architecture.md` (Authentication section)
- `docs/tasks/002-authentication.md`

### OQ-RULE-001 — Official campaign-frame spelling

Resolved: 2026-07-18

Decision:

The official name is **The Witherwild**. Use `The Witherwild` in product copy and
new code identifiers.

Recorded in:

- `docs/witherwild-notes.md`
- `docs/glossary.md`
- `docs/rules-index.md`

### OQ-RULE-002 — Fear maximum

Resolved: 2026-07-18

Decision:

The application enforces a maximum campaign Fear value of 12.

Rules:

- Fear cannot be lower than 0.
- Fear cannot be higher than 12.
- Any adjustment that would move Fear outside the range `0–12` must be rejected.
- Corrections and automatic effects must follow the same limit.
- The limit applies to the campaign Fear pool, not to individual character resources.

Recorded in:

- `docs/campaign-house-rules.md`
- `docs/game-interpretation.md`
- `docs/data-model.md`
- `docs/product-spec.md`

### OQ-RULE-003 — Week starting state

Resolved: 2026-07-18

Decision:

The campaign always begins in a **Day Cycle**.

The world alternates automatically between one week of Day and one week of Night.

Each cycle lasts exactly seven campaign days.

The application tracks:

- Current campaign week
- Current cycle (`Day` or `Night`)
- Current day within the cycle (`1–7`)

Day Cycle

| Day | Phase |
|-----:|---------------------------|
| 1 | Dawn |
| 2 | Sunrise |
| 3 | Morning |
| 4 | Forenoon |
| 5 | Midday |
| 6 | Afternoon |
| 7 | Civil Twilight |

Night Cycle

| Day | Phase |
|-----:|--------------------------------|
| 1 | Nautical Twilight |
| 2 | Astronomical Twilight |
| 3 | Evening |
| 4 | Night |
| 5 | Midnight |
| 6 | Dead of Night |
| 7 | Pre-Dawn |

The application automatically alternates:

Day Week
↓

Night Week
↓

Day Week
↓

Night Week

unless the Game Master explicitly corrects the campaign timeline.

Recorded in:

- docs/game-interpretation.md
- docs/witherwild-notes.md
- docs/product-spec.md

### OQ-RULE-004 — Time Advancement

Resolved: 2026-07-18

Decision:

The application does not advance time automatically.

Campaign time advances only when the Game Master explicitly records the passage
of time.

Common reasons include:

- Short Rest
- Long Rest
- Sleeping
- Travel
- Hunting or gathering
- Activities within settlements
- Any other GM-directed narrative activity

The amount of elapsed time depends on the narrative.

The application should provide predefined options for common activities but
allow the GM to specify a custom duration.

Recorded in:

- docs/game-interpretation.md
- docs/product-spec.md

### OQ-RULE-011 — Time Advancement

Resolved: 2026-07-19

Decision:

This was a duplicate of `OQ-RULE-004`. The canonical decision remains that
campaign time advances only when the Game Master explicitly records narrative
time passage, using common activity choices or a custom duration. No additional
time-advancement behavior is introduced by this reconciliation or by Task 006.

Recorded in:

- `docs/open-questions.md` under `OQ-RULE-004`
- `docs/game-interpretation.md`
- `docs/product-spec.md`

### OQ-RULE-005A — Food participation

Resolved: 2026-07-18

Decision:

Every active Player Character participating in the campaign consumes one ration
during each campaign week.

The application determines participating characters from the active character
roster for the campaign.

Initial campaign roster:

- Kodak
- Korrin
- Zane
- Mussandra
- Nameless One

Rules:

- Each participating character consumes one ration per campaign week.
- With the initial roster, the campaign consumes **5 rations per week**.
- If the active roster changes, weekly food consumption adjusts automatically
  based on the current participating characters.
- The Game Master may exclude a character from a week's consumption only by
  explicitly marking them as not participating before advancing the week.

Recorded in:

- `docs/game-rules.md` (or `campaign-house-rules.md` if you haven't merged the files yet)
- `docs/product-spec.md`

### OQ-RULE-005B — Food units


 `Ration` and `Portion` are NOT the same application unit. Each Ration is split into 7 Portions. Each Portion lasts a day, which is how Rations last a week

### OQ-RULE-005 — Base food consumption

Resolved: Previously confirmed by the campaign owner

Decision:

Each participating character consumes one ration per campaign week.

Remaining participation and unit-conversion details are tracked separately.

Recorded in:

- `docs/campaign-house-rules.md`
- `docs/game-interpretation.md`

### OQ-RULE-006A — Base spoilage rules

Resolved: Previously confirmed by the campaign owner

Decision:

Fresh food spoils after two campaign weeks. Preserved food does not spoil
through normal weekly spoilage. Rations count as Preserved food

Remaining timing and partial-stack details remain open.

Recorded in:

- `docs/campaign-house-rules.md`
- `docs/game-interpretation.md`

### OQ-RULE-007 — Countdown direction and reversal

Resolved: 2026-07-18

Decision:

All countdowns count down from their starting value to 0.

Rules:

- Every countdown has:
  - an initial value,
  - a current value,
  - and a minimum value of 0.
- A countdown is complete when its current value reaches 0.
- The Game Master may reduce or increase the current value at their discretion.
- Increasing a countdown represents reversing or delaying progress.
- A countdown cannot exceed its initial value.
- A countdown cannot be reduced below 0.
- Every adjustment creates a countdown event recording:
  - previous value,
  - new value,
  - change amount,
  - timestamp,
  - optional reason.
- Increasing a completed countdown reopens it.
- Reopening does not automatically reverse any effects triggered when the countdown previously completed.

Recorded in:

- `docs/game-interpretation.md`
- `docs/product-spec.md`
- `docs/data-model.md`
- `docs/tasks/005-countdown-tracker.md`

### OQ-RULE-010 — Inventory weight

Resolved: Previously confirmed by the campaign owner

Decision:

Weight is ignored and inventory uses slots. Capacity details remain open.

Recorded in:

- `docs/campaign-house-rules.md`
- `docs/game-interpretation.md`



