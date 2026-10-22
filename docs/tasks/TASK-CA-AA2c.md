# TASK AA2c: Adversary server follow-ups 2

Plan `.omc/plans/combat-actions.yaml`, tracer AA2c (depends on AA2b). Answers TASK-CA-AA2b.md QUESTIONS 1, 2, 3 and 6
and adds the query AA3b's choices dialog reads. CB = Core Book, printed pages. Status: Review.

## User answers implemented (2026-10-22, binding, quoted from the plan)

- "riders land whenever the attack hit, even if its damage was negated (only a miss or full avoidance stops them)"
- "'once per session' adversary features last the whole session (reset at session end)"
- "undo gives an adversary's limited use back"
- "damage reflected at a PC attacker opens the normal incoming-hit prompt"
- "the GM's feature choices are asked in a dialog (AA3b) - so the server exposes a query describing what a feature use
  needs (options, picks, allies, splits, situations, cost choices, Fear amount)"

## Acceptance and how it is met

| Acceptance | Where | Test (tests/convex/…) |
|---|---|---|
| Riders land when the attack hit even if its damage was negated; a miss or full avoidance stops them | `resolveIncomingHit`: riders apply unless `res.missed` (was `res.negated`). A `negateDamage` / `reflect` fold keeps the damage off and the riders on; a `negateAttack` fold or an Evasion bonus that beats the roll is a miss. The public row says "Ash took no damage from Bear's hit" for a negated hit, "Ash avoided Bear's hit" for a miss. | adversary-actions "riders land when only the damage was negated: Arcane Deflection…", "a full avoidance stops the riders: Scramble…" |
| Session-limited features stay spent across encounters until the session ends; scene limits still reset at encounter end | `featureUses[]` entries widened with `session?` (`instanceFeatureUseValidator`). A use whose limit is `per: "session"` (`limitPerOf`: the entry's limit by its key) made while a session is live stores `session = campaignState.sessionStartedAt`. An entry counts when its `scene` is the encounter's `startedAt` or its `session` is the live session (`useCounts`). `sessions.end` clears `sessionStartedAt`, so the use comes back. | "a once-per-session feature stays spent across encounter runs…"; AA2b's "a once-per-scene feature … comes back when the encounter runs again" unchanged |
| `adversaryBefore` widened with `featureUses`; undo restores an instance's limited use | `adversaryBeforeValidator.featureUses?` (widen only). `commit` puts the instance's stored uses into its before-state when the action recorded one; `actionLog.undoEntry` writes them back (an empty list clears the field). | "the GM's undo gives an instance's limited use back" |
| Damage reflected at a PC attacker opens an incoming hit for that PC | `resolveIncomingHit`: a `reflect` fold to the attacker on a hit whose attacker is a PC opens `openIncomingHit` on that PC: same group, same encounter / map, the reflected amount and damage type, attacker `{kind: "pc", characterId, label, cardId, feature}` = the PC whose card reflected it (`reflectorOf`). `HitResolution.reflectedHitId?` names it. An adversary attacker still takes reflected damage on its HP. | "damage reflected at a PC attacker opens an incoming hit on that PC" |
| `adversaryActions.featureAsk {instanceId, feature, use?}` (GM) | `convex/adversaryActions.ts` (gmQuery, returns validator), built by `featureAsk` in `convex/lib/adversaryFeatures.ts`. Reads only. | "featureAsk: an attack…", "featureAsk: optional steps…"; matrix entry + role test `featureAsk` |
| Split under 800 lines, public API unchanged | `convex/lib/incomingHits.ts` 563 lines (+ `adversaryHits.ts` 341); `convex/lib/adversaryActions.ts` 742 lines (+ `adversaryFeatures.ts` 576). Both old modules re-export every name that moved, so imports from them are unchanged. | every existing test unchanged and passing |

## `adversaryActions.featureAsk {instanceId, feature, use?}` (for AA3b)

GM only (`gmQuery`; it carries the stat block's numbers). Anonymous UNAUTHENTICATED, outsider NOT_FOUND, any player
FORBIDDEN. Refusals as `useFeature`: ENCOUNTER_NOT_RUNNING, NOT_FOUND (instance), ADVERSARY_FEATURE_UNAVAILABLE (unknown
or passive feature, passive `use`, defeated instance, stat block gone). Nothing is rolled, paid or written.

`use` is the use id (`useFeature`'s `useId`); default the feature's first action use, as `useFeature`.

```ts
{
  feature: string;                  // as printed
  useId: string;                    // the use described ("main" for most; pass it as useFeature's useId)
  uses: { id; activation: "action" | "reaction" | "auto" | "passive" }[];  // every use of the feature
  automated: boolean;               // false: no effect entry (custom block): useFeature makes a manual prompt
  text?: string;                    // the feature's words, when not automated
  activation: "action" | "reaction" | "auto";
  needsSpotlight: boolean;
  spotlit: boolean;                 // already spotlit this GM turn
  available: boolean;               // false: see `unavailable`
  unavailable: string[];            // "Used up this scene" / "Used up this session" / "Needs half or more of its HP marked" …
  attack: boolean;                  // rolls an attack: targets need line of sight on the live map; advantage / Experience apply
  followUpAttack: boolean;          // a follow-up attack roll inside the use (targets: `followUp`)
  targets:  TargetAsk | null;       // useFeature `targets`
  picked:   TargetAsk | null;       // useFeature `picked` (steps "to: picked", "spotlight another adversary")
  allies:   TargetAsk | null;       // useFeature `allies` (instances of the same encounter)
  followUp: TargetAsk | null;       // useFeature `followUp`
  trigger: { kind; text?; source; subject; amount } | null;
                                    // reaction / auto fired by hand: pass useFeature `trigger {sourceId?, subjectId?, amount?}`
                                    // for each flag that is true; `text` for a situation trigger (the GM's button label)
  options: { id; label; count: number | null; distinct; options: { id; label }[] }[];
                                    // `choose` steps → useFeature `options [{id, values: option ids}]`; count null = decided in the run
  optionals: { id; label; fear; stress }[];
                                    // optional steps (Q19 default No) → useFeature `optionals: [id]`; their Fear comes from the GM's Fear
  situations: { text; feature }[];  // texts to confirm → useFeature `situations: [text]` (this use's requirements and gates,
                                    // the passives', and for an attack the onAttack / onHit uses' that read them)
  splits: { what: "damage" | "clear"; among: string; track? }[];
                                    // "divided however you wish" → useFeature `splits [{id: creature id, amount}]` among `among`
                                    // (targets / picked / allies …); the total is rolled in the run, an unsplit total is a GM prompt
  eitherCosts: { index; options: { index; fear; stress; hp; label }[] }[];
                                    // `either` costs in the order the runner meets them → useFeature `eitherCosts: [option index per entry]`
  fear: { total; spotlight; feature; perTrigger; gmFear; enough };
                                    // what useFeature will ask (`confirmFear`): spotlight + upfront feature Fear with the first option of
                                    // each `either`; `perTrigger`: the amount comes from `trigger.amount` (My Turn); an Experience adds 1
  stress: number;                   // Stress the adversary marks up front
  experiences: { name; value }[];   // for useFeature `experience` (1 Fear)
  reactions: { feature; useId }[];  // onAttack beforeDamage reactions to opt into for an attack → useFeature `reactions: [feature]`
}

type TargetAsk = { side: string; range: string; count: "one" | "upTo" | "all" | "any"; max: number | null; sight: boolean };
// side as the entry reads it: "enemy" = PCs, "ally" = other adversaries, "any", "point", "object", "self"; range "melee" …
// "veryFar" | "weapon" | "unlimited"; count "all" = every PC in range (no pick); max null = no fixed cap.
```

Dialog flow for AA3b: call `featureAsk`; if `available` is false, show `unavailable` and disable Use; ask the lists
(`targets`, `picked`, `allies`, `followUp`), one radio group per `options` entry (`count` picks), a check box per
`optionals` (with its Fear) and per `situations`, an option picker per `eitherCosts` entry (recompute the Fear from the
picked option's `fear`), split amounts per `splits` entry; then `useFeature` with the answers; on `confirmFear` ask
"Spend N Fear?" as before.

## API additions (all additive; AA3b, AA5)

- `adversaryActions.featureAsk` (new GM query, above).
- `HitResolution.reflectedHitId?` (`convex/lib/incomingHits.ts`).
- `convex/lib/adversaryFeatures.ts` (new): `featureAsk`, `FeatureAsk`, `TargetAsk`, `CostAsk`, `spotlightFearFor`,
  `limitPerOf`, `useCounts`, `storedUses`, `sceneOf`, `triggered`, `isAttackUse`, `optionalIds`, `runOrThrow`,
  `loadActor`, `Loaded`, `BlockFeature`, `instanceModifiers`; plus the moved `blockOf`, `selfCombatant`,
  `adversaryState`, `beforeOf`, `adversaryOnlyPrompts`, `instanceUses`, `ridersOf`, `Block`, `Prompt` (still exported
  from `./adversaryActions`).
- `instanceUses(instance, encounter, session?)`: the optional `session` (the live `sessionStartedAt`).
- `convex/lib/adversaryHits.ts` (new): the moved building blocks (still exported from `./incomingHits`) plus
  `windowParty`, `windowHitOf`, `isConditionRider`, `respondingParty`, `attackerCombatant`, `cardRefusal`,
  `sheetAfterCard`, `runAfterHitCard`.
- Validators (widen only): `instanceFeatureUseValidator` (`session?`), `adversaryBeforeValidator.featureUses?`.

No wrapper, `need`, argument validator or error code of an existing function changed.

## What a player receives (Q14, U1)

Unchanged. `featureAsk` is GM-only. The reflected hit's `pending` view is the normal target view (the hit PC's own
damage and severity); its attacker label is the reflecting PC's name. The public row of a negated hit has no number.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 282 files, 7571 passed, 1 expected fail (adversary-actions 31 tests: 24 before + 7
  new; adversary-actions-authz 10: 9 + `featureAsk`).
- `pnpm tracer:guard .omc/plans/combat-actions.yaml AA2c`: passes.
- `convex/_generated` not committed (no new public module; `featureAsk` lives in `convex/adversaryActions.ts`).

## QUESTIONS

1. **Session limits without a live session**: a "once per session" use made while no session is live is kept for the
   scene only (it resets at encounter end). Should it instead last until the next session ends?
2. **Session limits across instances**: limits are per instance. The same stat block in another encounter of the same
   session (a new instance) starts fresh. Should a session limit be shared by every instance of a stat block in the
   campaign?
3. **Reflected hit and the original attacker's triggers**: the reflected hit on the PC attacker resolves like any card
   damage to an ally (no adversary triggers). Its attacker is the reflecting PC; that PC doesn't answer it. Fine?
4. **featureAsk Fear with dice costs**: a Fear cost rolled in dice (none in the SRD tables today) is reported as its
   lowest value (dice read as 1) until the run rolls it.
