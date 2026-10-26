# TASK-GL5: Same traits advancement twice in one level; subclass upgrade shows the card

Status: Review. Plan: `.omc/plans/guided-level-up.yaml`, tracer GL5 (depends on GL1, GL2, GL3). No server or engine change.

User, 2026-10-18: "allow this" (taking "+1 to two unmarked traits" twice in one level) and "show the card if you can" (the upgraded subclass card instead of GL1's note).

## What changed

- **Hook (`C/level-up-draft.tsx`):** `setPickTargets(option, tier, targets, index = 0)` sets the targets of the `index`th draft pick of that option and tier. Index 0 is the first pick, which is the old behaviour, so the callers in `identity.tsx` and `domains.tsx` work unchanged. An index past the picks changes nothing.
- **Traits twice (`level-up/history.tsx`, `tier-pickers.tsx`):**
  - GL1's "Take it once for level N in this tier." block is gone. The second box of the traits option in a tier can now take the level's other pick (accessible name `Tier T: +1 to two unmarked traits for level N (second pick)`).
  - The first pick's names did not change: the box is `Tier T: +1 to two unmarked traits for level N` and the chooser group is `Traits to raise for level N`.
  - Each traits pick gets its own chooser. The second is the group `Traits to raise for level N (second pick)`, and its text starts "Second pick: choose two other traits".
  - A trait that is marked this tier, or raised by the other pick, is disabled with "(marked)".
  - `TierPicker` takes `index`. `DraftRow` renders one picker per drafted pick, and options other than traits render only for index 0.
  - The engine already accepts four distinct unmarked traits. It flags a trait used in both picks ("<trait> is marked this tier.").
  - A third free box of the option is named "… (third pick)", so no two boxes share a name. Two picks per level means it is never tickable.
  - Unticking any draft box of the option removes the latest pick (GL0's `togglePick(…, false)`), together with its chooser.
- **Subclass card (`src/components/party/hero-card.tsx` + `.css`, new):**
  - The hero card (`HeroCard`) moved out of `sections/heritage.tsx` without change. Its `hc-card` styles moved out of `heritage.css`, and only `.hc-grid` stays there. The Heritage & Subclass tab renders the same markup.
  - Ticking "Upgraded subclass card" now shows "At level N you take your <rank> card." and the next rank's hero card (art, "Subclass" tag, name, "Specialization" or "Mastery", features). It is at most 320 px wide (`.adv-subclass` in `history.css`).

## Defaults taken (open questions)

- Unticking removes the latest traits pick, not the box clicked, because that is GL0's `togglePick` contract. The boxes look the same, but the second chooser (and its traits) goes away even when you untick the first box.
- A trait chosen in the other pick shows as "(marked)", the GL1 wording, not as "raised by your other pick".

## Verification

e2e ran on ports 3188/3488.

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest: 106 files, 1094 tests passed. `tier-boxes.test.ts` has 10 tests (+3), `level-up-draft.test.ts` has 13 (+1).
- `E2E_VISUAL=1` passed: GL5 (1), GL1 (1), S8 (1), S12 (1, hero cards on the Heritage tab), and `character-sheet.spec.ts` (3).
- Screenshots: `test-results/visual/GL5/traits-twice-{1440,390}.png`, `subclass-card-{1440,390}.png`.
