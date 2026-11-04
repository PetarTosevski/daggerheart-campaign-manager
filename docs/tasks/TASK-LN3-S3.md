# TASK-LN3-S3: SRD data, tier 1-2 adversary effects (lanes-2, wave 9)

Branch `lane3-s3`. Owns: `src/lib/srd/adversary-effects/{t1-core,t1-hf,t2-core,t2-hf}.ts`, their unit tests,
`tests/convex/lane3-s3-*.test.ts`, this doc.

## What landed

- **dcm-6n0p** (follow-up ATK workaround): t1-hf Broken Magic / Discordant Visions follow-up is a plain `ATTACK` now
  (the runner adds the stat block's ATK inside a check-table row since dcm-b3bb). The same workaround in t2-core Battle
  Box Randomized Tactics (Mana Beam, Fire Jets, Trample: `modifier: fixed(2)` in check then / otherwise follow-ups) is
  gone too; the runner adds ATK +2 there as well. Expected totals in the tests are unchanged (each test discriminates:
  d20 10 + 2 hits Evasion 12, 10 alone misses).
- **dcm-72qk** (user answers):
  - (a) Covered in Spiders (t1-hf "Get 'em Off"): the rider's `choose` labels are "Mark a Stress" | "GM gains Fear"
    and the choose says the player picks. The PC-roll half of bearer riders (dcm-mm0f) isn't live, so a manual step
    with that text goes with the condition (silent reminders, dcm-s9md). Comment left on dcm-mm0f to drop it.
  - (b) Taunt (t1-core Goading Strike): already built as answered (disadvantage against others until the next
    successful attack, `endsOn: attackSucceeds`); comment records the answer.
  - (c) Exile (t1-core Petty Noble): targets every PC (`count: all`, unlimited), one condition step; the old
    GM-picked "allies" step is gone (it never fired anyway: a `picked` list with count `all` is not pickable in the
    GM's tracker, so nothing was sent). Proven through `adversaryActions.useFeature` (both PCs get Exiled).
  - (d) Half of an odd result rounds up: already built (Stone of Omens `HALF_ROLL`); comment records the answer.
- **Fire keyword** (dcm-dv6): `keyword: "fire"` on every fire damage step of the four files: t1-core Hellfire (both),
  Scorched Earth (both), Explosion, Red Ooze Ignite (hit + the Ignited rider's 1d4), Tiny Red Ooze Burning; t1-hf
  Dance in the Flames (both); t2-core Battle Box Fire Jets; t2-hf Guahalan Spirit Beast Beast Bomb ("white flame").
  Reader check (`hitKeyword` in convex/lib/adversaryHits.ts): live for Explosion, Ignite, Burning, Beast Bomb. NOT read
  yet for steps inside save onFail / onSuccess or followUp (Hellfire, Scorched Earth, Dance in the Flames, Fire Jets):
  follow-up **dcm-7vei** (E2). Data is ready; nothing to switch later.
- **Eye of the Sage** (t2-hf Centaur Warden): `critRange: 19` was data with no reader (dcm-mhn) and no reminder; a
  manual reminder is back (silent reminders).
- **Spit Acid** `markArmor.ifUnable` (t1-core Acid Burrower; the same shape in t1-core Acidic Form / Armor-Shredding
  Shards, t2-core Shark Rending Bite, t2-hf Gobstalker Corrode): already data; verified live on the adversary path
  (runner reads armor / armorMax that `pcCombatant` fills): new unit assertion, a full PC takes the HP + the Fear and
  no forced slot.

## Beads

| Bead | State |
| --- | --- |
| dcm-6n0p | done (t1-hf; t3/t4 were done by SRD-A2). Closable. |
| dcm-72qk | done (a: data + reminder until dcm-mm0f PC half; b, d confirmed; c switched). Closable. |
| dcm-dv6 (tier 1-2 data part) | data done; reader gap dcm-7vei |
| dcm-nh44 (Stone of Omens split) | data waits: the GM's ask has no hope split, follow-up **dcm-mvgc** (E7) |

## Kept / listed for wave 10

- t1-hf Stone of Omens hope split: needs dcm-mvgc, then targets every PC with `distribution: "split"`.
- t1-hf Covered in Spiders: drop the manual step once dcm-mm0f's PC-roll half runs riders and asks the player.
- t2-hf Mind Meld split (dcm-63j / E7 would-mark hook): kept manual.
- t2-hf Tentacle Rays forcedAttack / Beguile (dcm-f70y, dcm-zi3k): kept manual.
- t2-hf Eye of the Sage: drop the manual reminder when the adversary attack reads `critRange` (dcm-mhn).
- Ravenous / cannotSpendHope flags: none in tiers 1-2 (Ravenous is t4-hf, S4's).

## Data switches ready for wave 10 (per file)

- t1-core: none pending (fire keywords become effective with dcm-7vei, no data change).
- t1-hf: Stone of Omens (after dcm-mvgc); Covered in Spiders manual drop (after dcm-mm0f).
- t2-core: none (Fire Jets keyword: per-branch keyword needed before dcm-7vei reads it, else Mana Beam / Trample would
  read as fire too; noted on dcm-7vei).
- t2-hf: Eye of the Sage reminder drop (dcm-mhn); Mind Meld (dcm-63j); Tentacle Rays (dcm-f70y).

## QUESTIONS

1. Fire keyword readings (simplest reading of the book's words): Red Ooze Ignite ("Ignited until they're extinguished",
   CB p.216) and Tiny Red Ooze Burning ("A small moving mound of translucent flaming red slime", CB p.216) are tagged
   fire. Gobstalker Tentacle Rays row 6 "Sear. The target takes 2d8 direct magic damage." (HF p.75) and Battle Box
   Mana Beam "fires a searing beam" (CB p.221) are NOT tagged (a searing beam isn't named as flame). Confirm.
2. Fire on standard attacks: Minor Fire Elemental "Elemental Blast" (CB p.214), Redcap Candlemaker "Burning
   Candlestick" (HF p.67), Guahalan Spirit Singer "Spirit Flame" (HF p.77) are fire by name, but a standard attack
   carries no keyword today (no vocabulary for it). Should they count as fire for Fireproof / Made of Straw?

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test --maxWorkers=1 --testTimeout=120000`: 393 files, 9586 passed, 1 expected fail.
- `node scripts/tracer-guard.mjs .omc/plans/lanes-2.yaml S3 rebuild HEAD`: OK.

## Merge-time actions

None: no public function changed, no codegen, no package.json lines.
