# TASK-RULES-RS0: rule registry, stored modes, setter, lock, Manual notes

Plan `.omc/plans/rule-switches.yaml`, tracer RS0 (epic dcm-jh6d part A, bead dcm-bxp.134). Inputs:
`.omc/plans/rule-registry-list.md` (the 61 rules with pages), `.omc/plans/rule-switches-briefs.md` (user answers
2026-11-05, binding). Nothing changes at the table: RS0 is the foundation every later rule tracer imports. This file is
their guide.

## What landed

| Piece | File |
|---|---|
| Registry: 71 rules (61 listed + 10 decided optional rules), their codes, areas, pages, kinds and modes | `src/lib/rules/registry.ts` |
| Resolver: `resolveRuleModes(frameId, stored)`, `isRuleValue`, `ruleBlockedBy` | `src/lib/rules/resolve.ts` (both re-exported by `src/lib/rules/index.ts`) |
| Stored shape `campaigns.ruleModes?` (typed `v.object` of optional fields), resolved shape, change union | `convex/lib/validators/ruleModes.ts`, `convex/tables/campaigns.ts` |
| Engine helpers: `ruleModesOf`, `ruleMode`, `rulesLocked`, `assertRulesUnlocked`, `postRuleNote` | `convex/lib/ruleModes.ts` |
| House rules API: `ruleSettings.get` (every member), `ruleSettings.set` (GM, co-GM) | `convex/ruleSettings.ts` |
| Lock on today's campaign options (Q17 a) | `campaigns.setOption` (`convex/campaigns.ts`) |
| `actionLog` kind `rule` + `ruleId?` (widened) | `convex/lib/validators/actionLog.ts` |
| Error `RULES_LOCKED` | `src/lib/errors/rules.ts` |

## Kinds and defaults

- `switch` (26) and `appRule` (1, M2 Walls and doors): modes in order `book`, variants, `manual`. Unset = `book`.
- `bookOnly` (34): no stored field; House rules shows a read-only row with `refs`.
- `optional` (10): on/off with `default` (all off except `definedRanges`), or `choices` (`sharedDomainCards`:
  `allow` / `warn` / `refuse`, default `warn`, Q16).
- Numbers set in a rule's row (`param`): `spotlightTrackerTokens` (Spotlight Tracker, 1–6, default 3, Q9 a) and
  `darknessDifficulty` (M3 Darkness, 1–4, default 2, Q6).
- `frames`: the rule exists only there (W1–W8, Horizon encounter bonuses). In another frame it resolves to `book` /
  its default whatever is stored, and the setter refuses it (`SETTING_INVALID`).
- `needs` (X2 → X1, Q8 a): while X1 `deathMovePrompt` is `manual`, X2 `deathMoveResolve` resolves to `manual` and its row
  is read-only (`ruleBlockedBy`; the setter refuses it).

Variants: F2 `extendedDowntime` (CB p.181, Q7 a: an extra choice on the GM's long rest, not every rest); D6 `gmPicks`
(not in the books, Q5 a); M3 `disadvantage` and `difficulty` (CB p.104) and `both` (not in the books: the book says
"or"); M2's `book` mode is the app's own rule, labelled "App rule", not in the books.

## How to read a mode (engine code)

Only through `ruleModesOf(campaign)` / `ruleMode(campaign, key)`. Never read `campaign.ruleModes` directly: the resolver
applies the defaults, the frame and X2's dependency.

```ts
import { ruleMode } from "./lib/ruleModes";

const mode = ruleMode(ctx.campaign, "fearFromRests"); // "book" | "extendedDowntime" | "manual", typed
const on = ruleMode(ctx.campaign, "massiveDamage"); // boolean
const tokens = ruleMode(ctx.campaign, "spotlightTrackerTokens"); // number
```

Pure domain functions take the mode as a parameter whose **default is the Book behaviour**, so an unwired caller keeps
today's behaviour and every existing test passes unchanged:

```ts
import type { ModeOf } from "../../rules/registry";

export function damageTaken(amount: number, resist: boolean, mode: ModeOf<"resistance"> = "book") { ... }
```

Engine reads are never locked: a mode changed between sessions applies at once.

## How to post a Manual note

```ts
import { postRuleNote } from "./lib/ruleModes";

if (ruleMode(ctx.campaign, "hopeFearFromRolls") === "manual") {
  await postRuleNote(ctx, ctx.campaign, {
    ruleId: "hopeFearFromRolls",
    summary: `${name} rolled with Fear: gain 1 Fear?`,
    characterId, // optional
    groupId,     // the action's groupId: undoing the action undoes the note
    actorId: ctx.user._id,
  });
}
```

- One `actionLog` row: kind `rule`, visibility `gm` (players never receive it from `feed.list`; co-GMs do), `ruleId`,
  summary cut at 300 characters. It changes no state.
- **Always pass the action's `groupId`.** With it the note is `undoable: true` (else `undoEntry` would refuse the whole
  group as UNDO_STALE) and is undone with the action; Undo pressed on the note undoes the whole action. Without a
  `groupId` it is never undoable.
