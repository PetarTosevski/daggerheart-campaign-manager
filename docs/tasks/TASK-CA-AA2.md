# TASK AA2: Server - adversary attacks and features against PCs, reaction window, Fear

Plan `.omc/plans/combat-actions.yaml`, tracer AA2 (wave 5, depends on CA4 and AA1). Analysis:
`.omc/autopilot/combat-actions-analysis.md` Part B (git-ignored). Book pages are printed pages; CB = Core Book.
Status: Review.

## What landed

| File | What |
|------|------|
| `convex/adversaryActions.ts` | Public: `attack`, `useFeature`, `respond`, `resolve`, `pending`, `windows`. |
| `convex/lib/adversaryActions.ts` | The adversary side: stat block (`blockOf`, SRD or custom), the scene (live map or party list), targets, spotlight and Fear, running AA1's `run` / standard attack, applying plans (`Work`), logging, the attacker's triggers after a hit (`afterHitTriggers`). |
| `convex/lib/incomingHits.ts` | The incoming-hit API: `openIncomingHit`, `rebuildWindow`, `respondToHit`, `resolveIncomingHit`, `hitView`, `groupUndone`, `partyMembers`, `bandsOnMap`, `windowPcOf`, `seededRng`. Reusable by CA4's card path (user answer 2026-10-22). |
| `tests/convex/adversary-actions.test.ts` | 17 behaviour tests. |
| `tests/convex/adversary-actions-authz.test.ts` | 9 role tests (anonymous, outsider, target's player, ally's player, other, GM). |
| `tests/convex/authz/adversary-actions.entries.ts`, `.test.ts` | The matrix area `adversary-actions` (6 functions, real rows in `setup`). |

No schema, validator or error code changed. AA0's `combatRequests` (`incomingHit` payload, `hitChoiceValidator`) and
actionLog kind `adversary` are used as they are.

## User answers implemented (quoted from the plan)

- **Q12 / Q16** "GM can use the encounter tab to use abilities, they will show up on combat, he can also use combat map
  if he wants": one server API for both pages.
- **Q13** "The hit PC's player chooses whether to mark an Armor Slot; the damage waits for that choice. Allies may respond
  with their abilities (e.g. 'I Am Your Shield', CB p.341): a reaction window after each adversary hit".
- **Q14** "Players see that they were hit, not the attack roll." Decision B0: the hit PC sees the damage and its severity
  against their own thresholds; other players see only "X hit Y".
- **Q15** "Automate EVERY adversary feature": every entry of the AE-* tables runs; a feature without an entry (custom
  blocks, groups whose table is still empty) runs as a manual GM prompt with its Fear and spotlight paid.
- **Q17 (a)** "the reaction window closes when the target chose armor and every eligible ally answered Use/Pass; the GM
  can 'Resolve now' anytime; no timer."
- **Q18 (a)** "with no live map the GM targets PCs from the party list with no range or line-of-sight restrictions."
- **Q19 (a)** "Fear spent only on the GM's tap; Fear-cost features and a second spotlight ask first; optional ones are a
  one-tap prompt defaulting to No; Fear gains automatic."
- **U4** "Damage applies automatically; the GM can undo it."
- **2026-10-22** "card damage to another PC (e.g. a Fireball blast catching an ally) opens the same incoming-hit prompt as
  an adversary attack": `convex/lib/incomingHits.ts` is that API (see "For CA4b" below; wiring is a follow-up bead).
- Orchestrator note: open combatRequests close when their encounter ends. `encounters.end` / `remove` already call CA3's
  `closeEncounterRequests`, which declines every open row of the encounter, hits included (tested here).

## Rules (quoted briefly, printed pages)

- **AR1** (CB p.160): "You make your attack roll with a d20. If the adversary has advantage or disadvantage on the attack,
  add an extra d20 to that roll." "You can also spend a Fear to add an adversary's Experience to the roll's result."
- **AR2** (CB p.148): "Whenever you roll a 20 on the d20, your roll automatically succeeds. … Start with the highest
  possible value the damage dice can roll, and then make a damage roll as usual".
