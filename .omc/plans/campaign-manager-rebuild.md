# Plan: Campaign Manager Rebuild — First Slice

- **Status:** approved 2026-10-16 (execution via ralph, one phase at a time; stop and report after each phase)
- **Iteration:** 4 (consensus reached: Architect "SOUND WITH CHANGES" with no blockers, Critic "APPROVED")
- **Mode:** RALPLAN-DR consensus, DELIBERATE
- **Spec:** `.omc/specs/deep-interview-campaign-manager-rebuild.md`
- **Branch:** `rebuild` (the old app is preserved at tag `witherwild-final`)
- **Date:** 2026-10-16
- **Scope:** the repo sweep, platform setup (Convex, Convex Auth, Next.js on Vercel), and the spec's first slice only:
  - frame and campaign picker;
  - Fear;
  - countdowns;
  - Witherwild campaign time;
  - live updates across devices.

**Out of scope:**
- **Visual design.** It is pending the user's Claude Design references. This plan builds only a minimal UI that can be replaced: it must work, be accessible and suit a tablet, but it makes no design-language decisions (no custom theme, fonts or layout system).
- **Rests and downtime, session log, adversaries and encounters.** These are later tasks, and the user must specify each mechanic first.
- **Characters, food, inventory, Wither tokens, sheet templates, dice and PDFs in the app.** These are non-goals in the spec.

---

## 1. Requirements Summary

1. **Sign-in gate.** Use Convex Auth with OAuth. Only the GM's account can sign in, and no other user record is created. A signed-out visitor sees only the sign-in screen. The provider choice is open (OQ-3).
2. **Frame → campaign → table view.** Frames ship in code: `witherwild` and `core-only`. The GM picks a frame, sees their campaigns in it, can create one there, and opens it into a live table view.
3. **Mechanic gating.** A campaign shows and accepts only the mechanics its frame enables. Fear and countdowns are core; campaign time is Witherwild-only. The server enforces this.
4. **Fear (ported as-is).**
   - Fear stays in the range 0 to 12.
   - Each adjustment or correction writes one event and one change to the total, in one transaction.
   - Each adjustment or correction is idempotent.
   - A correction is a compensating event.
5. **Countdowns (ported as-is; the SQL is the parity target, subject to OQ-11).**
   - Categories, statuses and intents are the same as before.
   - The status transitions follow the SQL exactly.
   - Completion is recorded once per active lifecycle.
   - Every change writes an event.
   - Every change is idempotent.
6. **Witherwild campaign time (ported as-is).**
   - Time is stored as week (1 or more), cycle (DAY or NIGHT) and cycle day (1 to 7).
   - Phase names are derived, never stored.
   - Advance and correction are atomic, idempotent and audited.
   - A correction must change the state.
7. **Live updates.** A change on one device shows on another open device without reloading. This uses Convex reactive queries.
8. **Isolation.** Every record carries `ownerId` and/or `campaignId`. One campaign's data never appears in another.
9. **Sweep.** Keep only the files the spec keeps. Keep the legacy SQL as read-only reference until each mechanic is ported, then delete it. Rewrite `AGENTS.md` for the new scope **at the start** (Phase 0/1), so later phases follow current rules.
10. **Quality gates.** Lint, typecheck, unit and integration tests, Playwright e2e and the production build all pass.

### Plan additions beyond "ported as-is" (each needs user approval; otherwise dropped)

| # | Addition | Old behaviour | If not approved |
|---|---|---|---|
| PA-1 | Campaign creation is idempotent: a retried create with the same key returns the same campaign | Old campaign creation was not idempotent. `docs/tasks/TASK-009A-campaign-creation.md` does not mention it, and there is no SQL `create_campaign` function. | Plain create plus a disabled submit button while the request is pending |
| PA-2 | Campaign names are unique per owner, case-insensitive and trimmed | The old rule was the DB index `campaigns_owner_name_unique ON (owner_id, lower(btrim(name)))` in `20260724090000_campaign_name_unique_per_owner.sql:9-10`, so this is a port, but its scope is open (OQ-12) | Port the old rule exactly (per owner) |
| PA-3 | Indicator shown when the connection to Convex is lost | None | Drop |
| PA-4 | `internalQuery audit:reconcileFear`, which checks that the cached Fear total equals the sum of its events | None (a documented invariant in `docs/game-interpretation.md`, "cached total … reconcilable") | Keep it as a test-only helper in `tests/convex/` and do not deploy it |
| PA-5 | The Fear `adjust` result returns `{ eventId, previousValue, newValue, amount, eventType, createdAt, replayed }` | The SQL returned a row with a boolean applied flag. This is a **new API shape, not parity** | Not needed |

### Spec deviations needing user approval

| # | Deviation | Why |
|---|---|---|
| SD-1 | Legacy migrations move from `supabase/migrations/` to `reference/legacy-sql/` (with a README) instead of staying where they are | Stops Supabase tooling or CI from treating them as live, and lets `supabase/` be deleted at once |
| SD-2 | More migrations are kept as reference than the spec lists: `20260718090000_phase1_schema.sql` (base tables, Fear and countdown event type constraints), `20260719090100_remove_fear_reasons.sql` (the **current** `adjust_campaign_fear`), and `20260724090000_campaign_name_unique_per_owner.sql` (the name rule) | The spec's four files do not hold all of the current behaviour |
| SD-3 | The ID fields in the validation schemas and their tests change from `z.uuid()` (OQ-1) | Convex IDs are not UUIDs |

### Verified codebase facts that shape the plan

**The modules being kept are pure.**
- `src/lib/domain/{fear,countdowns,campaign-time}/index.ts` have **no imports**.
- `src/lib/validation/{fear,campaign-time}.ts` import only `zod`.
- `src/lib/validation/countdowns.ts:3-6` imports `@/lib/domain/countdowns`. This is switched to a relative import in Phase 1.
- Nothing being kept imports Supabase or a file that will be deleted.

**The validation schemas require UUIDs.**
- `fear.ts:7` (`campaignId`)
- `countdowns.ts:16` (`campaignId`)
- `countdowns.ts:45` (`countdownId`)
- `campaign-time.ts:6` (`campaignId`)
- `campaign-time.ts:44` (`correctsEventId`)

The tests assert that non-UUIDs are rejected: `tests/unit/fear-validation.test.ts:33`, `countdown-validation.test.ts:9-10`, `campaign-time-validation.test.ts:52-59`. Idempotency keys stay UUIDs.

**Fear semantics.**
- The current function is in `20260719090100_remove_fear_reasons.sql`.
- The SQL accepts **any non-zero** `p_amount` (`:50-54`). The app-level contract is ±1, via `fearDirectionSchema` and `amountForFearDirection`.
- The parity target is the app contract: the mutation takes a `direction` and computes ±1.
- The Fear range of 0 to 12 is documented in `docs/campaign-house-rules.md:17-23`. That file is deleted in the sweep, so this source is copied into `docs/game-interpretation.md` first (Phase 0).
- Replay mismatch check (`:93-99`): `amount` or `event_type` differs.
- The SQL `fear_events.event_type` constraint (`20260718090000_phase1_schema.sql:103-104`) allows `adjustment`, `correction`, `undo` and `automatic`. The app writes only `adjustment` and `correction`.

**Countdown semantics** (`20260719110000_countdown_tracker.sql`):
- **Event types.** The constraint (`20260718090000_phase1_schema.sql:177-186`) allows `advance`, `reverse`, `pause`, `resume`, `complete`, `cancel`, `correction` and `undo`. `operate_countdown` writes the action name, one of `advance`, `reverse`, `pause`, `resume`, `cancel` or `correction` (`:230`). Completion is recorded as `newStatus = completed` plus `completed_at`, not as a separate `complete` event. **Creating a countdown writes no event** (`:38-185`; it inserts only the `countdowns` row).
- **Paused.** Only `advance` and `reverse` are blocked while paused (`:309-311`). **A `correction` is allowed on a paused countdown**, and if it reaches 0 the countdown is set to `completed` (`:313-332`). `docs/game-interpretation.md:65` says "Paused countdowns cannot change value until resumed". This **conflicts** with the SQL (OQ-11).
- **Completed.** A completed countdown accepts only a value change with a positive amount, through `reverse` or `correction` (`:313-318`). Advance and negative corrections are rejected. Reaching 0 stamps `completed_at` only if the previous status was not `completed` (`:329-333`). Leaving 0 clears it (`:334-336`).
- **Pause, resume, cancel.** Pause is allowed only from active, resume only from paused, and cancel only from active or paused. Cancelled is terminal (`:298-300`, `:338-351`).
- **Idempotency.** Create is keyed by `(campaign_id, idempotency_key)` on `countdowns` (`:8-10`), with a mismatch check on name, description, category, starting_value and consequence (`:117-124`). Operate is keyed by `(countdown_id, idempotency_key)` on `countdown_events` (`:17-19`), with a mismatch check on event_type, change_amount and reason (`:275-280`).

**Campaign time semantics.**
- `20260719130000_campaign_time_tracker.sql` records through `record_operation` in `20260719120000_operations_foundation.sql`.
- Idempotency is keyed by `(campaign_id, idempotency_key)` on `operations`.
- The mismatch check (`operations_foundation.sql:148-155`) compares operation_type, summary, metadata (`intent`, `target_week`, `target_cycle`, `target_cycle_day`, `note`, `corrects_event_id`, built at `campaign_time_tracker.sql:212-219`) and `reverses_operation_id`.

**Interpretation of countdown completion.** "Automatic completion effects are disallowed until explicitly configured" (`docs/game-interpretation.md:64`). So "completion cannot apply twice" means the completed transition and `completed_at` are recorded once per lifecycle.

**Configs to rewrite.**
- `playwright.config.ts`: Supabase env comment; `globalSetup` imports `@supabase/supabase-js`.
- `vitest.config.ts`: jsdom everywhere.
- `components.json`: shadcn aliases `@/components`, `@/lib/utils`.
- `eslint.config.mjs`: `supabase/.temp/**` ignore.
- `next.config.ts`: a 26 MB `serverActions.bodySizeLimit` for PDF uploads.
- `.env.example`: Supabase keys.
- `.gitignore`: Supabase section.
- `package.json`: dependencies.

