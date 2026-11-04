# TASK LN3-E2.3: Incoming damage and the reaction window, round 3

Plan `.omc/plans/lanes-2.yaml`, tracer E2.3 (label `lane:w1-e2-damage-window`, branch `lane3-e2`, wave 9). Book pages
are printed pages (CB = Core Book, HF = Hope & Fear). No `types.ts` and no `src/lib/srd/**` were touched. The doc name
is the one in the tracer's `owns` (`docs/tasks/TASK-LN3-E2.md`).

## User answers recorded here

- **2026-10-31, "took damage"** (coordinator, mid-task): "took damage" means at least 1 HP was actually marked. A hit that
  armor, a feature or a grant leaves at 0 HP marked is NOT taking damage, even at Minor or worse (Slumber, CB p.332,
  "Asleep until they take damage"; replaces round-1 E6 Q1's reading). Built in `resolveIncomingHit`: the hit's
  `damageTaken` occurrence carries severity `none` when no HP was marked, so `takeDamage` / `majorDamage` / `takeSevere`
  ends don't fire (what ends on `reducedToNoHp` is still the window's `endedOnNoHp`, dcm-sim). The same reading is applied
  to Fragile Beastform ("take Major or greater damage", CB p.32) and the stance drop on Severe damage (HF p.12). Event
  names unchanged; `expiry.ts` (`occurredEvents`) is E6.3's. `window.ts` needed no change: its `endedOnNoHp` already
  fires only when the hit marks 0 HP.
- 2026-10-31 Q26 (dcm-3m5k): under Unstuck an Armor Slot needs two free slots.

## Beads

