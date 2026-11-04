# TASK-LN4-S3: SRD data, tier 1-2 adversary effects round 2 + fire standard attacks (lanes-2 wave 10, tracer S3.4)

Branch `lane4-s3`. Lane `lane:w2-srd-data`. Built on rebuild after batch A (V4, E1.4a, E1.4b, E2.4, E4.4, E6.4, E7.4,
E8.4). Owns: `src/lib/srd/adversary-effects/{t1-core,t1-hf,t2-core,t2-hf}.ts`, `src/lib/srd/adversaries.ts`, their unit
tests, `tests/{unit,convex}/lane4-s3-*.test.ts`, this doc. Rule: switch only data whose engine path is live on rebuild,
proven through the real path; otherwise keep the manual line and list it below.

## What landed

- **Fire standard attacks (dcm-dztv).** `src/lib/srd/adversaries.ts`: `attack.keyword: "fire"` on Minor Fire Elemental
  Elemental Blast (CB p.214), Redcap Candlemaker Burning Candlestick (HF p.67), Guahalan Spirit Singer Spirit Flame (HF
  p.77) and Catrin Spirit Flame (HF p.81; user answer 2026-11-01 Q1). E2.4's `hitKeywordInfoOf` / `srdAttack` reads it.
  `adversaries.ts` is generated (scripts/srd/gen-adversaries.mjs). The four lines are hand-added with a comment. A rerun
  would drop them: follow-up **dcm-bs32** (the generator should emit the keyword).