**Beads and tooling.**
- `git config core.hooksPath` is `.beads/hooks`.
- `AGENTS.md:341-395` holds `BEGIN/END BEADS INTEGRATION`, and `AGENTS.md:397-419` holds `BEGIN/END BEADS CODEX SETUP`.
- `CLAUDE.md:5-58` holds `BEGIN/END BEADS INTEGRATION`.
- The bd database `dcm` has no issues.
- `.claude/settings.json` has allowlist entries that apply only to Supabase.

**Git.**
- The remote `origin` is `git@github.com:PetarTosevski/daggerheart-campaign-manager.git`.
- It is **not verified** that tag `witherwild-final` exists on the remote: `git ls-remote --tags origin` returned no output in the planning sandbox.

---

## 2. RALPLAN-DR Summary

### Principles

1. **Port behaviour, not storage.** The SQL branches and the pure domain modules are the contract. Anything new is labelled as a plan addition.
2. **One authoritative calculation.** Domain rules exist once, in pure TypeScript. Convex mutations call them. The client uses them only for display hints.
3. **Server-enforced boundaries.** Every Convex function authenticates, checks ownership and checks that the mechanic is enabled.
4. **Append-only history.** A state change and its event are written in one mutation. Events are never updated or deleted.
5. **Smallest replaceable surface.** A minimal UI and a registry in code, with no abstraction beyond three mechanics.

### Decision Drivers (top 3)

1. Parity with the old app on correctness: atomicity, idempotency and the audit trail.
2. Live-play speed and live updates across devices.
3. Low cost of later change: the visual overhaul, adding mechanics one at a time, and possibly multi-user later.

### Decision A — Sweep strategy

| Option | Pros | Cons |
|---|---|---|
| **A1. Delete in place on `rebuild` (chosen)** | Keeps `.beads/`, `core.hooksPath`, `.omc/`, the agent tooling directories, and history and blame for the kept modules. Reviewable against `witherwild-final`. Reuses working tsconfig and Tailwind config. | Old config can linger, so it is handled by the explicit list of config rewrites and the grep gate in Phase 0. |
| A2. Fresh scaffold in a temporary directory, then copy files in | Clean config. | Risks clobbering the bd, OMC and agent tooling and the hook config. Kept files lose rename continuity. More churn. |
| A3. Orphan branch | Totally clean history. | Breaks the tag and blame link and the beads sync refs. The spec says rebuild in place. **Invalidated.** |

### Decision B — Where domain logic lives with Convex

| Option | Pros | Cons |
|---|---|---|
| **B1. Pure TypeScript modules in `src/lib/domain/*`, imported by thin Convex mutations (chosen)** | Meets the spec's rule to keep these modules and their tests unchanged. One calculation. Plain vitest. Client guards come from the same source. | Convex must bundle files outside `convex/`. esbuild follows relative imports, so the `@/` alias is removed. An ESLint boundary keeps these modules free of React, Next and Convex. |
| B2. Logic inside the mutation handlers | One place. | Drops the kept modules (fails "existing unit tests pass against ported modules"). Duplicate guards on the client. **Invalidated by the spec.** |
| B3. Move the domain to `convex/lib/domain` | No bundling question. | Moves files the spec keeps in `src/lib/domain`. Couples the UI to the backend folder. |

### Decision C — Frame and mechanic registry

| Option | Pros | Cons |
|---|---|---|
| **C1. Static registry `src/lib/frames/index.ts` with `FRAMES` const, a `MechanicId` union, `frameId` stored as a validated literal union, and an `assertMechanicEnabled` server check (chosen)** | Matches "frames ship in code". Exhaustive types. No seeding. Obvious extension point. | Removing or renaming a frame id needs a deploy plus a data migration, because the schema union couples them (see ADR). |
| C2. Seeded `frames` table | Could be edited in the app. | Contradicts the spec. Seed drift. **Invalidated.** |
| C3. Plugin module per mechanic | Scales to many mechanics. | Over-abstracted for three. Convex has a single `defineSchema`. Revisit at six or more mechanics. |

### Decision D — Idempotency store (new in iteration 2)

| Option | Pros | Cons |
|---|---|---|
| **D1. One `operations` table for every mechanic. Each event references `operationId`. Key index `(scopeKey, idempotencyKey)`. Rows also carry `campaignId` for audit and history queries. On replay, compare both `kind` and `requestHash` (chosen)** | One helper and one replay path. Matches the direction of `operations_foundation.sql` and campaign time. Events are linked to their operation for future undo. | Fear and countdowns used keys on the event or row tables in SQL. This is a storage change. Key scope and mismatch fields are reproduced, with one deliberate difference: in SQL, a Fear key and a campaign-time key in the same campaign were independent (separate tables). Under D1, reusing one key across two kinds in the same scope throws `IDEMPOTENCY_MISMATCH`. Clients generate a fresh UUID per intent, so this only rejects accidental reuse. |
| D2. A key per mechanic on its own event or row table, mirroring SQL storage | Storage is identical to the old app. | Three replay implementations. Countdown keys are scoped per countdown, not per campaign, so different keys would be needed. |

**Scope of each key under D1:**
- Fear and campaign time: keyed per campaign.
- Countdown create: keyed per campaign, as in SQL.
- Countdown operate: per countdown in SQL. Under D1 the scope key is `countdown:<countdownId>`, so the same key used on two different countdowns stays independent, as in SQL.
- Scope keys are built **only** through typed helpers in `convex/lib/operations.ts`:
  - `campaignScope(id: Id<"campaigns">)`;
  - `countdownScope(id: Id<"countdowns">)`;
  - `ownerScope(id: Id<"users">)`, only if PA-1 (idempotent campaign create) is approved. No string concatenation at call sites.

### Mode: DELIBERATE

This plan changes auth, the database platform and the audit-trail guarantees.

---

## 3. Pre-mortem (4 failure scenarios)

### 1. Lockout or bypass

**What goes wrong:** anyone with an OAuth account gets in, or the GM is locked out on game night. Possible causes:
- The allowlist check runs only in the UI.
- GitHub profiles do not prove the email was verified.
- Two providers create two users.

**Mitigation:**
- A pure function `isAllowedProfile(profile, env)` is unit-tested and called from `callbacks.createOrUpdateUser`.
- `requireGm(ctx)` in every function re-checks the stored user against the allowlist.
- Ownership checks apply on top of both.
- **Provider policy (OQ-3).** Recommended: Google only (`email_verified` is available), or lock by provider account id after the first sign-in.
- Manual OAuth smoke test on the **production** Convex deployment (R13).

### 2. Behaviour drift in the port

**Examples:** correction on a paused countdown, reopening a completed countdown, idempotency mismatch fields.

**Mitigation:**
- A parity matrix per mechanic is written **before** each mutation, from the SQL line ranges cited above and the old integration tests (`git show witherwild-final:tests/integration/{fear-adjustment,countdown-operations,campaign-time,operations-foundation}.db.test.ts`).
- A legacy SQL file is deleted only after its parity tests pass.
- Where the docs and the SQL conflict, ask the user rather than pick (OQ-11).

### 3. E2E cannot run

**Causes:** OAuth cannot be automated, and there is no backend.

**Mitigation:**
- An e2e credentials provider is registered only when **both** of these hold: the deployment URL is localhost or 127.0.0.1 (no other allowlist), **and** `E2E_AUTH_ENABLED=true`.
- E2E runs against a local Convex backend, with exact commands in Phase 1.
- An e2e that was not run is reported as "not run".

### 4. The destructive sweep deletes something that was meant to be kept, or the gate passes when it should fail

**Examples:** a kept test is removed, `.beads/` is touched, a PDF is deleted, or the grep gate is green only because the pattern is wrong. The old `pg\b` pattern also matched `jpg`, the wrong way round.

**Mitigation:**
- Before any `git rm`, the rollback point (`witherwild-final`, plus `rebuild` at `fb05359`) is pushed and checked on the remote. This needs user approval (Phase 0 step 0).
- `git rm` uses an explicit path list, never a glob over the repo root.
- After the sweep, a **keep-list assertion** runs `git ls-files` for every kept path and expects all of them to exist.
- The grep gate has a stated expected output (empty, exit 1).
- A spot check that the gate detects a seeded Supabase string in a scratch copy is optional.

---

## 4. Expanded Test Plan

### Unit (vitest `unit` project, jsdom)

- **Unchanged:** `tests/unit/{fear-domain,countdown-domain,campaign-time}.test.ts`.
- **Only the ID-field cases change** (per OQ-1): `tests/unit/{fear,countdown,campaign-time}-validation.test.ts`.
- **New `tests/unit/frames.test.ts`:** the registry contents, `isMechanicEnabled`, and rejection of an unknown frame.
- **New `tests/unit/campaign-validation.test.ts`:** trim, length, frame id.
- **New `tests/unit/auth-allowlist.test.ts`:** `isAllowedProfile`:
  - allowlisted email with `emailVerified === true` passes;
  - an unverified email fails;
  - `emailVerified` absent fails (this is what the Auth.js Google default `profile()` returns);
  - the overridden Google `profile()` maps a raw Google profile with `email_verified: true` to `emailVerified: true`, and with the field missing or false to not verified;
  - an email that is not allowlisted fails;
  - case and whitespace normalisation;
  - an empty or missing env var fails closed;
  - (if account-id lock is chosen) only the stored account id passes.
- **New `tests/unit/e2e-profile.test.ts`:** `buildE2EProfile`:
  - with the correct secret, it returns `{ email, emailVerified: true }`, and `isAllowedProfile` accepts that profile for the allowlisted e2e email;
  - with the wrong or missing secret, it returns `null`;
  - with the correct secret but an email that is not allowlisted, `isAllowedProfile` rejects it.
  - The e2e sign-in spec in Phase 1 covers the full path end to end.
- **New `tests/unit/e2e-provider-gate.test.ts`:** the e2e provider is excluded unless **both** the deployment URL is localhost or 127.0.0.1 **and** the flag is true. A `*.convex.cloud` URL with the flag set is excluded, and so is a missing URL.
- **New domain cases**, only where a SQL rule is not yet in the domain module, for example `canCorrectCountdown` and completed-reopen rules, added to the domain module with tests.