- A note with `characterId` **must** carry the action's `groupId` (it throws otherwise): a stray row on the character
  would block undoing that character's earlier actions (`assertNothingNewer`).
- No blocking prompt (user 2026-11-05): the note is the whole Manual behaviour.

## House rules UI (tracer RU)

- `api.ruleSettings.get({ campaignId })` → `{ modes, locked, canEdit }`. `locked`: a session is live (disable every
  switch). `canEdit`: GM or co-GM, not archived, not the app owner's read-only view.
- `api.ruleSettings.set({ campaignId, change: { key, value } })`: one field per call (rule 12). Optimistic update on
  `ruleSettings.get`. Errors: `RULES_LOCKED`, `SETTING_INVALID` (another frame's rule, X2 while X1 is Manual, a number
  out of range), `CAMPAIGN_ARCHIVED`, `FORBIDDEN` for players. A value equal to the resolved one writes nothing.
- Rows: `rulesFor(frameId)` in registry order, grouped by `area`; `formatRef(ref)` gives "CB p.90"; a mode with
  `notInBooks` shows "not in the books"; `ruleBlockedBy(rule, modes)` marks X2 read-only ("Needs the death move prompt").
- Today's campaign options (`campaigns.setOption`) are locked the same way (Q17 a): `RULES_LOCKED` while live.

## How to add a rule, a variant or a number (widen only)

1. Registry (`src/lib/rules/registry.ts`): add the entry (or the mode before `manual`, with `notInBooks` and `ref`).
   Ids are stored keys: never rename or remove one.
2. Validator (`convex/lib/validators/ruleModes.ts`): add the field to `fields` (a new literal for a variant) and a
   `change("<id>")` member to `ruleChangeValidator`. The type drift checks at the bottom of the file and
   `tests/unit/rules/registry.test.ts` fail until both sides agree.
3. A number in a row: `param: { key, label, min, max, default }` on the rule, a `v.number()` field; the setter checks the
   range and whole numbers.
4. Update the count in `tests/unit/rules/registry.test.ts` and `docs/data-model.md`.

## Tests

- `tests/unit/rules/registry.test.ts`: the counts (61 / 27 / 34 / 10), codes per area, mode order, frames, the drift
  test (one validator field per settable rule and number, the literals equal the registry's modes), resolver defaults
  for every frame, frame hiding, fallbacks, X2.
- `tests/convex/rule-settings.test.ts`: get for GM / co-GM / player, lock, archived; set per kind, no-op writes,
  args-validator refusals, SETTING_INVALID cases, X2, RULES_LOCKED on `ruleSettings.set` and `campaigns.setOption`.
- `tests/convex/rule-notes.test.ts`: the note row, feed visibility (GM, co-GM, player), the 300-character cut, undo with
  the group, a note without a group, the characterId guard.
- `tests/convex/authz/rules.entries.ts`: `ruleSettings.get` (`view`) and `ruleSettings.set` (`gm`; grantee and other
  player FORBIDDEN).
