# TASK AA0: Adversary-actions foundation

Plan `.omc/plans/combat-actions.yaml`, tracer AA0 (wave 2, foundation, depends on CA0). Analysis:
`.omc/autopilot/combat-actions-analysis.md` Part B (git-ignored). Book pages are printed pages; CB = Core Book.

User answers this tracer implements (binding):
- **Q1** "an attack or card use on a target outside its range needs the GM's sanction (the action waits as a pending
  request; the GM approves or declines; nothing is rolled before approval)" -> `combatRequests` kind `sanction`.
- **Q13** "The hit PC's player chooses whether to mark an Armor Slot; the damage waits for that choice. Allies may
  respond with their abilities … a reaction window after each adversary hit" -> kind `incomingHit`.
- **Q17 (a)** "the reaction window closes when the target chose armor and every eligible ally answered Use/Pass; the GM
  can 'Resolve now' anytime; no timer" -> `responders` + `responses`, closed by AA2.
- **Q15** "Automate EVERY adversary feature … split by tier and source into parallel tracers" -> eight empty tables.

## What landed

| Area | File | What |
|------|------|------|
| Table | `convex/tables/combatRequests.ts`, `convex/schema.ts` | `combatRequests`, indexes `by_campaign_status [campaignId, status]` and `by_status_resolved [status, resolvedAt]`. |
| Validators | `convex/lib/validators/combatRequests.ts` | Row fields, the typed payload union (`schemaVersion: 1`), responses, inferred types. |
| Retention | `convex/cleanup.ts`, `convex/crons.ts` | `expireCombatRequests` (internal, `BATCH` = 500 per run, reschedules itself), hourly at minute 11; a `PURGE_STEPS` entry for the campaign purge. |
| Errors | `src/lib/errors/adversaryActions.ts` (+ `app-error.ts`, `convex-errors.ts`) | `ADVERSARY_NOT_SPOTLIT`, `ADVERSARY_FEATURE_UNAVAILABLE`, `NOT_ENOUGH_FEAR`, `REQUEST_NOT_OPEN`, `NOT_A_RESPONDER`. |
| Vocabulary | `src/lib/domain/adversary-effects/types.ts` | The adversary-effect vocabulary (below). Types plus three `as const` lists. |
| Registry | `src/lib/srd/adversary-effects/{index,t1-core,…,t4-hf}.ts` | Eight empty tables; `ADVERSARY_EFFECTS` (adversary id -> feature effects), `adversaryGroup`, `adversaryEffects`, `adversaryFeatureEffect`. |
| Tests | `tests/convex/schema-guard.test.ts`, `tests/convex/cleanup.test.ts`, `tests/unit/adversary-effects-types.test.ts` | Retention classification, the payload union, the cron and the purge, the vocabulary and registry. |

No public Convex function is added, so no authz area file (TASK-D12-H0). `docs/data-model.md` is the orchestrator's.

## The `combatRequests` table

```
combatRequests {
  campaignId, encounterId?, mapId?,
  kind: "sanction" | "incomingHit",
  status: "open" | "resolved" | "declined",
  createdBy: Id<"users">, createdAt,
  payload: SanctionPayload | IncomingHitPayload,   // both carry schemaVersion: 1 and kind
  responses: { characterId, choice, by, at }[],
  resolvedAt?, resolvedBy?
}
```

- **Sanction payload** (`CA3` / `CA4` write and replay it): `characterId`, `action` = `{kind: "attack", slot, targetTokenIds,
  roll}` or `{kind: "card", cardId, useId, targetTokenIds, choices, roll?}`, and `outOfRange: {tokenId, band}[]` for the
  GM's prompt. `roll` mirrors `dualityFields` of `convex/rolls.ts` with every field optional; `choices` are
  `{id, value: number | string | string[] | boolean}` (NumberChoice amounts, choose / optional option ids).
- **Incoming-hit payload** (`AA2` writes it, one row per hit PC): `attacker {instanceId, label, feature?}`,
  `targetCharacterId`, `targetTokenId?`, `damage` (the total before armor), `damageType`, `direct`, `forcedArmor?`,
  `critical`, `groupId` (rows of one adversary action share it and resolve into one actionLog group), and `responders
  {characterId, role: target | ally, cardIds}[]`. The attack roll is **not** stored here; it belongs on the GM's
  actionLog row (Q14).
- **Responses**: `choice` = `{kind: "armor", slots?}` | `{kind: "noArmor"}` | `{kind: "card", cardId, useId?}` |
  `{kind: "pass"}`. `slots` above 1 only where a card allows it (I Am Your Shield, CB p.341).