- **AR3** (CB p.91): Severe 3 HP, Major 2, Minor 1; "When you mark your last Hit Point, you must make a death move."
- **AR4** (CB p.114): "reducing the severity of the damage by one threshold … Each time your character takes damage, you
  can only mark 1 Armor Slot." CB p.99: "Direct damage is … damage that Armor Slots can't be used to reduce."
- **AR6** (CB p.194): "For an adversary to use an action, they must have the spotlight." CB p.153: "You can spend a Fear to
  make an additional GM move, shifting the spotlight to another adversary."
- **AR7** (CB p.161): "you make one attack roll and ask if it hits any of the targets."
- **AR8** (CB p.195): reactions "don't take effect until their specific trigger occurs … you don't have to spend Fear".
  Momentum: "When this adversary makes a successful attack against a PC, you gain a Fear."
- **I Am Your Shield** (CB p.341): "mark a Stress to stand in the way and make yourself the target of the attack instead.
  When you take damage from this attack, you can mark any number of Armor Slots."
- **Q2** (CB p.104): "You have line of sight if you can see the target." Cover: "attack rolls against you are made with
  disadvantage."

## Public functions and roles

All asserted on `ConvexError.data.code` (`adversary-actions-authz.test.ts`, matrix area `adversary-actions`):

| Function | Wrapper | anon | outsider | other player | target's player | ally's player | GM |
|---|---|---|---|---|---|---|---|
| `adversaryActions.attack` | keyedGmMutation, rate limit `roll` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |
| `adversaryActions.useFeature` | keyedGmMutation, rate limit `roll` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |
| `adversaryActions.respond` | keyedCampaignMutation `need: "view"` + `loadCharacter` edit on `characterId`, rate limit `roll` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN (for a character not theirs) | ok (own) | ok (own) | ok (for anyone) |
| `adversaryActions.resolve` | keyedGmMutation | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |
| `adversaryActions.pending` | campaignQuery `need: "view"` + `loadCharacter` edit on `characterId` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN (not theirs) | ok (own) | ok (own) | ok |
| `adversaryActions.windows` | gmQuery | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |

Matrix access classes: `attack`, `useFeature`, `resolve`, `windows` are `gm`; `respond` and `pending` are `view` with
`otherPlayer: FORBIDDEN`. The area's setup inserts a running encounter, a Bear and an open hit on characterA.

## API (for AA3, AA4, AA5)

### `adversaryActions.attack {instanceId, targets, advantage?, disadvantage?, experience?, spendFear?, reactions?}` (GM)

- `targets`: character ids, or PC token ids on the live map. With a live map **and** the adversary's token on it, each PC
  must have a token there (COMBAT_TARGET_INVALID) and be in the adversary's line of sight (COMBAT_NO_LINE_OF_SIGHT, Q2);
  cover on any target adds one disadvantage. Otherwise any active party character (Q18). No range check (the GM
  sanctions their own actions, analysis B4). At most 20.
- `advantage` / `disadvantage` 0..3 (one extra d20 either way, CB p.161), `experience` an Experience name (+value, 1 Fear).
- Spotlight: an action needs it (CB p.194). Spotlit this GM turn = `spotlightTurn === gmTurn && spotlights > 0`;
  otherwise the action spotlights the instance (counted like `encounterTracking.spotlight`), and the turn's second
  spotlight costs 1 Fear (`spotlightCost`, Relentless and "must spend a Fear to spotlight" included).
- Fear (Q19): spotlight + upfront feature Fear + Experience. When `spendFear` is below that sum the call returns
  `{status: "confirmFear", fear, spotlight, feature, experience}` and writes nothing; call again with `spendFear: fear`.
  Above the GM's Fear: NOT_ENOUGH_FEAR.
- `reactions`: feature names of `onAttack beforeDamage` reactions the GM opted into for this attack (Heavy Hitter,
  Overload). Their `modifyDamage` folds (add, double, halve) change the hits before the windows open; their Fear comes out
  of the GM's Fear. Not opted in: listed in `offers` (default No).
- Returns `{status: "resolved", groupId, entryId (the GM row), roll | null, success, targets [{characterId | instanceId,
  hit, requestId?, damage?, resolved}], fearDelta, prompts [{kind, text}], offers [{feature, useId, trigger}]}`.
  `requestId` is the hit's window; `resolved: true` when nobody had to answer (resolved in the same mutation).