| Bead | State | How |
|---|---|---|
| dcm-8f51 caster areas on hits | **closable** | `hitCasterEnds` (`incomingHits.ts`): on a hit that marked HP, `endForCasterOnInstances` with the hit PC's token (stored target token, else read from the hit's map) and `endCasterAreas` for the PC's live areas; instances go in the GM row's `adversaryBefore` (undo), area labels in the feed. Hush's Silenced on an adversary now ends on the caster's Major damage. Hush's AREA has no `endsOnCaster` in data yet (midnight.ts comment, gap dcm-rx1k): data switch below. |
| dcm-nnbl E2 half (Hope before forced HP) | **closable for E2**; E7.3 passes `reduceWith` | `hitRiderValidator` hp rider widened with `reduceWithHope`; the window offers it as the `hope` grant (see "Grants"); `applyRiders` spends the chosen Hope on those riders' HP first (1 HP per Hope, Unstuck's factor applied, never more than held). A forced-HP hit with no damage now makes the target a responder (`openWindow`). Left (E7.3, `convex/lib/adversaryActions.ts` ~line 287): push `{ kind: "hp", amount, reduceWithHope: true }` for a `markHp` step with `reduceWith: "hope"`. |
| dcm-5cn5 / dcm-6ju E2 half (Money Talks) | **closable for E2**; data switch left | `goldForHp` / `goldForHpOf` (`adversaryHits.ts`): the attacker's stat block grants gold when an `onTargetMarksHp` (standard or any attack) use's steps hold `convertMarks from: "hp" into: "gold"` (nested in an `optional` too), standard attack only. `pending.grants` gets `{ id: "gold", label, amount: handfuls held }`; at resolution the handfuls replace the HP this hit's damage marked (capped by those and the handfuls held), the sheet's `gold.handfuls` drops, and the GM line says to add them to the Demon (Collect stays the GM's button: `adversaryBefore` has no `tokens`, so an automatic add couldn't be undone). Double or Nothing is E1/E7's roll path. |
| dcm-hgvx window caller | **closable for the window** (run.ts callers are E3's) | `WindowPc.flags` from the PC's `Mod` flags (`pcFlags`: `pcMods` of the sheet's card / feature effects and passives); `affordable()` passes them into `PayerState.flags`, so a Hope-cost reaction card isn't offered under `cannotSpendHope`; the Hope grant isn't offered either. A condition from an adversary (Ravenous) gives no flag until its data carries one (t4-hf.ts says "no flag"). |
| TASK-LN2-R1 finding | **done** | A card answered in the window logs its plan's manual words on its line, like a feature answer (`respondToHit`). |
| dcm-bxp.99.19.60 | **migration done; narrow left** | `convex/migrations/targetCountExpiresAt.ts` `clearExpiresAt` (batched, idempotent) clears `payload.expiresAt` from `targetCount` rows. Not run against any deployment. Narrow (drop the field from `targetCountPayloadValidator`) after it ran everywhere. |
| dcm-6y00 (3) sanction point | **widen done** | `sanctionPointValidator` `{x, y}`; optional `point` on the sanction's `card` and `feature` actions. Nothing writes or reads it yet: E1.3a / the orchestrator wires sanction to store and replay it. |
| dcm-3m5k Unstuck armor | **closable** | `armorOptions` (offer side): under a `marksMultiplier` on armor each slot's benefit needs `factor` free slots (forced slots counted doubled), so with one free slot the armor option is unavailable (`armorCapable` false, prompt OK only, an `armor` answer refused INVALID). `applyHitToPc` keeps clamping given slots to a full track (`offer` false), which `tests/convex/lane-e2-round2.test.ts` line 125 still pins for direct callers. |

## Grants (one new answer)

The window's new answer `{ kind: "grant", id, amount }` (`hitChoiceValidator`, widened; `respond` args widen with it,
same authz entry). Ids: `hope` (dcm-nnbl: spend `amount` Hope on the `reduceWithHope` HP) and `gold` (dcm-5cn5: up to
`amount` handfuls instead of HP). The bead suggested `{ kind: "hopeReduce", hope }`; one `grant` shape serves both and
matches E7's `pending.grants` list. Window rules (`window.ts`: `grantOffers`, `grantAnswers`, `grantsTaken`): only the
current target, once per id, 1..the offered most, until their Done; a grant doesn't count as the armor answer, so the
prompt lists grants above the armor question (answer them first: once the armor answer leaves nothing to answer, the hit
resolves). The prompt (`reactions/prompt.tsx` `GrantItem`) shows the grant's words, a count and Spend; the optimistic
update drops the taken grant.

## What changed

| File | What |
|---|---|
| `src/lib/domain/adversary-actions/window.ts` | `WindowHit.grants`, `WindowPc.flags` / `gold`, `HitChoice` grant, grant functions, `openWindow` / `respond`, `affordable` flags. |
| `src/lib/domain/adversary-actions/severity.ts` | `armorOptions` Unstuck gate (`offer`). |
| `convex/lib/adversaryHits.ts` | `pcFlags`, `goldForHp(Of)`, `hopeReducibleHp`, `windowHitOf(…, gold)`, `windowPcOf` flags / gold, `rebuildWindow`, `applyRiders` Hope. |
| `convex/lib/incomingHits.ts` | grants at open / resolve / view; `hitCasterEnds`; HP-marked rule; card manual words. |
| `convex/lib/validators/combatRequests.ts` | hp rider `reduceWithHope`; `grant` choice; sanction `point`. |
| `convex/migrations/targetCountExpiresAt.ts` | New migration. |
| `src/components/combat-map/actions/reactions/model.ts`, `prompt.tsx` | Grant choice, `GrantItem`, `grantMax` / `grantAmount`. |
| `tests/unit/lane3-e2-window.test.ts`, `tests/convex/lane3-e2-hits.test.ts`, `tests/convex/lane3-e2-migration.test.ts` | New. |

## Merge-time actions

- `npx convex codegen`: a new module `convex/migrations/targetCountExpiresAt.ts` (the test runs it by name).
- Authz: no new public function; `adversaryActions.respond`'s `choice` widened (new `grant` member), the existing entry is
  unchanged in shape.
- Stored shapes widened only (hp rider, response choice, sanction action): no migration needed for them.

## Follow-ups

- E7.3 (lane:w1-e7-adversary-engine): pass `reduceWithHope: true` on `hp` riders from a `markHp` step with
  `reduceWith: "hope"` (dcm-nnbl's other half).
- E1.3a / orchestrator: store `point` on a held card / feature sanction and pass it to `useCard` / `useFeature` on approval.
- Orchestrator: run `migrations/targetCountExpiresAt:clearExpiresAt` per deployment, then narrow (dcm-bxp.99.19.60).
- E6.3: the "took damage" answer for `expiry.ts` (coordinator already told).

## Data switches ready for wave 10

- `adversary-effects/t3-core.ts` (Demon of Avarice, Money Talks `pay-instead`): replace the manual step with an
  `optional` (`by: "targets"`) holding `{ kind: "convertMarks", from: "hp", into: "gold" }`; the window offers the gold.
  Keep the GM `collect` button.
- `card-effects/midnight.ts` (Hush): the area may take `endsOnCaster: ["majorDamage"]`; incoming hits end it.
- Doom / Tentacle Rays data (`markHp` with `reduceWith: "hope"`): works once E7.3 passes the rider flag.
- Ravenous (t4-hf.ts): a `cannotSpendHope` flag on its condition / effect is honoured by the window once a PC sheet
  carries it as a card / feature effect with mods (adversary-made sheet effects aren't read by `pcMods` yet).

## QUESTIONS

1. Money Talks under Unstuck (CB p.237 doubles HP marked): built as one handful per HP actually marked (so a doubled
   mark costs two handfuls). Simplest reading; confirm.
2. Hope before forced HP under Unstuck: each HP spared costs the Hope factor (2 Hope per HP), as Hope spent instead of HP
   already does (wave 8). Confirm.
3. "Took damage" (user answer 2026-10-31) also applied to Fragile Beastform's "take Major or greater damage" and the
   stance's "Severe damage": a hit armored down to 0 HP drops neither. Confirm that those follow the same reading.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `pnpm test --maxWorkers=1 --testTimeout=120000`: 395 files, 9594 passed, 1 expected fail.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml E2.3 rebuild HEAD`: OK.