- The row's `kind` and the payload's `kind` are always equal; writers set both (the row field is there for readers that
  don't open the payload).
- Arrays are bounded by the party (12) or one action's targets (20); the writing mutations enforce it (CD8).
- `resolvedAt` must be set whenever `status` leaves `open`. The retention cron ranges on it; a closed row without it
  sorts first in the index and is swept on the next run.

**Retention.** `expireCombatRequests` deletes `resolved` and `declined` rows whose `resolvedAt` is more than a day old,
500 per run across both statuses, and reschedules itself while a run used its whole batch. Open rows are left alone:
they wait for an answer or the campaign purge. `schema-guard` lists the table as campaign-scoped with an extra retention
job.

## The adversary-effect vocabulary

It reuses the card vocabulary (`src/lib/domain/card-effects/types.ts`) and does not change it:

- **Outcome steps**: `OutcomeStep` as is (damage, markHp, markStress, markArmor `noBenefit`, condition, move, effect,
  fear gain, redirectDamage, manual, …). "self" is the adversary, "targets" are PCs, "allies" its allies.
- **Flow steps** with adversary children: `pay`, `optional`, `choose`, `save`, `check`, `followUp` are the card shapes
  (`Omit<…>`) whose nested steps are `AdversaryStep` and whose costs are `AdversaryCost`.
- `RollSpec` (`adversaryAttack` against `evasion`), `TargetSpec`, `TriggerTargets`, `Limit` (`per: "scene"`, `times`),
  `Mod`, `Gate`, `NumberSource`, `DamageRoll` (`standardAttack`, `flat`).

It adds:

| Type | Members |
|------|---------|
| `AdversaryCost` | `fear` (spend N Fear, CB p.194), `stress` (the adversary marks N Stress), `hp`, `either`. |
| `AdversaryFeatureUse.needsSpotlight` | Required boolean on every use (CB p.194: actions need the spotlight; passives and reactions typically don't). |
| `AdversaryTrigger` | `onHit`, `onMiss`, `onAttack` (before / beforeDamage / after), `onDealDamage`, `onTargetMarksHp`, `onDefeatPc`, `onDamaged` (would / did, severity, type, attacker range, first), `onMarkHp`, `onHpMarkedAtLeast`, `onMarkStress`, `onDefeated`, `allyDealtDamage`, `allyMarksHp`, `allyDefeated`, `onAttacked`, `pcRolls`, `pcMoves`, `pcMarksHp`, `pcHope`, `onSpotlight`, `allySpotlit`, `wouldGainCondition`, `timing`, `situation`. Chosen from the 202 reaction texts and the triggered passives. |
| `AdversaryActivation` | `action`, `reaction` (one-tap prompt, default No, Q19), `auto` (no prompt: Momentum's Fear gain, passive riders), `passive`. |
| `AdversaryRequirement` | `hpMarkedAtLeast` (number or `half`), `hpMarkedAtMost`, `stressMarkedAtMost`, `hasCondition`, `tokens`, `allyWithin`, `situation`. |
| `AdversaryModifier` | `mod` (any card `Mod`: resistance / immunity, attack bonus as `stat attack`, Difficulty, flags; optional aura `to` + `within`), `horde` (X), `minion` (X), `relentless` (X), `spotlightCostsFear`, `directAttacks`, `attackDamage`, `conditionAura`. |
| `AdversaryOnlyStep` | `summon` (prompt the GM to add instances), `countdown` (start / tick / prompt), `spotlight` (allies, same name, picked). |
| `AdversaryFeatureUse.groupAttack` | Minion Group Attack (AR9, CB p.201): one shared roll, X per Minion combined. |
| `AdversaryFeatureEffect` | `{adversaryId, feature (printed name), uses}`; exactly one per printed feature. |

Lists: `ADVERSARY_STEP_KINDS` (the card's 30 plus `summon`, `countdown`, `spotlight`), `ADVERSARY_TRIGGER_KINDS`,
`ADVERSARY_EFFECT_GROUPS`, each checked against its type at compile time.

### Examples (from `tests/unit/adversary-effects-types.test.ts`)

- **Momentum** (CB p.195): `auto onHit any`, `needsSpotlight false`, steps `[fear gain 1]`.
- **Heavy Hitter** (CB p.195): `reaction onAttack beforeDamage standard`, `optional` costing 1 Fear with
  `modifyDamage add 2`.
- **Group Attack** (CB p.201): `action`, cost 1 Fear, `adversaryAttack vs evasion`, `groupAttack {within: close}`,
  `damage flat 2 when [hit]`.
- **Minion (3) / Horde (1d4+1) / Relentless (3)**: one `passive` use with `minion 3`, `horde dice 1d4+1`,
  `relentless 3`.
- **Explosion** (CB p.196): cost 1 Fear, attack all within Close, `damage 1d8 magic when [hit]`, `move knockBack far`.

## Registry groups

`adversaryGroup(def)` = `t<tier>-core` or `t<tier>-hf` (Reign of the Weredragon adversaries go with Hope & Fear). The
test pins the counts from the analysis: t1-core 52 / 140, t1-hf 35 / 103, t2-core 36 / 108, t2-hf 42 / 138, t3-core
23 / 87, t3-hf 32 / 135, t4-core 18 / 82, t4-hf 29 / 135 (adversaries / features). Feature names are unique within
every stat block, so `(adversaryId, feature)` keys an entry; the merge throws on a duplicate.

## Questions for the user / orchestrator

1. Open requests are never swept by the cron (only purged with their campaign). An abandoned sanction or window (the
   encounter ended, the GM never answered) stays `open`. Should AA2 / CA3 close open rows when an encounter ends, or
   should the cron also delete open rows older than, say, 7 days (needs a `[status, createdAt]` index)?
2. Tokens on an adversary's stat block (Pool, "they don't have a token on their stat block") are expressible as a
   requirement and the card `tokens` outcome, but `encounterAdversaries` has no tokens field. AA1 / AA2 will need a
   widen of `convex/lib/validators/encounters.ts` (CA0's file) if those features are automated rather than manual.