### Integration (vitest `convex` project: convex-test with `@edge-runtime/vm`, edge-runtime environment)

These run against the real Convex functions.

**What convex-test can and cannot prove:**
- It **cannot** run OAuth or the Convex Auth `createOrUpdateUser` callback.
- Auth is simulated: insert a `users` doc, then call `t.withIdentity({ subject: "<userId>|<sessionId>" })`.

**Authz:**
- With no identity, every public function throws `UNAUTHENTICATED`.
- An identity whose stored user email is not allowlisted throws `FORBIDDEN`.
- An identity for owner B on owner A's campaign, countdown or time throws.

**Isolation:**
- Per-campaign Fear, countdowns and time.
- List queries return only rows for their own campaign.
- A countdown id from campaign X is rejected when used with campaign Y.
- A `correctsEventId` from another campaign is rejected.

**Frame gating:**
- Phase 2: both frames start with Fear 0.
- Phase 5, once the `campaignTime` table exists:
  - campaign-time functions on a `core-only` campaign throw `MECHANIC_DISABLED`;
  - creating a Witherwild campaign initialises time to W1 / DAY / 1;
  - creating a core-only campaign creates no time doc.

**Idempotency (cross-cutting):**
- One key reused across two kinds in the same campaign scope throws `IDEMPOTENCY_MISMATCH`. For example, a Fear adjust and then a campaign-time advance with the same key. This is the documented difference from SQL.
- The same key in two different scopes is independent.

**Fear:**
- Decrease at 0 and increase at 12 throw `OUT_OF_RANGE` and change nothing.
- Each success adds one event plus one operation, and the total changes by ±1.
- A replay with the same key returns the original result (`replayed: true`) with no new rows.
- The same key with a different `amount` or `eventType` throws `IDEMPOTENCY_MISMATCH`.
- A correction adds a `correction` event and earlier events are unchanged.
- Invariant: the total equals the sum of the event amounts.

**Countdowns (matrix follows the OQ-11 answer; default = match SQL):**

*Create:*
- Writes the row and the operation, and **no event**.
- A replay returns the same countdown.
- A mismatch on name, description, category, startingValue or consequence throws.

*Paused:*
- Advance and reverse are rejected.
- Pause rejected.
- Resume → active.
- Cancel → cancelled.
- **Correction allowed** (default). A correction that reaches 0 → completed with `completedAt` set.

*Active:*
- Advance and reverse within bounds are accepted.
- Advance to 0 → completed and `completedAt` set.
- Pause → paused.
- Cancel → cancelled.
- Resume rejected.

*Completed:*
- Advance rejected.
- A **negative correction is rejected**.
- Pause, resume and cancel rejected.
- Reverse(+1) or positive correction → active with `completedAt` cleared.

*Lifecycle:* complete → reverse to reopen → advance to 0 again → completed with a **new** `completedAt`, and exactly one completion transition recorded per lifecycle.
- To get a strictly later timestamp, use `vi.useFakeTimers()` and advance the clock between the two completions, so the test cannot flake within one millisecond.
- If convex-test does not honour fake timers, assert that the first completion's `completedAt` was cleared on reopen and that the second is set and `>=` the first, without relying on strict ordering.

*Cancelled:* every intent throws.

*Bounds:* below 0 or above `startingValue` throws `OUT_OF_RANGE`.

*Event types:* events carry only the SQL action names, and `previousStatus`/`newStatus` are recorded.

*Operate idempotency:*
- Replay returns the original result.
- A mismatch on eventType, changeAmount or **normalised** reason throws.
- The reason is normalised as SQL `v_reason := nullif(btrim(p_reason), '')` (`:213`). So `" x "` and `"x"` replay equal, and `""` and `"  "` replay as null.
- The same key on a different countdown is independent.

**Campaign time:**
- Advance rolls over from DAY 7 to NIGHT 1, and from NIGHT 7 to DAY 1 of the next week, matching `getNextCampaignTime`.
- A replayed advance does not double-apply.
- A replay with mismatched metadata throws.
- A replay that switches intent (advance key reused for a correction) throws, because `kind` differs.
- A correction to the identical state is rejected.
- An advance with correction fields is rejected.
- `correctsEventId` from another campaign is rejected.
- A correction keeps the full event chain.

**Atomicity:**
- In convex-test, `t.run(async (ctx) => { await applyFearChange(ctx, …); throw new Error("boom"); })` calls the **shared write helper** (the same function the public mutation uses) and then throws.
- Assert that no event, operation or total change persisted.
- Repeat for `applyCountdownChange` and `applyCampaignTimeChange`.
- **Spike item (Phase 1):** confirm that convex-test `t.run` rolls back writes when its callback throws. If it does not, the fallback is a test-only mutation defined under `tests/convex/` (registered only in the convex-test module map, never in `convex/`), so nothing test-only is deployed.
- **No test-only mutations are shipped to production.** Helpers live in `convex/lib/*` (not exported as functions), and test code lives under `tests/convex/`.

### E2E (Playwright, local Convex backend plus the Next.js production build)

**Gate:**
- When signed out, `/`, `/frames/witherwild` and `/campaigns/<id>` all redirect to `/signin`.
- A wrong e2e email is rejected.

**Picker:**
- Sign in, see two frames, open Witherwild, see the empty state.
- Create `E2E <timestamp>` and land on the table view with Fear, Countdowns and Campaign Time.
- Core only has no Campaign Time panel.

**Fear:**
- Increase to 12 and the increase button is disabled.
- Decrease.
- Record a correction.
- The history shows the events.

**Countdowns:**
- Create.
- Advance to 0, shows completed.
- Reverse, reopens.
- Pause, advance is disabled.
- Resume.
- Cancel.
- The history is visible.

**Campaign time:** advance changes the phase name and the week, a correction with a note works, and the history shows both events.

**Live update:** with two browser contexts on the same campaign, changes in A show in B within 5 seconds with no reload.

**Tablet:** at 1024×768 and 820×1180, the primary actions are reachable with no horizontal scroll.

**Data hygiene:** there is no delete function, so each run uses unique campaign names. To reset the local backend, wipe local Convex data (exact method checked against the CLI version installed in Phase 1).

### Observability

- Stable error codes via `ConvexError({ code, message })`:
  - `UNAUTHENTICATED`
  - `FORBIDDEN`
  - `NOT_FOUND`
  - `MECHANIC_DISABLED`
  - `OUT_OF_RANGE`
  - `INVALID_TRANSITION`
  - `IDEMPOTENCY_MISMATCH`
- Errors appear in an `aria-live` region.
- One structured log line per committed operation (kind, campaignId, operationId, replayed), viewed in the Convex dashboard logs.
- `audit:reconcileFear` per PA-4.
- Vercel runtime logs for the Next.js layer. No paid monitoring.

---

## 5. Decisions required before each phase

| Blocks | Open question(s) | Default if the user defers |
|---|---|---|
| Phase 0 step 0 | OQ-13 (approve the push of the tag and branch) | Do not push; stop before `git rm` |
| Phase 0 | OQ-14 (export production Supabase data?), OQ-4 (documentation-audit.md), OQ-5 (shadcn ui and utils), OQ-10 (home for open rules questions), OQ-6 (task numbering), SD-1/SD-2 | OQ-14 has no safe default and must be answered. Others: keep `documentation-audit.md`; keep `ui/` and `utils.ts`; recreate `docs/open-questions.md`; use TASK-101+ |
| Phase 1 | OQ-3 (providers and lock policy), OQ-2 (how e2e signs in), OQ-1/SD-3 (ID schemas), OQ-15 (local vs. cloud dev deployment) | Google only, with the verified-email allowlist; e2e credentials provider on localhost; ID fields become `z.string().min(1)`; `--local` |
| Phase 2 | PA-1, PA-2, OQ-12 (name uniqueness scope), OQ-9 (rename, archive, delete) | No PA-1; names unique per owner (old rule); no rename, archive or delete |
| Phase 3 | PA-4, PA-5 | PA-4 only as a test helper; PA-5 shape is accepted as new |
| Phase 4 | **OQ-11 (correction while paused)** | Match the SQL (corrections allowed while paused) |
| Phase 6 | PA-3, OQ-7 (`.claude/settings.json` allowlist) | No indicator; settings untouched |
| Phase 7 | OQ-8 (historical sections of game-interpretation) | Mark them historical |

---

## 6. Implementation Phases

Each phase becomes one task doc in `docs/tasks/` and one bd child issue under the epic "Rebuild first slice" (prefix `dcm-`; IDs assigned by `bd` at execution time, with dependencies via `bd dep`).

