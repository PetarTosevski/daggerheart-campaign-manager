# Game Interpretation

## Status

Status: Active application interpretation

This document explains how confirmed Daggerheart and campaign mechanics map into
application state and workflows. It does not replace the SRD.

## General interpretation rules

- Official mechanics must be traceable through `rules-index.md`.
- House-rule overrides must be explicit and recorded in this document with
  their source. (`campaign-house-rules.md` was retired in the 2026 rebuild; its
  history is at tag `witherwild-final`.)
- Current totals may be cached for fast reads.
- Every important mutation must create auditable history in the same
  transaction.
- The application never applies an unconfirmed narrative consequence
  automatically.
- Corrections preserve the original record.

## Fear

The application stores:

- A cached current Fear value in campaign state
- Append-oriented Fear events
- An event type for each adjustment
- An operation link when the adjustment belongs to a compound action

The cached total is not independently authoritative. It must remain reconcilable
with the Fear-event history.

Rules:

- Fear cannot be negative.
- Fear cannot exceed 12.
- Source of the 0–12 range: a confirmed application range, not a house-rule
  change (former `docs/campaign-house-rules.md`, "Fear", at tag
  `witherwild-final`). Adjustments that would move Fear outside it are rejected.
  It defines no automatic extended-downtime behaviour.
- New campaigns start with Fear 0.
- A Fear change updates the total and inserts one event atomically.
- Corrections use compensating events.
- Retried adjustments use an idempotency key and cannot apply twice.
- Extended-downtime Fear must be previewed and confirmed before the application
  applies it.

## Countdowns

The application stores:

- Countdown configuration
- Cached current value
- Direction and target
- Status
- Optional narrative consequence
- Countdown-event history

Rules:

- Every value or status change creates an event.
- Phase 1 categories are `threat`, `project`, `consequence`, and `other`.
- Every countdown starts at a positive integer and counts down toward `0`.
- Reaching `0` completes the countdown automatically and records completion
  exactly once for that active lifecycle.
- Increasing a completed countdown reopens it, up to its initial value, without
  reversing any narrative consequence.
- Automatic completion effects are disallowed until explicitly configured.
- Paused countdowns cannot change value until resumed.
- Cancelled countdowns are terminal.
- Completed and cancelled countdowns remain available in history.

Countdown terminology must follow the SRD or be marked as a campaign-defined
category.

## Campaign weeks

A campaign week is the application unit aligned with the Witherwild weekly
day/night cycle.

The official Witherwild frame describes week-long day and night periods. The
application must track the cycle only after its starting state and transition
behavior are confirmed.

Week advancement is a compound transaction that may include:

- New current week
- Day/night-cycle transition
- Food consumption
- Food spoilage
- Fear changes
- Selected long-term countdown changes
- Wither-token end-of-session conversion when explicitly invoked
- GM notes

The preview is non-persistent. Confirmation applies all selected changes or
none.

The application must distinguish:

- Advancing a campaign week
- Ending a real-world session
- Applying extended downtime

These are not automatically equivalent.

## Campaign Calendar

The application represents campaign time using three values:

- Campaign Week
- Cycle (`Day` or `Night`)
- Cycle Day (`1–7`)

The named phases are presentation values derived from the current cycle and cycle day.

### Day Cycle

| Cycle Day | Display Phase |
|----------:|---------------|
| 1 | Dawn |
| 2 | Sunrise |
| 3 | Morning |
| 4 | Forenoon |
| 5 | Midday |
| 6 | Afternoon |
| 7 | Civil Twilight |

### Night Cycle

| Cycle Day | Display Phase |
|----------:|-----------------------|
| 1 | Nautical Twilight |
| 2 | Astronomical Twilight |
| 3 | Evening |
| 4 | Night |
| 5 | Midnight |
| 6 | Dead of Night |
| 7 | Pre-Dawn |

The application derives the displayed phase from the stored values rather than storing the phase name itself.

### Manual one-day advancement

Task 007 advances campaign time only after explicit GM confirmation:

- Cycle days `1–6` increment by one without changing week or cycle.
- Cycle day `7` advances to day `1`, increments the campaign week, and
  alternates Day and Night.
- Preview derives the proposed canonical state and phase without writing.
- Commit records one operation and one campaign-time event atomically with the
  cached state update.
- An explicit correction may set any different valid canonical combination and
  appends a compensating event without deleting earlier transitions.

Manual one-day advancement does not consume food, spoil supplies, change Fear,
operate countdowns, infer duration from narrative activities, or apply any
other automatic consequence. Those effects remain outside Task 007.

## Food

Food is modeled separately from general inventory.

Confirmed house rules:

- One ration per participating character per campaign week
- Fresh food spoils after two campaign weeks
- Preserved food does not spoil through normal weekly spoilage

Until the remaining unit and timing questions are resolved:

- Do not assume that `ration`, `portion`, and arbitrary quantity are identical.
- Do not apply automatic spoilage without a preview.
- Permit a GM correction with an audit record.

Implemented behavior (Task 012):

- Food is held canonically in portions; one ration = 7 portions (configurable
  per campaign). Rations and portions are derived for display.
- The default weekly requirement is `active characters × 7 portions`, derived
  from the active roster (never hard-coded names). A GM may override the required
  portions with a mandatory reason.
- Fresh food acquired in week `A` is eligible for spoilage when processing a week
  `W >= A + 2`. Preserved food (the default for rations) does not spoil through
  weekly processing. A GM may skip spoilage for a run with a mandatory reason.
- Weekly processing is previewed (non-persistent) then committed atomically and
  idempotently as a standalone action; it consumes oldest-eligible food first
  (FIFO) and reports any shortage. It is not coupled to Task 007/008 time
  advancement.
- Corrections are compensating audit transactions; history is never rewritten.

## Inventory

Task 013 implements inventory following the task prompt: reusable item
definitions held as stacks in owned or shared, nestable containers, with optional
per-item weight and optional container capacity rather than a fixed slot count.
Weight is optional (unset items contribute nothing to `carried_weight`), so
slot-style play remains possible by leaving weights and capacities blank. This
supersedes the earlier "slots, not weight" sketch and resolves OQ-DATA-004 and
OQ-RULE-010.

The application stores current item quantity or stack state and transaction
history.

Rules:

- Quantity cannot be negative.
- Transfers are one atomic operation.
- A pure transfer preserves total quantity.
- Capacity enforcement is deferred until slot limits and item sizing are
  defined.
- Current quantity may be cached but must remain auditable from transactions.

## Characters

The application may store:

- Identity and gender
- Ancestry and community
- Class, subclass, and level
- Traits
- Evasion
- Hit Points
- Stress
- Hope
- Armor
- Experiences
- Conditions
- Equipment
- Inventory
- Wither tokens
- Scars
- Portrait reference
- Private GM notes

The initial character slice may implement only an approved subset. Do not store
the whole character sheet as an unvalidated JSON object.

## Wither tokens

The official Witherwild frame introduces Wither tokens attached to individual
characters.

Application mapping:

- Wither tokens belong to a character.
- Token changes require history if the feature is implemented.
- The Fear Die check remains a tabletop action; the application may prompt and
  record its result but should not roll automatically unless explicitly
  requested.
- End-of-session token clearing and corresponding Fear gain must be previewed as
  one compound operation.
- Scars are character records and are not deleted when tokens clear.

This feature requires a dedicated task before implementation.

## Corrections and undo

A correction adds a compensating event to repair incorrect state.

Undo reverses an eligible operation by creating a new linked operation and new
compensating records.

Neither correction nor undo deletes the original historical record.