- **Encumber escape spawn (dcm-0hlq data; CB p.218: "If bramble tokens are removed from a target using a Finesse Roll,
  a number of Tangle Bramble Minions spawn within Melee range equal to the number of tokens removed").** t1-core
  Tangle Bramble Swarm Encumber gets a second use, `spawn`. It is `auto` on `{ kind: "pcEscapes", name: "bramble" }` and
  summons `triggerAmount` Tangle Bramble within melee. The brief and E7.4 call it "Drain and Multiply", but the book puts
  this spawn in Encumber; Drain and Multiply is the Minion's combine-into-a-Horde reaction and is unchanged. The manual
  Finesse line now says the GM records the escape with the Escaped button. Restrained / Vulnerable going with the tokens
  is still the GM's job (dcm-d3nj).
- **Stone of Omens (dcm-nh44, after dcm-mvgc; HF p.62: "which they can distribute among the PCs however they wish").**
  t1-hf Atototl: targets every PC (`count: all`), and the even branch's Hope gain is `distribution: "split"`. The GM's
  ask lists `{ what: "hope", among: "targets" }` ("Divide the Hope gained").
- **Eye of the Sage (dcm-mhn; HF p.70: "critically succeeds on a roll of 19-20").** t2-hf Centaur Warden: the manual
  reminder is gone. `critRange: 19` is read by the card runner (`rollOnce`) and the server's crit partition
  (`adversaryActions.ts`).
- **Tentacle Rays Doom (dcm-spj0; HF p.75: "The target must mark all HP, but they can spend any number of Hope to reduce
  the number of HP marked this way by an equal amount").** t2-hf Gobstalker beam 3 is now `markHp` with amount
  `{ kind: "free", who: "target", track: "hp" }` and `reduceWith: "hope"`. No hit is waiting, so E7.4 opens the PC's own
  window, with the HP as a `reduceWithHope` rider.

Already data, nothing to switch:
- Creeping Fire `moveLimit` (t1-core Red Ooze).
- Hive Mind (t1-hf Mechanorb): a passive Difficulty mod with `creatureCount`.
- Pack Fury (t2-hf): an attack mod with `alliesNearTarget`.
- Fire Jets: its damage step already has `keyword: "fire"`. Reading the keyword per branch is the plan side of
  dcm-7vei / dcm-go7u; until then the GM's ask settles it.

Tests:
- `tests/convex/lane4-s3-data.test.ts` (9 cases, SRD data only, no test entries):
  - each fire attack against an Emberkin PC: no HP and no `keywordAsk`;
  - the elemental against a PC without Fireproof: HP marked;
  - `pcEscape` with 3 bramble tokens: "Encumber (automatic)" and "Summon 3 Tangle Bramble within melee";
  - the Stone of Omens ask: split and `count: all`;
  - Tentacle Rays with the Doom beam picked for a Fear: the PC's window has rider `hp` = free HP, `reduceWithHope`.
- Unit tests:
  - t1-core Encumber: `pcEscapes` fires `spawn` for bramble only; the plan summons 2 for 2 tokens.
  - t1-hf Stone of Omens: the targets, and a 3 / 1 split.
  - t2-hf Eye of the Sage: no manual step; 19 is a critical, 18 is not.
  - t2-hf Tentacle Rays: the Doom row, and the `markHp` data.

## Beads

| Bead | State |
| --- | --- |
| dcm-dztv | closable (V4 type, E2.4 reader, S3.4 data). The generator half is dcm-bs32 |
| dcm-nh44 | closable (data on the E7.4 ask) |
| dcm-mvgc | closable (E7.4 engine + this data) |
| dcm-0hlq | already closed; data done here |
| dcm-spj0 | closable for Tentacle Rays Doom (tier 2). Other `reduceWith: "hope"` data in tiers 3-4 is S4.4's |
| dcm-mhn | already closed; reminder dropped |
| dcm-uxsd | not affected by this data (see Beguile below) |
| dcm-63j | still open: Mind Meld keeps its reminder (no "would mark Stress" hook) |
| dcm-7vei | still open for the plan-side keyword (dcm-go7u). Fire Jets data is ready |
| dcm-eg6h | closable (E7.4); Hive Mind / Pack Fury needed no data change |

## Follow-ups filed

- **dcm-bs32** (`lane:w2-srd-data`): gen-adversaries.mjs should emit `attack.keyword`, so a regeneration keeps the four
  fire attacks.

## Left for wave 11 (data not switched)

- **t1-hf Covered in Spiders** ("Get 'em Off"): the manual line stays. E1.4b's `bearerRiderRuns` runs the rider with no
  choices: the player's two-way pick ("Mark a Stress" | "GM gains Fear") is not asked. A card-plan `fear` step on the
  bearer also doesn't reach the GM's Fear. The line can go once the PC-roll rider asks its `choose` and applies GM Fear
  (E1 lane).
- **t2-hf Tentacle Rays Beguile**: the manual line stays. The book (HF p.75): "when a PC rolls with Fear, a Beguiled PC
  must mark a Stress or attack a target chosen by the Gobstalker". This is a later trigger on the bearer, not a forced
  attack on the hit. It needs a bearer rider on a roll with Fear, with a choose of Stress vs a `forcedAttack` (the
  rider's steps don't open forced attacks today). Also missing: "can't attack the Gobstalker" (dcm-zi3k). See Q1.
- **t2-hf Mind Meld**: the reminder stays (dcm-63j: no "would mark Stress" hook).
- **t2-core Fire Jets**: per-branch hit keyword (dcm-go7u).
- **Encumber Restrained / Vulnerable** ending on escape, and the player's escape roll: dcm-d3nj (E7).

## QUESTIONS

1. **Beguile (HF p.75)**: "Additionally, when a PC rolls with Fear, a Beguiled PC must mark a Stress or attack a target
   chosen by the Gobstalker." E7.4's doc reads this as a `forcedAttack` on the hit. I read it as a trigger on each roll
   with Fear while Beguiled, where the PLAYER picks: mark a Stress, or a forced attack on the GM's target. Who picks
   (the player, as for Covered in Spiders, or the GM)? Should the app open the forced attack request when the player
   picks "attack"? Until answered, the manual line stays.

## Merge-time actions

- No codegen change, no authz entries, no migrations. No edits outside owns.