"Checks" means:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e      # from Phase 2, with the local Convex backend (Phase 1 commands)
```

### Phase 0 — Safety point, sweep, and AGENTS.md rewrite

**Task doc:** `TASK-101-repo-sweep.md`. **bd issue:** "Sweep Witherwild app from rebuild".

**Step 0: recovery point. This pushes outward and needs explicit user approval at execution time.**

```bash
git push origin witherwild-final rebuild
git ls-remote --tags origin | grep 'refs/tags/witherwild-final'   # expect one line
git ls-remote --heads origin rebuild                              # expect the local rebuild SHA
```

If approval is refused, record it in the task doc and continue only after the user accepts that the recovery point is local only.

**Step 1: prerequisite doc transfer.** Copy the source of the Fear range (0 to 12, from `docs/campaign-house-rules.md:17-23`) into the Fear section of `docs/game-interpretation.md`.

**Step 2: rewrite `AGENTS.md` now,** outside the bd marker ranges. The rewrite covers:
- scope (frames, core vs. frame-exclusive mechanics, "ask the user before designing any unspecified mechanic");
- the Convex stack;
- the source-of-truth hierarchy, cut down to the docs that survive (`rules-index`, `game-interpretation`, `glossary`, `data-model` once created, `docs/tasks/`, and the open-questions home from OQ-10);
- Convex transaction and idempotency rules replacing the SQL and RLS rules;
- the **RSC vs. client note:** Server Components for layout, the auth gate and static shells, and Client Components with `useQuery`/`useMutation` for live mechanic panels (needed for live updates);
- the actual commands.

Phase 1 finishes the Convex-specific details. Create the open-questions file chosen in OQ-10 (default: a new empty `docs/open-questions.md` with the entry format).

**Step 3: run `git rm` on explicit paths:**
- **App code:**
  - `src/app/**` and `src/middleware.ts`;
  - `src/components/{campaign,campaign-time,campaign-timeline,character-sheet,characters,countdowns,fear,food,inventory,layout,sheet-templates}`;
  - `src/lib/{data,hooks,pdf,supabase}`;
  - `src/lib/domain/{character-sheet,characters,food,inventory,sheet-templates}`;
  - `src/lib/validation/{auth,campaigns,character-sheet,characters,food,inventory,sheet-template-fields,sheet-templates}.ts`.
- **Tests:** every file under `tests/unit/` except the six that are kept, plus `tests/integration/**` and `tests/e2e/**`.
- **Other files:**
  - `scripts/create-gm-user.ps1` and `scripts/reset-gm-password.ps1`;
  - `public/{file,globe,next,vercel,window}.svg`;
  - `docs/{architecture,campaign-house-rules,data-model,implementation-priorities,open-questions,product-spec,witherwild-notes}.md`, with the old `docs/open-questions.md` replaced per OQ-10;
  - `docs/tasks/*`;
  - `supabase/{config.toml,seed.sql}` and the remaining migrations.
- **Not deleted yet (pending OQ):**
  - `src/components/ui/` and `src/lib/utils.ts` (OQ-5);
  - `docs/documentation-audit.md` (OQ-4).

**Step 4: move legacy SQL (SD-1/SD-2) with `git mv` to `reference/legacy-sql/`:**
- `20260718090000_phase1_schema.sql`
- `20260719090000_fear_tracker.sql`
- `20260719090100_remove_fear_reasons.sql`
- `20260719110000_countdown_tracker.sql`
- `20260719120000_operations_foundation.sql`
- `20260719130000_campaign_time_tracker.sql`
- `20260724090000_campaign_name_unique_per_owner.sql`

Add `reference/legacy-sql/README.md` saying these are read-only and to be deleted after parity.

**Step 5: rewrite these config files:**
- `package.json`:
  - remove `@supabase/ssr`, `@supabase/supabase-js`, `pg`, `@types/pg`, `pdfjs-dist`, `unpdf`;
  - keep the scripts as they are;
  - run `pnpm install` to regenerate `pnpm-lock.yaml`.
- `playwright.config.ts`: remove the Supabase comment and `globalSetup`, so it has a plain `webServer`. Phase 1 rewrites it for Convex.
- `vitest.config.ts`: unchanged until Phase 1.
- `components.json`: unchanged if OQ-5 keeps `ui/`; otherwise delete it and re-run `shadcn init` when needed.
- `eslint.config.mjs`: remove the `supabase/.temp/**` ignore.
- `next.config.ts`: remove the `serverActions.bodySizeLimit` block.
- `.env.example`: replace with placeholders for `CONVEX_DEPLOYMENT=` and `NEXT_PUBLIC_CONVEX_URL=`.
- `.gitignore`: remove the "supabase local state" block.

Leave these untouched: `.beads/`, `.omc/`, `.codex/`, `.cursor/`, `.agents/`, `.claude/` (OQ-7), `CLAUDE.md`, both PDFs, and `core.hooksPath`.

**Step 6: placeholder app** so the build passes: `src/app/layout.tsx`, `src/app/page.tsx`, and a recreated `src/app/globals.css` (Tailwind import plus the shadcn tokens kept if OQ-5 keeps `ui/`).

**Done when:**

**Keep-list assertion** (every path printed; the exit code is 0):

```bash
git ls-files --error-unmatch src/lib/domain/fear/index.ts src/lib/domain/countdowns/index.ts \
  src/lib/domain/campaign-time/index.ts src/lib/validation/fear.ts src/lib/validation/countdowns.ts \
  src/lib/validation/campaign-time.ts tests/unit/fear-domain.test.ts tests/unit/fear-validation.test.ts \
  tests/unit/countdown-domain.test.ts tests/unit/countdown-validation.test.ts tests/unit/campaign-time.test.ts \
  tests/unit/campaign-time-validation.test.ts docs/rules-index.md docs/game-interpretation.md docs/glossary.md \
  reference/daggerheart-srd.pdf "reference/official/Daggerheart - Gillus - Character Sheets US.pdf" \
  .beads/config.yaml AGENTS.md CLAUDE.md
```

**Code/config grep gate.** This gate covers code and config only. The expected output is **empty** and the exit code is **1** (no matches):

```bash
git grep -n -i -E 'supabase|@types/pg|"pg"|\bfrom "pg"' -- \
  'src/**' 'convex/**' 'tests/**' 'scripts/**' \
  '*.json' '*.ts' '*.mjs' '.env.example' '.gitignore' 'pnpm-lock.yaml' \
  ':!.omc/**' ':!.claude/**' ':!.beads/**' ':!reference/**'
```

- `\bpg\b` alone is not used, because it is too broad (`jpg`, prose).
- **Excluded on purpose:**
  - All Markdown is out of scope, so new task docs, `docs/open-questions.md`, the historical sections of `game-interpretation`, `README.md` and `docs/documentation-audit.md` cannot fail this gate. Markdown goes through the docs check below.
  - `.claude/settings.json` (Supabase allowlist entries) is left to the user (OQ-7).
  - `.beads/` is bd-owned.
  - `reference/` holds the legacy SQL and the PDFs.
- Run the gate on the working tree after `git add -A`, so unstaged deletions are not counted.

**Docs check (labelled historical mentions only).** Every Supabase mention in Markdown must sit on a line that labels it as historical. The expected output is **empty**, with exit code 1 from the final `grep`:

```bash
git grep -n -i supabase -- '*.md' \
  ':!.omc/**' ':!reference/legacy-sql/**' ':!docs/documentation-audit.md' ':!README.md' \
  | grep -v -i -E 'historical|legacy|witherwild-final|replaced by convex'
```

- In Phase 0, `README.md` is exempt (rewritten in Phase 7).
- In Phase 7, the same command is run **without** `':!README.md'`.
- `docs/documentation-audit.md` stays permanently exempt if OQ-4 keeps it, because it is a historical audit. If OQ-4 deletes it, it is deleted in Phase 0 and its exclusion is dropped.

**Root-file check.** `git ls-files | grep -v /` lists only these files:
- `.env.example`, `.gitignore`
- `AGENTS.md`, `CLAUDE.md`, `README.md`
- `components.json` (if OQ-5 keeps it)
- `eslint.config.mjs`, `next.config.ts`
- `package.json`, `playwright.config.ts`
- `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `postcss.config.mjs`, `tsconfig.json`
- `vitest.config.ts`, `vitest.setup.ts`

`README.md` stays as is until Phase 7.

**bd blocks unchanged:**

```bash
for f in AGENTS.md CLAUDE.md; do
  diff <(git show witherwild-final:$f | sed -n '/<!-- BEGIN BEADS/,/<!-- END BEADS/p') \
       <(sed -n '/<!-- BEGIN BEADS/,/<!-- END BEADS/p' $f) && echo "$f bd blocks OK"
done
```

**Remaining checks:**
- `pnpm test` runs the six kept unit tests and they pass.
- Lint, typecheck and build pass.

### Phase 1 — Convex + Next.js scaffold + auth locked to one account

**Task doc:** `TASK-102-convex-auth-platform.md`. **bd issue:** "Convex + Convex Auth platform".

**Step 1: spike first (timeboxed).**
- Install the dev dependencies `convex-test` and `@edge-runtime/vm`.
- Write one trivial convex-test case under the installed **vitest 4**.
- If they are incompatible, stop and raise it. Pinning or downgrading vitest needs approval.

The spike also confirms, and records in the task doc:
- (a) `t.run` rolls back on throw;
- (b) `CONVEX_CLOUD_URL` can be read at module scope;
- (c) the Google `profile()` override and `emailVerified` pass through;
- (d) the Convex Auth helper works under `proxy.ts`;
- (e) the `npx convex dev --local` flags for the installed CLI.

**Step 2:** add the dependencies `convex`, `@convex-dev/auth` and `@auth/core`. Run `npx convex dev` (USER STEP: login and project), which generates `convex/_generated` and `convex/tsconfig.json`.

**Step 3: import boundary.**
- Change `src/lib/validation/countdowns.ts:3-6` to `from "../domain/countdowns"`.
- Add an ESLint `no-restricted-imports` override for `src/lib/{domain,validation,frames}/**` and `convex/lib/allowlist.ts` that forbids:
  - `react` and `react-dom`;
  - `next` and `next/*`;
  - `@/components/*`;
  - `convex/react`;
  - the `@/*` alias (forces relative imports that Convex can bundle).

**Step 4: typecheck coverage.** `pnpm typecheck` (root tsconfig, includes `convex/**`) and `npx convex dev --once --typecheck=enable` must both pass with `convex/*` importing `../src/lib/...`. Exclude `convex/_generated` from lint, not from typecheck.

**Step 5: schema and auth files.**
- `convex/schema.ts` with `...authTables`.
- `convex/lib/allowlist.ts`:
  - pure `isAllowedProfile(profile, env)`. It requires `profile.emailVerified === true` and an email in the normalised `GM_EMAILS` (or the stored account id, if OQ-3 chooses the account-id lock), and fails closed when anything is missing;
  - pure `isE2EDeployment(env)`. It is true only when the `CONVEX_CLOUD_URL` host is `localhost` or `127.0.0.1`, with **no** dev-deployment allowlist.
  - Confirm in the spike that `process.env.CONVEX_CLOUD_URL` can be read at **module scope** in `convex/auth.ts`, where the provider list is built. If it cannot, the provider must be registered unconditionally and its `authorize` must re-check `isE2EDeployment` on every call and reject otherwise.
- `convex/auth.ts`:
  - providers per OQ-3;
  - **Google `profile()` override:** the Auth.js Google default `profile()` returns `{ id, name, email, image }` and drops `email_verified`. Override it to return `{ id: p.sub, name: p.name, email: p.email, image: p.picture, emailVerified: p.email_verified === true }`. Confirm the field names and whether `emailVerified` passes through to `createOrUpdateUser` against the installed `@convex-dev/auth` and `@auth/core` in the spike;
  - the e2e `ConvexCredentials` provider, added only if `isE2EDeployment(env) && env.E2E_AUTH_ENABLED === "true"`, which authorises `{ email, secret }` against `E2E_AUTH_SECRET`.
    - Only **after** a constant-time secret match does `authorize` build the profile `{ email, emailVerified: true }` and pass it to `createOrUpdateUser`. On a mismatch it returns `null` without building a profile.
    - Without `emailVerified: true`, `isAllowedProfile` would reject the e2e GM.
    - The provider logic lives in a pure helper `buildE2EProfile(input, env)` in `convex/lib/allowlist.ts`, so it can be unit-tested;
  - `callbacks.createOrUpdateUser` calls `isAllowedProfile` and links to the existing GM user.
- `convex/auth.config.ts` and `convex/http.ts`.
- `convex/lib/auth.ts` with `requireGm(ctx)`.

**Step 6: Next.js wiring.**
- The layout uses the `ConvexAuthNextjsServerProvider` and client providers.
- `src/proxy.ts`: confirm the Convex Auth helper works under Next 16's `proxy.ts`, and fall back to `middleware.ts` if not (R5).
- `src/app/signin/page.tsx` has the provider buttons. An e2e email+secret form renders only when `NEXT_PUBLIC_E2E_AUTH=true` at build time.

**Step 7: vitest projects.**
- `unit`: jsdom, `tests/unit/**`, existing setup.
- `convex`: `environment: "edge-runtime"`, `server.deps.inline: ["convex-test"]`, `tests/convex/**`.

**Step 8: e2e infrastructure (exact commands).** First check the flags against `npx convex dev --help` for the installed version.

One-time local setup:

```bash
npx convex dev --local --once                    # creates and starts the local deployment, pushes functions
npx @convex-dev/auth                             # sets JWT_PRIVATE_KEY, JWKS, SITE_URL on the selected (local) deployment
npx convex env set SITE_URL http://localhost:3000
npx convex env set GM_EMAILS e2e-gm@example.test
npx convex env set E2E_AUTH_ENABLED true
npx convex env set E2E_AUTH_SECRET "$(openssl rand -hex 16)"   # copy to .env.local as E2E_AUTH_SECRET
```

**Seeding the test GM.** No seed mutation is needed. On first e2e sign-in, the credentials provider calls `createOrUpdateUser`. On this local deployment `isAllowedProfile` accepts the allowlisted `e2e-gm@example.test`, so the user is created then. Production never has `GM_EMAILS` set to the test email, and never registers the provider.

`playwright.config.ts` rewrite:
- `webServer` becomes an array:
  1. `{ command: "npx convex dev --local", url: "http://127.0.0.1:3210/version", reuseExistingServer: true }`
  2. `{ command: "pnpm build && pnpm start --port 3000", env: { NEXT_PUBLIC_E2E_AUTH: "true" }, url: "http://localhost:3000" }`
- New `globalSetup` (`tests/e2e/global-setup.ts`) refuses to run unless `NEXT_PUBLIC_CONVEX_URL` is `http://127.0.0.1:*` or `http://localhost:*`, and `E2E_AUTH_SECRET` is set.

**Which deployment each command expects (OQ-15):**
- Proposed default: `.env.local` points at the **local** deployment (`CONVEX_DEPLOYMENT=local:…`, `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210`).
- `pnpm build` then builds against local. This only checks that the build compiles. Production builds happen on Vercel through `npx convex deploy`, which injects the production URL.
- `pnpm test:e2e` always uses the local deployment.
- `pnpm test` (convex-test) needs no deployment.
- Shared `tests/e2e/fixtures.ts` signs in through the e2e form.

**Step 9: USER STEPS (R1).**
- Create the OAuth app or apps (OQ-3) with the callback `https://<prod-deployment>.convex.site/api/auth/callback/<provider>`.
- On **production** Convex, `npx convex env set --prod` each of: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `GM_EMAILS`, `SITE_URL`, plus the auth keys via `npx @convex-dev/auth --prod`.
- Create the Vercel project with `CONVEX_DEPLOY_KEY` set in the **Production** environment only, and set the build command to `npx convex deploy --cmd 'pnpm build'`.
- Preview builds have no deploy key, so they would fail or point at nothing. Turn off preview deployments for the branch, or set an "Ignored Build Step" so only production builds run. Revisit this if previews are wanted (R13).
- **Never deploy a locally built `.next`.** The e2e build sets `NEXT_PUBLIC_E2E_AUTH=true`, which renders the e2e form. Production is always built by Vercel from source, without that variable.
- Re-run the manual production OAuth smoke after **every** deploy that touches auth (`convex/auth*.ts`, `convex/lib/allowlist.ts`, `convex/lib/auth.ts`, `src/proxy.ts`, the sign-in page). Record the date and result in the task doc.

**Done when (provable claims only):**
- Unit: `isAllowedProfile` and the e2e provider gate tests pass.
- Integration: `requireGm` passes for an allowlisted stored user. It throws `FORBIDDEN` for a user whose stored email is not allowlisted, and `UNAUTHENTICATED` with no identity.
- E2E: the signed-out redirect and the e2e sign-in work.
- **Manual (user):** on production, the GM's OAuth sign-in succeeds, and a second account not on the allowlist is refused with no `users` row created. Check this in the Convex dashboard.
- Checks pass.
- `AGENTS.md` has its Convex-specific sections finalised, and the bd-block diff is still OK.

### Phase 2 — Frame registry + campaigns + picker

**Task doc:** `TASK-103-frames-and-campaign-picker.md`. **bd issue:** "Frame registry and campaign picker".

**Step 1:** `src/lib/frames/index.ts` (C1).

**Step 2: schema.**
- `campaigns`:
  - fields: `ownerId`, `frameId` (literal union), `name`, `nameKey` (= `name.trim().toLowerCase()`, per PA-2 and OQ-12), `createdAt`;
  - indexes: `by_owner_frame`, `by_owner_nameKey`.
  - Uniqueness is checked in the mutation, and OCC makes that check race-safe.
- `campaignState`: `campaignId`, `fear`.
- `operations` fields:
  - `scopeKey`, built only via the typed helpers `campaignScope(id)`, `countdownScope(id)` and `ownerScope(id)`, which produce `campaign:<id>`, `countdown:<id>` and `owner:<id>`;
  - `campaignId?`: set for every campaign-scoped or countdown-scoped operation. It is **unset** for owner-scoped campaign create (PA-1), because the campaign does not exist when the key is checked;
  - `idempotencyKey`, `kind`, `summary?`, `requestHash`, `result`, `createdBy`, `createdAt`.
- Indexes: `by_scope_key` (scopeKey, idempotencyKey) for replay, and `by_campaign` (campaignId) for audit and history. Convex orders index results by `_creationTime` within equal keys, so no `createdAt` field is needed in the index.
- Both indexes are used, so the `campaignId` field is justified.

**Step 3: `convex/lib/operations.ts` `withIdempotency(ctx, { scopeKey, key, kind, request }, run)`.**
- `requestHash` is a stable JSON of the **normalised** request fields listed for each kind below: trimmed, with empty strings mapped to null, the same normalisation the SQL applies before comparing.
- On replay, compare **both** the stored `kind` and the stored `requestHash` (SQL compares `operation_type` as well as payload; `operations_foundation.sql:148-151`).
- If both match, return the stored `result`.
- If either differs, throw `IDEMPOTENCY_MISMATCH`.
- Reading the index range puts it in the OCC read set, so a concurrent duplicate is retried and sees the first write.
- The Convex client already retries an in-flight mutation once per connection, so keys cover reloads, double taps and new attempts by the user.
- The client creates the key per user intent with `crypto.randomUUID()` and reuses it on manual retry.

**Step 4: `convex/lib/mechanics.ts`** with `loadOwnedCampaign` and `assertMechanicEnabled`.

**Step 5: `convex/campaigns.ts`.**
- `listByFrame` and `get`.
- `create`: in one transaction, inserts the campaign and `campaignState { fear: 0 }`. It uses `withIdempotency` only if PA-1 is approved.
  - **Extension point only:** a named `initFrameMechanics(ctx, campaign)` helper, which is empty in Phase 2.
  - Phase 5 adds the `campaignTime` insert there, together with its table and tests.
- `nameKey` nuance: JS `trim()` strips all Unicode whitespace, while Postgres `btrim()` strips only spaces. JS `toLowerCase()` and Postgres `lower()` can also differ outside ASCII. The JS form is slightly stricter, which is acceptable for a single GM. Record this in `docs/data-model.md`.

**Step 6: minimal UI.**
- `src/app/(gm)/page.tsx`: the frames.
- `src/app/(gm)/frames/[frameId]/page.tsx`: the list, the create form and the empty state.
- `src/app/(gm)/campaigns/[campaignId]/page.tsx`: the table view, which renders the panels in `frame.mechanics`.
- New `src/lib/validation/campaigns.ts`.

**Step 7:** create `docs/data-model.md` for the Convex schema now, and update it in every later phase (AGENTS rule).

**Done when:**
- The frames unit tests pass.
- Integration tests pass for: create, list, isolation, a user who is not the owner, a duplicate name per OQ-12 (including case and whitespace variants), Fear 0 for both frames, idempotent create (if PA-1), and the `withIdempotency` cross-kind and cross-scope cases. The Witherwild time initialisation is tested in Phase 5.
- The picker and gate e2e tests pass.
- Checks pass.

### Phase 3 — Fear

**Task doc:** `TASK-104-fear.md`. **bd issue:** "Port Fear to Convex".

**Step 1: write the parity tests first,** from `20260719090100_remove_fear_reasons.sql:40-160` and the old `fear-adjustment.db.test.ts`.

**Step 2: schema `fearEvents`.** Fields: `campaignId`, `operationId`, `amount` (±1), `eventType` (`adjustment` or `correction`), `previousValue`, `newValue`, `createdBy`, `createdAt`. Index `by_campaign`.

**Step 3: `convex/fear.ts`.**
- `adjust({ campaignId, direction, eventType, idempotencyKey })`:
  1. `requireGm`
  2. `loadOwnedCampaign`
  3. `assertMechanicEnabled("fear")`
  4. `withIdempotency({ scopeKey: campaignScope(id), kind: "fear_adjust", request: { amount, eventType } })`. These are the SQL mismatch fields from `:93-99`.
  5. The shared helper `applyFearChange`, which calls `calculateFearAfterAdjustment`, patches the total and inserts the event.
- The result shape is PA-5.
- Also `current` and `history` (paginated).

**Step 4: UI `src/components/fear/fear-panel.tsx`.**
- +/− buttons with targets of at least 44 px, disabled by `canIncreaseFear` and `canDecreaseFear`.
- A correction toggle.
- History.

**Step 5:** after the tests pass, run `git rm reference/legacy-sql/{20260719090000_fear_tracker,20260719090100_remove_fear_reasons}.sql`.

**Done when:**
- The Fear integration matrix and the atomicity test pass.
- The Fear e2e passes.
- `docs/data-model.md` is updated.
- Checks pass.

### Phase 4 — Countdowns

**Task doc:** `TASK-105-countdowns.md`. **bd issue:** "Port countdowns to Convex".

**Blocked by OQ-11.**

**Step 1: write the matrix tests first,** from `20260719110000_countdown_tracker.sql:38-427` and the old `countdown-operations.db.test.ts`, following the OQ-11 answer.

**Step 2: schema.**
- `countdowns`: `campaignId`, `name`, `description`, `category`, `startingValue`, `currentValue`, `status`, `consequence`, `completedAt?`, `operationId`, `createdAt`. Index `by_campaign_status`.
- `countdownEvents`: `countdownId`, `campaignId`, `operationId`, `eventType` (the SQL set `advance | reverse | pause | resume | complete | cancel | correction | undo`, of which only the six action names are written), `changeAmount`, `previousValue`, `newValue`, `previousStatus`, `newStatus`, `reason?`, `createdBy`, `createdAt`. Index `by_countdown`.
- **No `create` event type** (iteration 1 invented it, and it is dropped). Creation history is the operation row of kind `countdown_create`.

**Step 3: `convex/countdowns.ts`.**
- `create`: `withIdempotency` with `scopeKey: campaignScope(id)`, `kind: "countdown_create"`, and request = `{ name, description, category, startingValue, consequence }` (SQL `:117-121`).
- `operate`: `scopeKey: countdownScope(id)`, `kind: "countdown_operate"`, request = `{ eventType, changeAmount, reason: normalisedReason }`, where `normalisedReason = reason.trim() || null` (SQL `v_reason := nullif(btrim(p_reason), '')`, `:213`, compared at `:275-277`). Create uses `campaignScope(id)`, and its text fields are normalised the same way. The branch order copies SQL `:298-351`. It goes through the shared helper `applyCountdownChange`.
- `listByCampaign` and `history`.
- Any SQL rule missing from `src/lib/domain/countdowns` is added there with a unit test (for example, "completed reopens only with a positive reverse or correction", and correction eligibility per OQ-11).

**Step 4: UI `src/components/countdowns/*`.** A list grouped by status, a create dialog, intent buttons gated by the `can*` guards, and history.

**Step 5:** after the tests pass, run `git rm reference/legacy-sql/{20260718090000_phase1_schema,20260719110000_countdown_tracker}.sql`.

**Done when:**
- The matrix, idempotency and atomicity tests pass.
- The countdown e2e passes.
- `docs/data-model.md` is updated.
- If OQ-11 is answered "match SQL", `docs/game-interpretation.md:65` is corrected.
- Checks pass.

### Phase 5 — Witherwild campaign time

**Task doc:** `TASK-106-witherwild-campaign-time.md`. **bd issue:** "Port Witherwild campaign time".

**Step 1: write the parity tests first,** from `20260719130000_campaign_time_tracker.sql:99-375` and the old `campaign-time.db.test.ts` and `operations-foundation.db.test.ts`.

**Step 2: schema.**
- `campaignTime`: `campaignId` (unique via index), `week`, `cycle`, `cycleDay`.
- `campaignTimeEvents`: `campaignId`, `operationId`, `eventType` (`advance` or `correction`), previous and new `{week, cycle, cycleDay}`, `note?`, `correctsEventId?`, `createdBy`, `createdAt`. Index `by_campaign`.

**Step 3: `convex/campaignTime.ts`.**
- `change`:
  - `withIdempotency` with `scopeKey: campaignScope(id)`, `kind: "campaign_time_<intent>"` (`kind` is compared on replay, as SQL compares `operation_type`);
  - the request is the SQL metadata `{ intent, targetWeek, targetCycle, targetCycleDay, note (normalised), correctsEventId }` (`:212-219`);
  - `summary` ("Advance one campaign day" / "Correct campaign time", `:227-230`) is stored on the operation. SQL also compares `summary` (`operations_foundation.sql:150`), but it is a pure function of `intent`, so comparing `kind` covers it and it is not hashed separately;
  - Phase 5 also fills in `initFrameMechanics` so that Witherwild campaigns get `campaignTime` W1/DAY/1, with its gating tests;
  - **advance** uses `getNextCampaignTime`;
  - **correction** uses `assertValidCampaignTime`, must differ from the current state, and `correctsEventId` must be in the same campaign;
  - writes go through the shared helper `applyCampaignTimeChange`.
- `current` and `history`.
- Every function calls `assertMechanicEnabled("campaignTime")`.

**Step 4: UI `src/components/campaign-time/time-panel.tsx`.** It shows the week, the cycle, and `getPhaseName` (never stored), with one-tap advance, a correction form and history.

**Step 5:** after the tests pass, remove the remaining files and then the directory: `git rm -r reference/legacy-sql/`.

**Done when:**
- The campaign-time integration tests pass, including gating and atomicity.
- The e2e passes.
- No legacy SQL is left.
- `docs/data-model.md` is updated.
- Checks pass.

### Phase 6 — Live updates across devices + hardening

**Task doc:** `TASK-107-live-updates-and-hardening.md`. **bd issue:** "Live update and hardening".

1. Live-update spec with two contexts in Playwright.
2. Loading states: a skeleton while `useQuery` returns `undefined`.
3. Error states: errors mapped by code into an `aria-live` region.
4. Connection indicator, if PA-3 is approved.
5. Accessibility pass: labels, focus order and contrast.
6. Tablet viewport e2e.
7. Sweep test for unauthenticated calls. `api` in `_generated` is an `anyApi` Proxy and cannot be enumerated, so the test iterates the modules instead.
   - It uses `import.meta.glob("../../convex/*.ts")`, the same module map convex-test uses.
   - For each exported registered query or mutation (excluding `auth.ts` and `http.ts` internals), it calls the function without an identity and expects `UNAUTHENTICATED`.
   - A guard assertion fails if the count of found functions is zero, so the test cannot pass while checking nothing.

**Done when:** all e2e tests pass, the sweep test passes, and the checks pass.

### Phase 7 — Docs finalisation

**Task doc:** `TASK-108-docs-finalisation.md`. **bd issue:** "Finalise docs".

1. Final pass over `AGENTS.md`, which was rewritten in Phase 0/1. Run the bd-block diff check.
2. Audit `docs/data-model.md` against `convex/schema.ts`.
3. `docs/game-interpretation.md`:
   - campaign weeks and calendar are marked Witherwild-exclusive;
   - Food, Inventory, Characters and Wither tokens are handled per OQ-8.
4. New `README.md`: setup, the user steps, local e2e and commands.
5. Task statuses updated with evidence.

**Done when:**
- The Phase 0 code/config grep gate, re-run unchanged, is still empty (exit 1).
- The docs check, re-run **without** `':!README.md'`, is empty (exit 1). It covers task docs, `AGENTS.md`, `README.md` and `docs/*.md`.
- The bd-block diff is OK.
- Checks pass.

---

## 7. Acceptance Criteria

### Picker and auth

**AC1.** While signed out, every app route redirects to `/signin` [e2e]. With no identity, every public Convex function throws `UNAUTHENTICATED` [integration sweep].

**AC2.** The sign-up lock, proven at three layers:
- (a) `isAllowedProfile` rejects these and accepts only verified, allowlisted identities (or the stored account id) [unit]:
  - an unverified email;
  - an email that is not allowlisted;
  - a missing allowlist (fail closed).
- (b) `requireGm` rejects a stored user who is not allowlisted [integration].
- (c) On production, an OAuth account that is not allowlisted is refused and creates no `users` row [manual, user].

**AC3.** `/` lists exactly the frames in `FRAMES` (Witherwild, Core only) [unit + e2e].

**AC4.** `/frames/:frameId` lists only the GM's campaigns in that frame. Create stores that `frameId`. An unknown frame is rejected. Duplicate names are rejected per OQ-12 [integration + e2e].

**AC5.** The table view renders exactly the panels in `frame.mechanics` [e2e]. Campaign-time functions on core-only campaigns throw `MECHANIC_DISABLED` [integration].

### Fear

**AC6.** Fear stays within 0 to 12, and out-of-range requests change nothing [integration].

**AC7.** Each successful adjustment adds exactly one `fearEvents` row and one `operations` row, and changes the total by the event amount, all in one mutation. Same-key replay adds nothing. A same-key mismatch on `amount` or `eventType` throws [integration]. The atomicity test persists nothing [integration].

**AC8.** A correction is a new `correction` event. Prior events are unchanged. Total = Σ amounts [integration].

### Countdowns

**AC9.** Transitions match `20260719110000_countdown_tracker.sql:298-351` exactly, subject to OQ-11 (default: correction allowed while paused), including the completed and cancelled rules [integration matrix].

**AC10.** Value stays within 0 and `startingValue`. Reaching 0 sets `completed` and a fresh `completedAt` once per lifecycle (complete → reopen → re-complete yields a new timestamp). Every operate writes exactly one event, whose type comes from the SQL set. Create writes no event. Create and operate idempotency use the SQL mismatch fields [integration].

### Campaign time

**AC11.** Only `week`, `cycle` and `cycleDay` are stored. No phase field exists on state or event docs. The UI shows `getPhaseName` [integration + e2e].

**AC12.** Advance follows `getNextCampaignTime`. Each change is one mutation, with one state update and one event. A retried advance does not double-apply. A metadata mismatch throws. A no-op correction is rejected [integration].

### Cross-cutting

**AC13.** A change in browser context A shows in context B within 5 seconds with no reload [e2e].

**AC14.** No query returns another campaign's or owner's documents, and ids from another campaign are rejected [integration].

**AC15.** The three domain unit tests pass unchanged. The three validation tests pass, with only the ID-field cases changed as approved under OQ-1 [unit].

**AC16.** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and `pnpm build` exit 0, and `npx convex dev --once --typecheck=enable` passes [local].

### Sweep

**AC17.** The Phase 0 checks all pass with their stated expected outputs: the keep-list assertion, the code/config grep gate (empty, exit 1; Markdown is out of its scope), the docs check (empty, exit 1; `README.md` exempt until Phase 7; `docs/documentation-audit.md` exempt permanently if OQ-4 keeps it), the root-file list and the bd-block diff. In Phase 7 both commands are re-run, the docs check with `README.md` included, and both are empty. Legacy SQL is gone by the end of Phase 5. Both PDFs are present.

---

## 8. Risks and Mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Convex Auth OAuth needs user action** (OAuth apps, the Convex login, the Vercel deploy key). | Marked USER STEP in Phase 1. Phases 2–6 continue with convex-test and the local e2e provider. The Phase 1 manual check is required for AC2(c). |
| R2 | **Sign-ups are not truly locked.** GitHub does not expose email verification, and account linking could create a second user. | `isAllowedProfile` with three layers. OQ-3 recommends Google only or a lock on the provider account id. Fail closed if the env var is missing. |
| R3 | **Idempotency in Convex:** there are no unique constraints, and clients retry. | D1 single `operations` table. Reading the index range puts it in the OCC read set. A `requestHash` per kind uses the SQL mismatch fields. The Convex client retries once per connection, and keys cover reloads and new taps. |
| R4 | **Loss or edit of the audit trail.** | No update or delete on event and operation tables. Shared write helpers write state plus event plus operation in one mutation. Reconcile invariant. No campaign deletion (OQ-9). |
| R5 | Next 16 `proxy.ts` vs. the Convex Auth helper. | Spike in Phase 1. Convex functions remain the real gate. |
| R6 | Convex bundling of `src/lib` and the `@/` alias. | Relative import in Phase 1. ESLint bans `@/*` in `src/lib/{domain,validation,frames}`. Both typechecks are required. |
| R7 | **bd-generated blocks and `core.hooksPath`.** | Edit only outside the markers. Real diff command against `witherwild-final`. Never change `core.hooksPath`. Never `--no-verify`. Report hook failures. |
| R8 | **Leftover Supabase dependencies and config.** | Explicit list of config rewrites. Grep gate with exact expected output. The `.claude/settings.json` allowlist is left to the user (OQ-7). |
| R9 | **`docs/documentation-audit.md`** is not covered by the spec. | Not deleted. OQ-4. |
| R10 | Conflict between UUID ids and Convex ids. | OQ-1 and SD-3. |
| R11 | Destructive sweep without a remote recovery point. | Phase 0 step 0 push and verify, which needs user approval. Pre-mortem 4. |
| R12 | Live production Supabase data is abandoned. | OQ-14 blocks Phase 0. |
| R13 | **OAuth on Vercel preview fails.** Each Convex preview deployment has its own `.convex.site` callback URL and empty env unless defaults are set. | The OAuth smoke test runs on **production** only, and is re-run after every auth-touching deploy. `CONVEX_DEPLOY_KEY` is set in Production only, and preview builds are disabled or ignored. The e2e provider is limited to localhost, so previews can never enable it. |
| R18 | Google's default profile drops `email_verified`, so the lock silently accepts unverified emails or rejects everyone. | `profile()` override, plus `isAllowedProfile` requires `emailVerified === true`, plus a unit test for an absent flag, plus confirmation in the Phase 1 spike. |
| R19 | A locally built `.next` with `NEXT_PUBLIC_E2E_AUTH=true` is deployed. | Production is built only by Vercel from source. The backend provider is still localhost-gated, so the form alone cannot sign anyone in. |
| R14 | convex-test is incompatible with vitest 4. | Spike first in Phase 1. A pin or downgrade needs approval. |
| R15 | Free tier limits. | No polling. Paginated history. |
| R16 | The minimal UI gets replaced. | Thin panels over hooks and domain guards. |
| R17 | A doc-vs-SQL conflict is resolved silently. | OQ-11. The AGENTS rule is "identify conflict before changing either side". |

---

## 9. Verification Steps

1. After each phase, run the checks. From Phase 2, also run `pnpm test:e2e` against the local backend. Record exit codes in the task doc. Never claim a run that did not happen.
2. Parity review per mechanic: each SQL branch in the cited line ranges maps to a named test.
3. Sweep: the Phase 0 keep-list assertion, the grep gate (empty output, exit 1), the root-file list, and `git diff --stat witherwild-final..HEAD` (deletions, moves and the listed rewrites only).
4. Auth: the unauthenticated sweep test, the `isAllowedProfile` unit tests, the `requireGm` integration tests, and the **production** OAuth smoke test by the user (R13).
5. Live-play smoke on a real tablet and laptop against production (user, optional).
6. Docs: the bd-block diff loop from Phase 0 (prints `AGENTS.md bd blocks OK` and `CLAUDE.md bd blocks OK`), and the `docs/data-model.md` table list equals the `defineTable` names in `convex/schema.ts`.

---

## 10. Open Questions (user decisions; listed here, not decided)

| # | Question | Why it matters | Recommended default |
|---|---|---|---|
| OQ-1 | Change only the ID fields (`campaignId`, `countdownId`, `correctsEventId`) from `z.uuid()` to a non-empty-string Convex id schema, and change the matching test cases? | "Ported as-is" vs. Convex ids | Yes |
| OQ-2 | E2E sign-in through a local-only credentials provider, or no e2e for authenticated flows? | Whether the e2e acceptance criteria can be automated | Local-only provider |
| OQ-3 | Which providers, and how to lock: Google only with a verified-email allowlist, or GitHub/both with the lock on the provider account id after first sign-in? Which email or account? | GitHub profiles don't expose email verification | Google only, or account-id lock **ANSWERED 2026-10-16: Google only; allowlist `GM_EMAILS=petar.tosevski99@gmail.com` (verified email required).** |
| OQ-4 | `docs/documentation-audit.md`: delete or keep? | Not covered by the spec | Keep until answered |
| OQ-5 | Keep `src/components/ui/{badge,button,card,textarea}.tsx` and `src/lib/utils.ts` for the interim UI, or delete them and re-add later? | Sweep scope vs. the pending visual overhaul | Keep |
| OQ-6 | Task numbering: restart at TASK-101, continue at TASK-017, or a new scheme? | Consistency | TASK-101 |
| OQ-7 | Remove the Supabase-only allowlist entries from `.claude/settings.json`? | Only the user changes permission settings | User decides |
| OQ-8 | In `docs/game-interpretation.md`, mark the Food, Inventory, Characters and Wither tokens sections historical, or remove them? | They are non-goals, but the file is kept | Mark historical |
| OQ-9 | Rename, archive or delete campaigns in the first slice? | Not in the spec | None |
| OQ-10 | Where do open rules questions live? A new empty `docs/open-questions.md`, or bd issues labelled `rules-question`? | AGENTS "never guess rules" needs somewhere to record them. **Blocks Phase 0** | New `docs/open-questions.md` |
| OQ-11 | **Countdown correction while paused:** the SQL (`20260719110000_countdown_tracker.sql:309-332`) allows a correction on a paused countdown, which can complete it at 0. `docs/game-interpretation.md:65` says "Paused countdowns cannot change value until resumed". Which wins? | A conflict between the docs and the implementation. **Blocks Phase 4** | **Match the SQL** (the user chose "port as-is"), and correct the doc |
| OQ-12 | Campaign-name uniqueness scope: per owner (old rule) or per owner + frame? | PA-2 and the picker UX | Per owner |
| OQ-13 | Approve `git push origin witherwild-final rebuild` before the sweep? | This is the remote recovery point, and pushing is outward-facing | Yes |
| OQ-14 | Does live campaign data in the production Supabase project need exporting before it is abandoned? Who exports it, and in what format? | Data loss is irreversible. **Blocks Phase 0** | Must be answered **ANSWERED 2026-10-16: No export. The Supabase data is discarded; the code stays recoverable from `witherwild-final`.** |
| OQ-15 | Should `.env.local` (and so `pnpm build` and `pnpm test:e2e` locally) target the `--local` Convex deployment or a personal cloud dev deployment? | The e2e provider works only on localhost. A cloud dev deployment would need OAuth for e2e. **Blocks Phase 1** | `--local` **ANSWERED 2026-10-16: Both. Automated tests (unit/integration/e2e) always start their own throwaway `--local` backend via Playwright webServer/globalSetup; everyday `pnpm dev` and `.env.local` target a personal cloud dev deployment (real Google sign-in, tablet testing). Add the cloud dev Google OAuth redirect URL in Phase 1. Test-only sign-in stays localhost-only.** |

---

## 11. ADR

**Decision:**
- Rebuild in place on `rebuild` (A1).
- Keep the domain rules as pure TypeScript in `src/lib/domain`, called by thin Convex mutations through shared write helpers (B1).
- Ship frames as a static, typed registry in code, with server-side mechanic gating (C1).
- Use one `operations` table with request hashes per kind for idempotency, linked from every event (D1).
- Use Convex Auth with an allowlist enforced in a pure `isAllowedProfile` function and in every function's `requireGm`.

**Drivers:**
- Correctness parity with the SQL implementation: atomicity, idempotency and the audit trail.
- Live updates across devices for live play.
- Low cost of later change: the visual overhaul, adding mechanics one at a time, and possibly multi-user later.

**Alternatives considered:**
- Sweep strategy:
  - fresh scaffold plus copy-in (A2), rejected for the tooling and history risk;
  - orphan branch (A3), invalidated by the spec.
- Where logic lives:
  - logic inside mutations (B2), invalidated by the kept-module requirement;
  - domain moved into `convex/` (B3), rejected because it moves kept files.
- Frame registry:
  - seeded frames table (C2), invalidated by "frames ship in code";
  - per-mechanic plugins (C3), rejected as premature.
- Idempotency store: keys per mechanic on their own tables (D2), rejected as three replay paths.

**Why chosen:** these are the only combination that meets the spec's file-keep rules and "port as-is" while keeping one authoritative calculation. It gives transactional and idempotent compound operations without Postgres, and adds the least new abstraction.

**Consequences:**
- Convex bundles files from `src/lib`, so those modules must stay free of React, Next and `@/` imports. ESLint enforces this.
- Idempotency storage differs from the SQL. Fear and countdowns kept keys on their own event or row tables; here everything goes through `operations`, but the observable semantics (key scope, mismatch fields) are kept.
- `frameId` is a literal union in the Convex schema. Adding a frame is a code change plus a deploy. Removing or renaming one also needs a data migration for existing campaigns.
- E2E depends on a local Convex backend and a credentials provider that is registered only on localhost deployments.
- The idempotency key space is shared across kinds within a scope. Reusing a key across kinds is rejected, whereas the SQL tables kept them independent.
- OAuth is verified manually on production only.
- Validation ID fields diverge from the old UUID contract, pending OQ-1.

**Follow-ups:**
- Visual overhaul, once the references arrive.
- Rests and downtime, session log, adversaries and encounters, each after the user specifies the mechanic.
- Undo built on `operations.reversesOperationId`, if requested.
- Revisit the plugin registry (C3) if there are six or more mechanics.
- Convex preview environment if previews become necessary (R13).
- Resolve OQ-1 to OQ-15.

---

## 12. Changelog

### Iteration 2 (2026-10-16), from the Architect (SOUND WITH CHANGES) and Critic (REVISE) reviews

1. **Countdown parity.**
   - Verified that SQL `:309-311` blocks only advance and reverse while paused, and that a correction can complete a paused countdown (`:313-332`).
   - `docs/game-interpretation.md:65` conflicts with this, so it is added as OQ-11, defaulting to match the SQL.
   - The matrix and AC9 follow the answer.
2. **Countdown completion test.** Replaced the impossible "completedAt survives a correction at 0" case with the lifecycle test (complete → reopen → re-complete gives a new `completedAt`), plus rejection of advance and negative correction on a completed countdown.
3. **Event types.** Countdown event types now use the SQL constraint set from `phase1_schema.sql:177-186`. The invented `create` event is dropped, after verifying that SQL create writes no event. The Fear result shape is labelled as a new API (PA-5).
4. **Idempotency store.** Decision D added: a single `operations` store, with `requestHash` fields per kind matched to each SQL mismatch check (Fear `:93-99`; countdown create `:117-121` and operate `:275-277`; campaign-time metadata `:212-219`). Added the note on Convex client retries.
5. **Auth.**
   - Pure `isAllowedProfile` with unit tests.
   - AC2 and the Phase 1 done-criteria are reworded to what can be proven.
   - The GitHub email verification problem goes into OQ-3 (recommend Google or an account-id lock).
6. **E2E provider gate.** The provider is now gated by the deployment identity (a hard-coded dev URL list or localhost) and the flag. Added exact local-backend, `convex env set`, `playwright.config.ts` and globalSetup steps, and explained how the test GM is seeded with sign-ups locked.
7. **Phase 1 boundaries.**
   - Relative import introduced immediately.
   - Both typechecks are required.
   - ESLint `no-restricted-imports` boundary added.
   - convex-test spike under vitest 4 first.
8. **Phase 0 sweep.**
   - Every config rewrite is named, including the newly found `next.config.ts` body limit.
   - The grep gate excludes `AGENTS.md`, `CLAUDE.md` and `.claude/`, uses a fixed regex with no `pg\b`, and states its expected output.
   - Root-file allowlist added, plus a keep-list assertion.
   - `src/components/ui` and `src/lib/utils.ts` are kept pending OQ-5.
   - `globals.css` is recreated.
9. **Recovery point.** Added Phase 0 step 0: push and verify the tag and branch on the remote, which needs user approval (OQ-13). Noted that the remote tag could not be confirmed during planning. Added OQ-14 on exporting production Supabase data.
10. **AGENTS.md timing.** The rewrite moves to Phase 0/1 (stack, source-of-truth hierarchy, home for open questions, the RSC vs. client `useQuery` note). OQ-10 now blocks Phase 0. The bd-block verification is now a real `diff` against `witherwild-final`. `docs/data-model.md` is started in Phase 2 and updated every phase.
11. **Decisions table.** Added "Decisions required before each phase" (§5).
12. **Plan additions.**
    - Labelled PA-1 to PA-5, each needing approval. Verified that old campaign create was not idempotent.
    - PA-2 now follows the old case-insensitive, trimmed rule (`20260724090000…:9-10`), and that migration is kept in legacy-sql.
    - Added OQ-12 on uniqueness scope.
13. **Atomicity test.** Now convex-test `t.run`, calling the shared write helper and then throwing. No test-only mutations ship.
14. **OAuth smoke.** Moved to production. Preview limitations documented (R13).
15. **Pre-mortem.** Added a fourth scenario for the destructive sweep.
16. **Spec deviations.** Listed SD-1 to SD-3.
17. **Optional fixes.**
    - Corrected the UUID line citations.
    - Noted that the Fear parity target is ±1 at the app level while the SQL accepts any non-zero amount.
    - The Fear 0–12 range source (`campaign-house-rules.md:17-23`) is copied into game-interpretation before deletion.
    - The ADR notes that the `frameId` union couples frame removal to deploys and data migrations.
    - Filled the ADR.

### Iteration 3 (2026-10-16), from the Architect (SOUND WITH CHANGES) and Critic (REVISE) reviews

- **B1 Phase 0 grep gate.**
  - Verified that the kept `README.md` (lines 26, 35, 64–73) and `docs/documentation-audit.md` (lines 43, 75, 76) match "supabase".
  - The Phase 0 gate now excludes both and keeps its expected output (empty, exit 1).
  - Phase 7 re-runs the gate without the README exclusion.
  - AC17 updated to match.
- **B2 Google verified email.**
  - Google `profile()` override maps `email_verified` to `emailVerified`.
  - `isAllowedProfile` requires `emailVerified === true`.
  - Unit tests for an absent flag and for the override mapping.
  - Confirmed in the Phase 1 spike. R18 added.
- **B3 idempotency.**
  - Replay compares `kind` and `requestHash` (verified: `operations_foundation.sql:148-151` compares `operation_type`).
  - Countdown reason normalised as SQL `nullif(btrim(p_reason), '')` (verified at `countdown_tracker.sql:213`).
  - Campaign-time `summary` is stored. It is derived from intent (`:227-230`), so the `kind` comparison covers the SQL `summary` comparison (`:150`).
  - Typed `campaignScope`, `countdownScope` and `ownerScope` helpers.
  - `operations.campaignId` added, with a `by_campaign` index.
  - Cross-kind key reuse test, and the difference from SQL recorded in D1 and the ADR.
- **Optional changes applied:**
  - E2E gate limited to localhost (`DEV_DEPLOYMENT_URLS` dropped), with a module-scope `CONVEX_CLOUD_URL` check in the spike and an `authorize` fallback.
  - The unauthenticated sweep test iterates `import.meta.glob` modules, because the `anyApi` Proxy cannot be enumerated, and fails if it finds zero functions.
  - Lifecycle test uses a fake clock.
  - Witherwild time initialisation and its tests moved to Phase 5, with an empty `initFrameMechanics` extension point in Phase 2.
  - `nameKey` vs. Postgres `btrim`/`lower` nuance recorded.
  - `t.run` rollback added as a spike item, with a fallback under `tests/convex/`.
  - Deployment expectations for `pnpm build` and `pnpm test:e2e` documented. OQ-15 added and blocks Phase 1.
  - Vercel: `CONVEX_DEPLOY_KEY` in Production only, previews disabled, no local `.next` deploys, and the OAuth smoke re-run after each auth-touching deploy. R19 added.
  - Citation fixed to `game-interpretation.md:64`.

### Iteration 4 (2026-10-16), from the Critic (REVISE) and Architect (SOUND WITH CHANGES) reviews

- **Blocking 1, grep gate scope.**
  - The Phase 0/7 grep gate now covers code and config only (`src/`, `convex/`, `tests/`, `scripts/`, `*.json`, `*.ts`, `*.mjs`, `.env.example`, `.gitignore`, `pnpm-lock.yaml`, excluding `.omc`, `.claude`, `.beads` and `reference`). New task docs, `docs/open-questions.md` and the historical sections can no longer fail it.
  - Markdown goes through a concrete docs check: `git grep … '*.md' | grep -v` on the label words, with expected output empty.
  - `README.md` is exempt from the docs check until Phase 7. `docs/documentation-audit.md` is permanently exempt if OQ-4 keeps it.
  - The Phase 7 done-criteria (old lines 826 and 827 contradicted each other) and AC17 now say the same thing.
- **Blocking 2, e2e profile.**
  - The e2e `ConvexCredentials` `authorize` builds `{ email, emailVerified: true }` only after the `E2E_AUTH_SECRET` match, through a pure `buildE2EProfile`.
  - `tests/unit/e2e-profile.test.ts` covers the right secret, the wrong secret, and an email that is not allowlisted.
- **Optional changes applied:**
  - The scope-helper list includes `ownerScope` (only with PA-1).
  - `operations.campaignId` is unset for owner-scoped create.
  - The `by_campaign` index drops `createdAt`, because `_creationTime` orders it.
  - AC17 states that the documentation-audit exemption is permanent if OQ-4 keeps the file.

## 13. User decisions (2026-10-16)

- OQ-3: Google only; `GM_EMAILS=petar.tosevski99@gmail.com`.
- OQ-14: no export; Supabase data discarded.
- OQ-15: both (tests on throwaway `--local`; `pnpm dev` on personal cloud dev deployment).
- OQ-1, OQ-2, OQ-4 to OQ-13: recommended answers accepted. OQ-7: leave `.claude/settings.json` untouched. OQ-13: push `witherwild-final` and `rebuild` to origin before the sweep (approved).
- Plan additions approved: PA-1, PA-2, PA-3, PA-4, PA-5.
- Spec deviations SD-1 to SD-3: accepted with the recommended answers.
- Execution: ralph, phase by phase. Stop after each phase with a report; do not start the next phase without the user's go-ahead.

