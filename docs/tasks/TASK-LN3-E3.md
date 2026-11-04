# TASK LN3-E3 (tracer E3.3): card runner round 3

Plan `.omc/plans/lanes-2.yaml`, wave 9, tracer E3.3 (label `w1-e3-steps-saves`, branch `lane3-e3`). Files changed:
`src/lib/domain/card-effects/run.ts`, `src/components/combat-map/actions/hand/dialog.tsx`,
`tests/unit/card-effects/lane3-e3-round3.test.ts` and this doc. No types.ts, no `src/lib/srd/**`, no Convex function
changed (no authz entry, no codegen). `convex/lib/cardChoices.ts` needed no change (`triggerDamageType` parses since
round 2). CB = Core Book, HF = Hope & Fear (printed pages).

## What landed

- **`RunContext.creatures`** (dcm-ldom): the map creatures for `creatureCount`, forwarded into `NumberEnv`; it wins over
  `numbers.creatures`, which still works alone.
- **Stats from the creatures** (dcm-91tx): `tracksOf` now fills `stats` for every creature from its own Combatant: Major /
  Severe threshold (absent for a Minion's `null`), Evasion, and a PC's Armor Score as its Armor Slots ("you have a number
  of slots equal to your Armor Score"). Order: derived < the server's `numbers` < the actor's `stats`. So a `stat` number
  with `who: "target"` reads the recipient's threshold / Evasion (in per-recipient amounts such as `markStress`; a damage
  roll's amount is resolved once per move, without a target).
- **Payer flags** (dcm-hgvx, run.ts callers): `payer()` carries `flags` from `modsOn[actor]`, so `unaffordable` refuses a
  Hope cost while `cannotSpendHope` holds (every caller: upfront, optional, pay steps, `payBy`). A described payer
  (`context.payers`) gets its creature's flags added before `unaffordableBy`. Clear steps read E5's `clearBlocked`.
- **Fresh roll per chain link** (dcm-q13x, dcm-rou): with `RunContext.freshLinkDamage`, each link of a repeating
  `followUp` without its own roll is its own damage scope: one new roll per link, shared by the link's creatures (R9).
  **Default off**: two test files outside E3.3's owns pin the shared roll (`arcana.test.ts`, owned by S1 this wave, and
  `lane-e3-steps.test.ts`). Follow-up dcm-qoq9 turns it on (see below).
- **Hand dialog** (dcm-aw16, dcm-u4pq dialog half): exported `swapsWithVault(use)`, `asksTriggerDamageType(use)`, the
  types `VaultPick` and `DialogRequest` (`UseRequest & { swapWith? }`). `UseDialog` takes `vault?`; a use with a
  `loadout` `swapWithVault` step shows "Swap in from the vault" and blocks Use until a card is picked, then sends
  `swapWith`. A use with a `sameAsTrigger` damage step asks "Your ally's damage was" physical / magic and sends the
  `triggerDamageType` choice. (Encore is a reaction, so the Hand does not open it today; the ask is there once reaction
  cards open the dialog.)

## Beads

| Bead | State | Left |
|---|---|---|
| dcm-ldom creatures for creatureCount | done (runner) | E7 forwards `creatures` into `runCard` (dcm-eg6h). Closable after that line; E3 half closable now. |
| dcm-91tx target / self stats | **closable** | E2's window side fills the actor's stats (dcm-bxp.99.19.4); beastforms 'shell' data switch. |
| dcm-hgvx run.ts callers + clearBlocked | done (E3 half) | feature-effects/run.ts:187 (E8) and adversary-actions/window.ts (E2) callers. |
| dcm-q13x Chain Lightning per-link roll | partly | Engine + tests landed behind `freshLinkDamage`; dcm-qoq9: cardRunner sets it (or make it the default), update arcana.test.ts / lane-e3-steps.test.ts expectations and the arcana.ts comment. |
| dcm-rou repeated chain | **closable** (runner) | Chain links run since round 1; E4's x4ft / io4m for the server side as triaged. |
| dcm-bz8 per-recipient choice | **closable** (runner) | `choose` / `optional` with `by` and `chooserOptions` / `chooserOptionals` (round 1); cardChoices parses `by:` / `byOptional:`. Data (valor.ts Critical Inspiration / Rousing Strike) is kept manual this wave (brief, dcm-vbzy). |
| dcm-d1b host Hope / Fear die | **closable** (runner) | `RunContext.hostRoll` read by `dualityDie` (round 1, a9c). The server filling `hostRoll` for riders is E4's / E1's. |
| dcm-yzr clear flying | **closable** (runner) | `move` `mode: "ground"` sets `flying: false` in `plan.creatures`; the server ending a PC's Flying effect is E4 (x4ft). |
| dcm-aw16 (1) swapWith, (2) Encore type | done (dialog) | (1) index.tsx passes `vault` (dcm-8e4c, no lane owner); (2) cardRunner fills `trigger.damageType` from the choice (E4, dcm-m5fy). |
| dcm-u4pq dialog half | done | index.tsx `vault` prop (dcm-8e4c). |
| dcm-inou rerollHeld / key | runner done | The key share is featureLimitKeys (E8, dcm-40rt); server applies `heldReroll` (dcm-q40t). |
| dcm-0gh inventory step | **closable** (runner) | `inventory` plan entries (steal an item, take gold, damage a weapon; round 2 `giveGold` / `giveItem`) and `goldOf` numbers; the server writes are E7 / E8. |
| dcm-18i markArmor.ifUnable | **closable** (runner) | Data switch (Spit Acid entries) is S3 / S4. |
| dcm-5xi Hope gate | **closable** (runner) | `hopeOf` read by `hope.ifUnable` / `track hope`; the adversary server passes `hopeOf`. |
| dcm-xp0 creature tokens | **closable** (runner) | `creatureTokens` read and written in the plan. |
| dcm-7az repeat until miss | **closable** (runner) | Own roll per link, `costEach` paid (tests in lane-e3-steps). |
| dcm-q0a raised save | **closable** (runner) | `saveRaisers` pay; the server picks raisers within range (E7). |
| dcm-kkx effect stacking | runner done | Wave-8 note: verify Blight Seed end to end (E6 / E8); nothing left in run.ts. |
| dcm-5fc / dcm-8x8 endEffect | runner done | 5fc: feature path live, closable; 8x8: card paths wait on dcm-m48i (E1.3a). |
| dcm-qbn held-dice picks | **closable** (runner) | `heldDicePicks` spends picked dice first; E1.3a's dcm-ef77 passes them from useFeature. |
| dcm-q3t1 Otherworldly Ire count | runner done | featurePrompts passes the Favor choice (E8). |

## Follow-ups filed

- dcm-eg6h (lane:w1-e7-adversary-engine): adversary-effects/run.ts forwards `creatures` into `runCard`.
- dcm-qoq9 (lane:w1-e4-targeting-areas, lane:w2-srd-data): turn on `freshLinkDamage` and move the shared-roll tests.
- dcm-40rt (lane:w1-e8-session-features-rests): Weapon Specialist slayer-ones limit shares `WEAPON_SPECIALIST_KEY`.
- dcm-8e4c (no lane owner): hand/index.tsx passes `vault` to `UseDialog`.

## Data switches ready for wave 10

- beastforms.ts Armored Shell 'shell': `reduceDamage` by `{ kind: "stat", stat: "armorScore", who: "self" }` reads the
  actor's Armor Slots now (the window side also needs E2's stats fill).
- Any adversary / card step with a `creatureCount` amount the card runner resolves (Hive Mind, Pack Fury) once dcm-eg6h
  lands.
- arcana.ts Chain Lightning: no data change; only the comment after dcm-qoq9.

## QUESTIONS

None about rules. One process note: the user's Chain Lightning answer changes behaviour that `arcana.test.ts` (S1's file
this wave) and `lane-e3-steps.test.ts` (not in E3.3's owns) assert, so the switch ships default off rather than editing
files outside owns. Orchestrator: at merge, either flip `freshLinkDamage` on in cardRunner or make it run.ts's default,
and update the two tests' Chain Lightning expectations (dcm-qoq9).
