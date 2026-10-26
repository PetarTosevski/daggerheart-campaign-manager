# TASK-GL1: Tick advancements on the Level Up tier boxes

Status: Review. Plan: `.omc/plans/guided-level-up.yaml`, tracer GL1 (depends on GL0). No server or engine change.

## What changed

- **Target (`src/components/party/level-up/history.tsx`):** the Level Up region (`TierBoxes`) is always `#lu-target-advancements`. Its "Level Up" `h3` is the heading that `goTo("advancements")` focuses.
- **Draft mode:** when `useLevelUpDraft().active` is true, the tiers open at the new level (level 5 opens tier 3). Every row of an open tier is a `DraftRow`:
  - Marks from earlier levels stay read-only checkboxes with an ink tick. Their names are unchanged ("…, taken at level 3").
  - Draft marks are enabled checkboxes with a green tick on a pale green box, inside a green row with a "level N" tag. Unticking one calls `togglePick(option, tier, false)`.
  - Only the next free box of an option can be ticked (`togglePick(option, tier, true)`). Its accessible name is `Tier T: <OPTION_SHORT> for level N`. A second pick of the same option at the same level adds " (second pick)".
  - When the box can't be ticked, it is disabled and `aria-describedby` points to the reason. The reason comes from `availableOptions` (blocked or crossed out, shown in italics as "Crossed out: …"), or is "Both picks for level N are used.", or, for two-pick options, "It takes both picks for level N; untick your other pick first." Pick-count reasons are sr-only, so the boxes don't fill with repeated text.
  - Joined (cost 2) options keep their single joined box. Ticking one uses both picks.
  - A pill in the head reads "Level N: x / 2 picks".
  - Outside the mode the markup is the same as before.
- **Choosers (`tier-pickers.tsx`, new):** these show under a ticked row and use the old stepper's logic (cda2114):
  - traits: a group "Traits to raise for level N" with `lu-opt` chips. Traits marked this tier are disabled (marks clear at 5 and 8), and so are traits another traits pick raises this level. Once two are chosen, the others are disabled. This writes `setPickTargets`.
  - experiences: "Choose them in Experiences" calls `goTo("experiences")`. The chosen names show once GL2 sets them.
  - domainCard: "Choose it in the Domain Deck" calls `goTo("deck")`. The chosen card shows once GL3 sets it.
  - multiclass: a fieldset "Multiclass for level N" with Class, Domain (only that class's domains you don't already have) and Foundation card selects. These write `setMulticlass`.
  - subclass: no choice to make. A note names the card the subclass upgrades to.
- **Styles (`history.css`, new):** draft styles only. The base `adv-*` styles stay in `level-up.css`. In open tiers each box sits in a 44×44 slot, and a tickable box sits in a `label.adv-hit`. The selects are 44 px tall.

## Defaults taken (open questions)

- **One traits pick per tier per level.** The draft's `setPickTargets` sets the targets of the first pick of an option/tier only. So a second "+1 to two traits" box in the same tier at the same level is disabled ("Take it once for level N in this tier."). The rules may allow two at one level (four traits). Allowing it needs a per-pick target API in GL0's hook.
- **H&F classes in the multiclass select.** `TierBoxes` takes an optional `hopeAndFear` prop, false by default. `AdvancementTiers` in `level-up/index.tsx`, which GL1 does not own, does not pass it yet. Until it passes `hopeAndFear={hopeAndFear}`, the select lists core classes only.
- **Subclass:** the upgrade takes no choice (the engine raises `subclassRank`), so the "chooser" is a note.

## Verification

e2e ran on ports 3148/3408.

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest: 104 files, 1082 tests passed. The new `tests/unit/tier-boxes.test.ts` has 7 tests.
- `E2E_VISUAL=1` GL1 (1) passed. Screenshots: `test-results/visual/GL1/tier-2-draft-{1440,390}.png`.