- Refusals: ENCOUNTER_NOT_RUNNING, NOT_FOUND (instance), ADVERSARY_FEATURE_UNAVAILABLE (defeated, no stat block),
  COMBAT_TARGET_INVALID, COMBAT_NO_LINE_OF_SIGHT, NOT_ENOUGH_FEAR, INVALID.

### `adversaryActions.useFeature {…attack args, feature, useId?, picked?, allies?, followUp?, trigger?, options?, optionals?, situations?, eitherCosts?, splits?}` (GM)

- `feature` as printed; `useId` picks a use of a multi-use feature (variant attacks like Pack Tactics); default the
  first action use. Passive uses: ADVERSARY_FEATURE_UNAVAILABLE. Requirements, costs (Fear, adversary Stress), the
  spotlight and Fear refusals map from AA1's `run` (ADVERSARY_FEATURE_UNAVAILABLE, ADVERSARY_NOT_SPOTLIT, NOT_ENOUGH_FEAR).
- `picked`, `allies`, `followUp`: character, PC token or instance ids (instances of the same encounter for allies).
  `trigger {sourceId?, subjectId?, amount?}` for a reaction fired by hand (from `offers` or a GM button).
  `options [{id, values}]` (`choose` steps), `optionals` (optional step ids the GM took), `situations` (texts the GM
  confirmed), `eitherCosts`, `splits [{id, amount}]` go to the runner as they are.
- Group Attack (CB p.201): the other undefeated instances of the same stat block (each Minion of a group instance counts)
  join; they are spotlighted with it.
- PCs marked directly (`markStress`, `markHp`, conditions such as Bite's Restrained, sheet effects) are written at once,
  each with a public row and its sheet before. Damage to PCs goes through a reaction window.
- Prompts (GM only, also on the GM row): `manual` (the feature's words), `move`, `pcSave` (a PC's reaction roll: name,
  trait, Difficulty; apply the result on the sheet), `summon`, `countdown`, `spotlight`, `choice`.
- A feature with no effect entry: `prompts: [{kind: "manual", text: "<name>: <text>"}]`, its `fearCost` (or the Fear
  its text names) asked and spent, the spotlight for an action.

### `adversaryActions.respond {requestId, characterId, choice}`

- `choice`: `{kind: "armor", slots?}` (1 by default; up to `maxSlots`, else INVALID), `{kind: "noArmor"}`, `{kind:
  "pass"}`, `{kind: "card", cardId, useId?}` (an offered reaction card: run through CA1's runner with the hit as trigger,
  paid at once: its Stress / Hope, its once-per `featureUses` entry, Shrug It Off's vault; CHARACTER_UNAVAILABLE for a
  downed character; CARD_COST_UNPAID / CARD_EXHAUSTED).
- NOT_A_RESPONDER: not listed, already answered (an ally answers once; the target until their armor answer), a card not
  offered, or released by a redirect. REQUEST_NOT_OPEN once resolved or declined; NOT_FOUND for another campaign's row
  or a row that isn't a hit.
- Returns `{status: "open" | "resolved" | "declined", requestId}`. The last answer resolves the hit in the same
  mutation. `declined`: the encounter ended or the GM undid the action (the row is declined then).

### `adversaryActions.resolve {requestId}` (GM, "Resolve now")

Whoever hasn't answered takes no armor and plays no card. Returns `{status: "resolved", requestId, targetId, severity,
hpMarked, deathMove}` or `{status: "declined", requestId}`.

### `adversaryActions.pending {characterId}`

The character's open hits (running encounter, action not undone): `{requestId, attackerLabel, targetCharacterId,
targetName, role: "target" | "ally", awaiting, cardIds, createdAt}`, and for the hit PC only `damage`, `severity`,
`direct`, `maxSlots`, `armorPreview [{slots, severity, hp}]`. Never the roll, Evasion or adversary stats.

### `adversaryActions.windows {}` (GM)

Open windows: `{requestId, encounterId?, instanceId, attackerLabel, feature?, originalTargetId, targetCharacterId,
targetName, damage, damageType, direct, critical, awaiting [{characterId, name, role}], answers, createdAt}`.

### `convex/lib/incomingHits.ts` (server API; CA4b's card path)

```ts
partyMembers(ctx, campaignId): PartyMember[]                    // active characters with readable sheets
bandsOnMap(ctx, mapId?): BandBetween                             // PC-to-PC bands on the live map; none = any (Q18)
openIncomingHit(ctx, { campaignId, encounterId?, mapId?, createdBy, groupId, attacker, targetCharacterId,
  targetTokenId?, hit: { amount, type, direct, forcedArmor, critical, attackTotal? }, party, bands })
  : { requestId, resolution: HitResolution | null }             // resolves at once when nobody has to answer
