# TASK-LN3-S4: tier 3-4 adversary data switches (plan lanes-2, wave 9)

Branch `lane3-s4`, lane `w2-srd-data`. Owns the four tier 3-4 adversary effect tables (`src/lib/srd/adversary-effects/
t3-core.ts`, `t3-hf.ts`, `t4-core.ts`, `t4-hf.ts`), their unit tests and `tests/convex/lane3-s4-*.test.ts`.

Rule (S1's): switch only data whose engine path is live at rebuild HEAD, proven by a test; otherwise data + the manual
reminder (comment `Lanes-2 (dcm-xxx)` naming the engine bead), listed below for wave 10.

## What landed

| Entry | Change | Live? | Proof |
| --- | --- | --- | --- |
| t4-hf.ts Power Slide (Xero, HF p.97) | "take Severe damage" option = `markHp` 3 (user answer dcm-6rke) | yes | t4-hf.test.ts |
| t4-hf.ts Elemental Archon 1. Fire Beam (Adonix, HF p.96) | fail `markHp` 3, success `markHp` 1 (dcm-6rke) | yes | t4-hf.test.ts |
| t3-hf.ts The Weight of Opulence (Catrin, HF p.81) | manual step reworded to the answer (dcm-trz9): a Hope per bag, a Stress per bag not paid with Hope | manual: the adversary run has no gold count (goldOf not passed, dcm-n3mp) | t3-hf.test.ts |
| t3-hf.ts Hellwing (Vampire Lord, HF p.88) | manual line replaced by a permanent `effect` on self with `standardAttack` Claws: Close, 3d12+6 phy (dcm-gx3) | yes | lane3-s4-adversary-data.test.ts (useFeature stores it; `evolvedBlock` attacks with Claws), t3-hf.test.ts |
| t3-core.ts Never Misses (Adult Flickerfly, CB p.228) | auto manual reminder replaced by passive flag `attacksHalveEvasion` (dcm-4c9m) | yes | t3-core.test.ts (`runStandardAttack`: d20 5 + 3 hits Evasion 15 halved; misses without) |
| t4-core.ts Reality Quake / Unstuck (CB p.237) | Unstuck tag carries `marksMultiplier` x2 of hope / armor / hp / stress; reminder kept, adds "(an Armor Slot needs two free slots)" (dcm-3m5k) | **no** (see dcm-12kx) | t4-core.test.ts, lane3-s4 (lastingModsOf) |
| t4-hf.ts Burrowing Leechpoles (HF p.90) | Leechpoles tag carries `damageTaken` `add` `creatureTokens` self "leechpole"; reminder kept | no (dcm-12kx, dcm-n3mp) | t4-hf.test.ts |
| t4-hf.ts Hunger Pangs / Ravenous, Nightmare Stare / Afflicted (HF p.94-95) | `cannotSpendHope`; `cannotClearHp` + `cannotClearStress` on the tags; reminders kept | no (dcm-hgvx, dcm-12kx) | t4-hf.test.ts |
| Fire keywords (dcm-dv6) | `keyword: "fire"` on: t3-hf Fireball, Breath of Fire, Unleash Hellfire, Flame Breath (both damage steps); t4-core Conflagration, Molten Scourge Eruption, Volcanic Breath (both), Lava Splash; t4-hf Mitera's 1. Fire head, Ruby Dragon Melting Breath, Volcanic Fissure | partly: Conflagration, Unleash Hellfire, Lava Splash are read by `hitKeyword`; the rest sit in save branches (dcm-5gng) | unit tests per file, lane3-s4 |

The Brief said Unstuck on hits and the fixed Leechpoles add are live via E2. They are not, for adversary-applied
conditions: `pcMods` (convex/lib/adversaryHits.ts) reads only sheet effects whose id matches `card:<cardId>:<n>` or
`feat:…`, and an adversary condition on a PC is stored as `card:<adversaryId>/<feature>:<n>`. A scratch probe gave
`pcDamageMods` = `{}` for a sheet carrying Reality Quake's Unstuck. So both stay data + reminder.

## Verified and kept (listed for wave 10)

- No "Spit Acid" entry exists in tiers 3-4. The like features (t3-core Crushing Blows / Acidic Form `forcedArmor`, t4-hf
  Hot-Blooded) already gate the extra HP on "no free Armor Slot" (`targetCheck`, dcm-18i, live). `markArmor.ifUnable`
  would do the same; left as is.
- t3-hf Unleash Hellfire `perArea`: keep (dcm-va0f, pointsOf).
- t4-hf Lightning Strike / Bolt `checkFails`: keep (dcm-4yg4 chain prompts).
- t4-hf Transform (Forlorne) `changeForm`: keep (dcm-f70y).
- t3-hf Slash and Burn: the +10 magic on a physical standard attack stays one merged `modifyDamage` (dcm-i55). Its
  burn is fire in the text, but the hit is the standard attack's, whose keyword the server doesn't read; not tagged.
- 'Get Over Here!' ATK: already done (E7 dcm-vv2).

## Beads

- dcm-6rke: **done** (Power Slide, Fire Beam).
- dcm-trz9: **done as far as the data can go**: the manual step carries the answer. Data (a `hope` lose per bag with
  `ifUnable` Stress per unpaid bag) waits on the adversary run's gold count (dcm-n3mp).
- dcm-gx3 (Hellwing data), dcm-4c9m (Never Misses data): data done.
- dcm-fbsr / dcm-kvx4 / dcm-5kxg (data halves for Unstuck, Leechpoles, Ravenous, Afflicted): data written; reminders kept.
- dcm-dv6 (tier 3-4 data): done.

## Follow-ups filed

- **dcm-12kx** (P2, lane:w1-e2-damage-window): `pcMods` doesn't read adversary-applied sheet effects; Unstuck
  marksMultiplier, Leechpoles damageTaken, Ravenous / Afflicted flags are not read on a PC hit or payer. Fix: read
  `card:<adversaryId>/<feature>:<n>` effects via `lastingModsOf` as `sheetLasting` does.
- **dcm-5gng** (P3, lane:w1-e2-damage-window): `hitKeyword`'s `everyStep` skips save branches and followUp steps (most
  fire damage), and takes one keyword per feature (Mitera's other heads would read fire once it walks them).

## Data switches ready for wave 10

- t4-core.ts Reality Quake: after dcm-12kx, drop the hit half of the Unstuck reminder; after dcm-q40t (spends), drop it.
- t4-hf.ts Burrowing Leechpoles: after dcm-12kx + dcm-n3mp (token store), add a `tokens` / creatureTokens step for the
  2d4 and drop the reminder.
- t4-hf.ts Ravenous / Afflicted: drop the reminders once dcm-hgvx (payer flags, clear steps) and dcm-12kx land.
- t3-hf.ts The Weight of Opulence: after dcm-n3mp (goldOf on the adversary path), write `hope` lose `gold bag` with an
  `ifUnable` Stress per unpaid bag.
- Fire keywords inside saves become live with dcm-5gng (no data change).

## QUESTIONS

1. **Lava as fire.** Fireproof (HF p.22): "You are immune to damage from magical or mundane flame." Made of Straw (HF
   p.79): "takes double damage from fire." The Molten Scourge's lava (CB p.238: Eruption "take 4d6+6 physical damage",
   Volcanic Breath "a flow of lava … 2d10+4 physical damage", Lava Splash "molten blood … 2d10+4 direct physical damage")
   and the Ruby Dragon's Volcanic Fissure (HF p.95: "a lava rift … 4d8+5 magic damage") are tagged fire here. Is lava
   damage fire (an Emberkin immune, a Scarecrow doubled)? Simplest reading taken: yes.
2. **Fire Beam on an Emberkin.** Fire Beam (HF p.96: "a beam of elemental fire … Targets who fail take Severe damage")
   is now 3 / 1 HP marked outright per the answer to dcm-6rke (no damage type). Marking HP is not damage, so Fireproof
   doesn't stop it. Should an Emberkin be immune to Fire Beam?

## Checks

`pnpm lint` clean, `pnpm typecheck` clean, focused tests (tests/unit/adversary-effects + lane3-s4) 1060 passed,
`pnpm test --maxWorkers=1 --testTimeout=120000`: 9586 passed, 1 failed: combat-riders "Kick", the known roll-dependent
flake dcm-lfbf (not in S4's files; passes on rerun). Tracer guard S4 OK.
