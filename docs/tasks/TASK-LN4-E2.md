# TASK LN4-E2.4: Incoming hits, round 4

Plan `.omc/plans/lanes-2.yaml`, tracer E2.4 (label `lane:w1-e2-damage-window`, branch `lane4-e2`, wave 10, after V4).
Book pages are printed pages (CB = Core Book, HF = Hope & Fear). No `types.ts`, `validators/combatRequests.ts` or
`src/lib/srd/**` edits.

**Extra owned file (orchestrator, 2026-11-01):** `convex/hitKeywords.ts` (new public module: the GM's answer to a
hit's keyword ask and the list of open asks). The tracer guard flags it; the orchestrator accepted it.

## What landed

| Bead | State | How |
|---|---|---|
| dcm-12kx | **closable** | `pcMods` (`adversaryHits.ts`) reads adversary sheet effects (`card:<adversaryId>/<feature>:<n>`) through `lastingModsOf` on the feature's steps, by the effect's label. Unstuck's `marksMultiplier`, Leechpoles' `damageTaken`, Ravenous' `cannotSpendHope` flag now count in `pcDamageMods` / `pcResistance` / `pcFlags` (hits, the window's payers). `pcDamageMods` also reads a `creatureTokens` `add` (`who: "self"`) from the sheet's `creatureTokens` (V4, dcm-wiwi): "+1 per leechpole" (HF p.90). See the id-length bug dcm-s7hd below: two of these effects can't be stored yet. |
| dcm-5gng, dcm-7vei | **closable for E2** (plan-side half: dcm-go7u) | `everyStep` walks a `save`'s `onFail` / `onSuccess`, a `followUp`'s steps and a `check`'s `table` rows (Fireball, Breath of Fire, Fire Jets, Broken Magic). The feature's keyword is the one ALL its damage steps carry (`stepsKeyword`); when they disagree (Randomized Tactics: Fire Jets fire, Mana Beam / Trample not; Mitera's heads) the data can't tell (`KeywordInfo.known` false) and a Fireproof target gets the GM's ask (dcm-sk4r), so the GM settles the branch. `HitDraft.keyword` (new, optional) lets a caller pass the producing step's keyword; it wins, and is stored as an answered `keywordAsk` when the data alone can't tell. Feeding it from the plan is dcm-go7u (E7 / E8 files). |
| dcm-dztv | **reader done**; data is S3.4's | `hitKeywordInfo` / `hitKeywordInfoOf`: the standard attack reads the SRD stat block's `attack.keyword` (V4 field; looked up by the block's id, since `Block.attack` is typed without it; an Evolution's new standard attack carries none). An SRD standard attack is "known" (no keyword = not fire); a custom block is not known. |
| dcm-n7kt | **closable for E2**; direct path dcm-vvg1 (E7); data S4.4 | `markHpKeyword(Of)`: the feature's `markHp` keyword (when all agree); `markHpGuard`: the PC's guard of that keyword. At resolution, a guarded PC's `hp` riders from that feature are dropped with a GM line and "(Fireproof: no Hit Points from fire)" on the public line. Fire Beam's 3 / 1 HP on a PC with no hit is written in `convex/lib/adversaryActions.ts` (E7): dcm-vvg1 calls `markHpGuard` there. |
| dcm-sk4r | **closable** | Both sides. (a) A hit carrying a guarded keyword applies the guard directly: `keywordGuards` (a reaction / auto use set off by "you would take damage" with a `keyword`, no requirement, whose steps negate damage: Fireproof's entry; or a `resistance` mod with a `keyword`) makes `pcResistance` immune on both types, a GM line "Ember: Fireproof (immune to fire damage)" and the public line says so; guard features are no longer offered as window answers (`isKeywordGuardFeature`). (b) A hit whose keyword the data can't settle, on a guarded target, stores `keywordAsk { keyword, characterId, feature }` (V4 shape) and waits: the window isn't complete while the ask is open (`keywordAskOpen`), the GM's "Resolve now" resolves it as not fire. `answerKeywordAsk` writes `answer` / `answeredBy` (V4's change from the brief), logs a GM line, and `effectiveKeyword` turns a yes into the hit's keyword on every rebuild. Public API `convex/hitKeywords.ts`: `answer` (keyedGmMutation; args `requestId`, `answer: keywordAnswerValidator`; resolves the hit and runs `afterHitTriggers` when nothing else waits; `declined` for an undone / ended hit) and `asks` (gmQuery, returns validator, indexed open-request scan). Minimal GM UI: `actions/adversary/keyword-asks.tsx` ("Hit questions": "Bandit → Ember, 12 damage: Was this hit fire? (Fireproof)", Yes / No, optimistic removal), mounted above the reaction windows on the Combat Map. |
| dcm-i9c1 | **closable for E2**; data switch S2.4 | `featureActor` carries `stats` from `sheetNumbers` (Armor Score, thresholds, Evasion, with active effects such as a Beastform), so a `stat` number in a window answer reads the real Armor Score. |
| dcm-8fc2 | **done** (bead already closed) | `sheetAfterCard` ends what a reaction card's own roll ends (`rollEnds` → `endConditionsOnRoll`, as the feature path's `actorSheetAfter` already did); the card's and the feature's answer rows name it ("Ash: Cloaked ends (Vanishing Act)", `rollEndLines`). After-hit cards go through `sheetAfterCard` too. |
| dcm-hs6u | **verified and fixed; closable** | Fragile Beastform and the Severe stance drop read `occ.severity` (the hit's severity after armor, or none at 0 HP). Fixed to follow the HP this hit's damage actually marked (`takenSeverity`, E6's reading: 1 Minor, 2 Major, 3+ Severe; on the last HP the hit's own severity when higher), not counting gold paid instead or forced HP riders. So a Severe hit marking 2 HP (Chains of Affliction's -1) no longer drops the stance, and a doubled Minor (Unstuck, 2 HP) drops a Fragile form (user answer "Doubled Minor counts as Major"). Nothing for E6. |

## Files

| File | What |
|---|---|
| `convex/lib/adversaryHits.ts` | `everyStep` walk; `pcMods` adversary effects; `pcDamageMods` creature tokens; `featureActor` stats; `KeywordGuard` / `keywordGuards` / `isKeywordGuardFeature`; `KeywordInfo`, `hitKeywordInfo(Of)`, `effectiveKeyword`, `markHpKeyword(Of)`, `markHpGuard`; `HitDraft.keyword`; `rollEnds` / `rollEndLines`; `sheetAfterCard` roll ends. |
| `convex/lib/incomingHits.ts` | `openingKeywordAsk`, `keywordAskOpen`, `keywordAskQuestion`; ask stored at open and holding the window; guard and markHp lines at resolution; `takenSeverity` for form / stance; `KeywordAskView`, `keywordAskView`, `answerKeywordAsk`. |
| `convex/hitKeywords.ts` | New public module (`answer`, `asks`). |
| `src/components/combat-map/actions/adversary/keyword-asks.tsx`, `controls.tsx` | The GM's "Hit questions" row. |
| `tests/convex/lane4-e2-hits.test.ts`, `tests/e2e/lane4-fire-ask.spec.ts` | New. |

`window.ts`, `severity.ts`, `damage.ts`, `unshakable.ts` and `reactions/**` needed no change: `triggerFits` keeps its
wave-9 behaviour (pinned by `tests/convex/lane-e2-round2.test.ts`); the guard is filtered out before the window sees it.

## Merge-time actions

1. **Authz entries** (`tests/convex/authz/adversary-actions.entries.ts`, not mine; the inventory guard fails `pnpm test`
   without them). Verified locally with these lines (reverted before the commit):

   ```ts
   // Lanes-2 E2.4 (dcm-sk4r): the GM's keyword ask on a hit (the area's hit asks nothing: INVALID past the check).
   { fn: api.hitKeywords.answer, access: "gm", args: (w) => ({ requestId: w.ids.requestId, answer: { keyword: "fire", carries: true } }), okCodes: ["INVALID"] },
   { fn: api.hitKeywords.asks, access: "gm" },
   ```

   Anonymous: UNAUTHENTICATED; outsider and player: FORBIDDEN (gm wrappers); GM: `answer` INVALID (the area's hit
   has no ask), `asks` ok.
2. **Codegen**: `npx convex codegen` (new module `convex/hitKeywords.ts`); `convex/_generated` is not committed.
3. No stored shape changed (V4's `keywordAsk` used as is); no migration.

## Follow-ups filed

- dcm-vvg1 (lane:w1-e7-adversary-engine): direct `markHp` on a PC without a hit should call `markHpGuard` (Fire Beam).
- dcm-go7u (lane:w1-e7-adversary-engine; touches E8's card-effects run.ts too): carry the producing damage step's
  keyword on the plan's `pcDamage` step and `IncomingHitDraft`, pass it as `HitDraft.keyword`.
- dcm-s7hd (bug, lane:w1-e7-adversary-engine): adversary sheet effect ids over 40 characters fail the sheet schema
  (`card:outer-realms-abomination/Reality Quake:1`, `card:cephilith-abomination/Burrowing Leechpoles:1`), so Unstuck
  and Leechpoles can't land on a PC sheet yet; `pcMods` reads them once they can.

## Data switches ready for wave 11 / the S tracers

- `adversary-effects/t4-core.ts` (Reality Quake, Unstuck) and `t4-hf.ts` (Burrowing Leechpoles, Hunger Pangs Ravenous):
  the hit half of their manual reminders can go (dcm-12kx) once dcm-s7hd lets the long ids be stored (Ravenous' id fits:
  its reminder's hit / payer half can go now).
- `adversaries.ts` (S3.4): standard-attack `keyword: "fire"` (Elemental Blast, Burning Candlestick, both Spirit Flames)
  is read now (dcm-dztv).
- `adversary-effects/t4-hf.ts` (S4.4): Fire Beam's two `markHp` steps take `keyword: "fire"`; riders honour it now, the
  direct path after dcm-vvg1.
- `feature-effects/beastforms.ts` (S2.4): Armored Shell's "in your shell" use can say `reduceDamage` by
  `{ kind: "stat", stat: "armorScore", who: "self" }` (dcm-i9c1); drop the manual step.
- `feature-effects/heritage-hf.ts` (S2.4): Fireproof's comment ("on a hit whose keyword is unknown the reaction is still
  offered") is out of date: the GM decides now (dcm-sk4r). No data change needed.

## QUESTIONS

1. **When is a hit's keyword "unknown"?** User answer 2026-10-31: "Fireproof on an untyped hit: the GM decides whether
   the hit is fire; a fire-tagged hit applies it directly." HF p.22: "You are immune to damage from magical or mundane
   flame." Built: the data counts as knowing when it covers the hit: an SRD standard attack (its stat block's keyword,
   or none = not fire) and a feature whose damage steps all agree. The GM is asked only for a feature whose steps
   disagree (Randomized Tactics), a feature with no damage step, a custom adversary and a PC's card without damage
   steps. The other reading asks on every hit without a fire tag (every bandit sword on an Emberkin). Confirm (a) as
   built, or (b) ask on every untagged hit.
2. **A redirected hit** (I Am Your Shield, CB p.341: the ally takes the damage): the ask is opened for the first
   target's guard only. If a Fireproof ally takes over an unsettled hit of a non-Fireproof target, no ask is made and
   the hit counts as not fire. Simplest reading; confirm or say whether the ally should be asked about.
3. **Fireproof and riders**: immunity ignores the hit's damage (CB p.99: "ignore incoming damage of that type"); the
   hit's other riders (conditions, Stress) still land, and outright HP marks of a fire feature are ignored (dcm-n7kt).
   Confirm.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean (with `convex/_generated` regenerated locally for `hitKeywords`).
- Focused: `tests/convex/lane4-e2-hits.test.ts` 13 passed; the 19 hit / window / reaction / adversary data files 234
  passed; authz matrix + adversary-actions area + unauthenticated sweep 981 passed (with the entries above, reverted).
- Full suite (`--maxWorkers=1 --testTimeout=120000`, with the entries in place): 420 files, 9865 passed, 1 expected fail.
- `tests/e2e/lane4-fire-ask.spec.ts` (ports 3145 / 3402): 2 passed. The first two builds failed with "next/font/google
  queries have exactly one entry"; deleting `.next-e2e-3145` and building outside the sandbox fixed it (docs/testing.md).
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml E2.4 rebuild HEAD`: flags only `convex/hitKeywords.ts` (the
  accepted extra file).