respondToHit(ctx, { row, characterId, choice, by }): { complete }  // caller resolves when complete
resolveIncomingHit(ctx, { row, by, early }): HitResolution       // writes the sheet, rows, closes the request
rebuildWindow(ctx, row): { state, party, members, attacker }     // the window now (pure replay)
hitView(ctx, row, characterId): HitView | null                   // what `pending` returns per row
groupUndone(ctx, row): boolean
```

`HitResolution`: `{requestId, groupId, attacker, originalTargetId, targetId, missed, negated, severity, hpMarked,
stressMarked, armorMarked, deathMove, taken, manual, window}`.

## How it works

- **The window** is AA1's pure state machine, rebuilt on every read from the stored row: `openWindow` with today's party,
  the stored responders, then every stored answer. A card answer's folds are recomputed by re-running the card with dice
  seeded from the request id and the answer's index (`seededRng`, mulberry32), so a rolled fold comes out the same on
  every rebuild and can't be fished for; the replay tops up the responder's resources so the paid card can't refuse.
- **Rows** (one actionLog group per action, `groupId`): the GM row (visibility `gm`: roll, Evasion per target, damage per
  hit, Fear, prompts, `adversaryBefore`, `fearDelta`); the public row ("Bear hit Ash", "Dummy missed Ash", "Bear used Bite:
  hit Ash", no roll, no numbers); a public row per PC marked directly (with `before`); a public row per card answer (with
  the responder's `before`); per resolved hit a public row ("Ash took Bear's hit", with the sheet before) and a GM row
  ("Ash: 9 phy → Major, 1 Armor Slot → Minor → 1 HP (1/6)"); the attacker's triggers after the hit (a GM row).
- **Actor**: every row of the group carries the GM who made the attack, so a player can't undo the adversary's hit by
  undoing their own answer (FORBIDDEN); the GM undoes the whole group: the PCs' sheets, the instances (HP, Stress,
  conditions, tags) and the Fear (U4).
- **Undo with a hit still open**: CA4b owns `convex/lib/actionLog.ts`, so undo doesn't touch the hit row. `respond`,
  `resolve`, `pending` and `windows` treat a hit whose group was undone as closed (`groupUndone`), and the next write
  declines it.
- **Triggers** (AR8): after the roll, `onHit` / `onMiss` uses of the attacker run when `auto` (Momentum's Fear) and are
  offered when `reaction`; `onAttack beforeDamage` reactions run only when opted in. After a hit resolves,
  `onTargetMarksHp` (Overwhelming Force's knock-back), `onDealDamage`, `onDefeatPc`: autos run (GM row), reactions are
  named on the GM row.

## What a player receives (Q14, U1)

- `pending`: the hit PC's own damage, severity, slots and preview; an ally only the attacker's label, the target's name
  and their cards. Tests walk the keys (no roll, dice, total, modifier, evasion, difficulty, hp, stress, thresholds,
  adversaryBefore, attackTotal).
- The feed: public `adversary` rows without a digit; the GM rows are `visibility: "gm"`.
- `respond`: only a status and the request id.

## Notes for the next tracers

- **AA3 / AA5**: call `attack` / `useFeature`; on `confirmFear` show "Spend N Fear?" (`spotlight`, `feature`,
  `experience` split it) and call again with `spendFear: N`. Offer `offers` as one-tap prompts (default No): fire with
  `useFeature {feature, useId, trigger: {subjectId}}`. `windows` drives the "who still has to answer" list and "Resolve
  now". The GM row's summary has the roll and damage for the GM's view.
- **AA4**: `pending {characterId}` for the prompt; `respond` once per tap. For the target: `armorPreview` gives the
  severity per slot count ("14 damage: Major (2 HP). Mark an Armor Slot to make it Minor?"); `maxSlots` 0 means OK only.
- **CA4b (card damage to another PC)**: in the card path, for each `pcDamage` step on a PC call `openIncomingHit` with
  the card's group and `party = await partyMembers(...)`. AA0's payload requires `attacker.instanceId`
  (`v.id("encounterAdversaries")`); a PC attacker needs a widened `attacker` (see QUESTIONS 1).

## Checks

- `pnpm lint`: clean (0 warnings in the new files). `pnpm typecheck`: clean.
- `vitest run tests/convex/adversary-actions*.test.ts tests/convex/authz/adversary-actions.test.ts tests/convex/authz-matrix.test.ts`: all pass.
- Full `vitest --maxWorkers=4 --testTimeout=60000`: 272 files, 6992 passed, 1 expected fail.
- `convex/_generated/api.d.ts` was patched locally for the tests and is not committed; the orchestrator regenerates it.

## QUESTIONS

1. **PC attackers in `incomingHit`** (card damage to an ally, 2026-10-22): AA0's `incomingHitPayloadValidator.attacker`
   is `{instanceId: v.id("encounterAdversaries"), label, feature?}`. Widen it (rule 7) to a union adding `{kind: "pc",
   characterId, cardId, label}` (or an optional `sourceCharacterId` with `instanceId` optional)? The file is AA0 / CA3's.
2. **Per-instance feature limits** ("Once per scene"): `encounterAdversaries` has no `featureUses` (TASK-CA-AA1 Q4). AA2
   passes none, so scene limits are not enforced. Who widens `convex/lib/validators/encounters.ts`?
3. **Death move**: the window flags it (`deathMove` on the result, the GM row and "… and must make a death move" on the
   public row); the sheet's existing death-move flow takes over (hp at max). Should AA2 also start `deathMoves` itself?
4. **Conditions on a redirected hit**: Bite's Restrained lands on the PC the roll hit, before I Am Your Shield
   redirects the damage. Keep, or move riders to whoever takes the hit?
5. **Several targets of one roll each get their own window**; their resolutions log into the same group. Fine?
6. **Massive damage** stays off for PCs (TASK-CA-AA1 Q7).

## Not done / follow-ups (outside AA2's owns or deferred)

- **CE-valor "For AA2"**: Unbreakable (`whenYouMarkHp last`), Rise Up's and Valor-Touched's autos (`whenYouMarkHp`) and
  Bold Presence's condition use are not offered after a hit resolves; AA1's window offers only the four damage triggers.
  A follow-up can run them in `resolveIncomingHit` (this tracer's file).
- **Runner problems (bead dcm-vv2, AE task docs)**, all in AA1's files (`src/lib/domain/adversary-effects/run.ts`,
  `src/lib/domain/adversary-actions/features.ts`), not AA2's:
  1. `adversaryNumberEnv` has no `triggerAmount`: Summoning Ritual's tick by HP marked resolves to 0 (t2-core 1).
  2. Adversary-only steps inside a PC save lose their kind (Petrifying Gaze's countdown arrives as a manual step) (t2-core 2).
  3. A follow-up attack roll in a use without a main roll gets no ATK and reads the critical from the main roll (t2-core 3, t2-hf 1).
  4. `passiveSummary` drops `advantage` mods (Out of Nowhere, High Ground) (t2-core 4, t2-hf 3); AA2 doesn't add them yet.
  5. `passiveSummary` resolves `gmFear` as 0 (The Beast Unleashed, Terror-Fueled) (t2-hf 2).
  6. Prompt numbers resolve without `lastRoll` (To Me, My Pretties' summon count 0) (t2-hf 4).
  7. A forced Armor Slot from a separate reaction run stays in `creatures[].after` (Rending Chomp) (t2-hf 5): AA2 writes it
     to the sheet at once instead of folding it into the open hit.
  8. Clearing a defeated instance's HP keeps `defeated` (The Work Never Ends) (t2-hf 6).
- `allyWithin` (Pack Tactics) isn't answered from the map yet: it holds (Q18 reading).
- Riders and reactions on an attack that return folds other than `modifyDamage` (Overwhelm, Heavily Armored; t2-core 5)
  are applied as their own plan's writes, not folded into the hit.
