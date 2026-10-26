# TASK CA3: Server - weapon attacks on enemy tokens with automatic damage and undo

Plan `.omc/plans/combat-actions.yaml`, tracer CA3 (wave 3, depends on CA1 and AA0). Analysis:
`.omc/autopilot/combat-actions-analysis.md` (git-ignored). Book pages are printed pages; CB = Core Book. Status: Review.

## What landed

| File | What |
|------|------|
| `convex/lib/rolls.ts` | The Duality and damage internals moved out of `convex/rolls.ts` unchanged in behaviour (CF8): validators, `prepareDuality`, `prepareDamage`, `duality`, `damage`, `manualRng`... New: `resolveDuality` / `resolveDamage`, the first halves of `duality` / `damage` (pay, roll, apply Hope / Stress) without saving or logging. |
| `convex/rolls.ts` | Keeps every public function; imports the internals. No existing rolls test changed. |
| `convex/lib/combatActions.ts` | The attack steps: `attackScene`, `checkTargets`, `targetHints`, `attackDuality`, `resolveAttack`, Minion offers; validators of the player-facing results. |
| `convex/combatActions.ts` | `attack`, `targets`, `pickMinions`. |
| `convex/lib/combatRequests.ts` | `openSanction`, `openMinionOffer`, `openRequests`, `loadOpenRequest`, `encounterRunning`, `closeRequest`, `closeEncounterRequests`, `groupOffer`, `declineGroupOffers`. |
| `convex/combatRequests.ts` | `sanction` (GM), `mine`. |
| `convex/lib/actionLog.ts` | `LogEntry.adversaryBefore`; undo restores adversary instances (stale check), declines the group's open Minion offer; a `combat` row with a roll counts as a dice row for the player's one-minute undo. |
| `convex/lib/validators/combatRequests.ts` | Widened (rule 7, no shape removed): kind `minionOffer` and its payload; `damageOptions` on the stored roll options. |
| `tests/convex/combat-attack.test.ts`, `tests/convex/combat-attack-authz.test.ts` | 18 behaviour tests, 6 role tests. |

## User answers implemented (quoted from the plan)

- **Q1** "an attack or card use on a target outside its range needs the GM's sanction (the action waits as a pending
  request; the GM approves or declines; nothing is rolled before approval)".
- **Q2** "line of sight required, cover gives disadvantage".
- **Q5 / Q6 / U1** "player sees own damage total"; "player sees Defeated and picks extra Minions"; "Players never see an
  enemy's HP, Stress or thresholds. They only learn hit or miss."
- **U2** "Rolls made on the map also appear in the roll feed." **U4 / Q10** "Damage applies automatically; the GM can undo
  it." "no approval step".
- Orchestrator note: "Open combatRequests are closed (status declined, resolvedAt set) when their encounter ends; … CA3 for
  sanctions on the map."

## Rules (quoted, printed pages; re-checked in the extracted core book)

- **R1** (CB p.96): "The attack is successful against all targets for which the attack roll result meets or exceeds their
  Difficulty." **Critical** (CB p.90): "A critical success counts as a roll with Hope, even if you would've otherwise failed".
- **R2** (CB p.98): "If the attack uses a weapon, you roll a number of your weapon's damage dice equal to your Proficiency."
  Crits: "Start with the highest possible value the damage dice can roll, and then make a damage roll as usual".
- **R9** (CB p.104): "you only make one attack roll and compare its result to the Difficulty of each eligible target …
  roll damage once and apply the total to each target the attack succeeded against."
- **R3 / R10** (CB p.91, p.99, p.193): thresholds 1 / 2 / 3 HP, none at 0; resistance halves, immunity takes none. CA1's
  `applyDamageTo` applies them (Massive damage off for adversaries).
- **Minion (X)** (CB p.201): "This adversary is defeated when they take any damage. For every X damage a PC deals to this
  adversary, defeat an additional Minion within range the attack would succeed against. … Tell the attacking PC which other
  Minions within range the attack would succeed against and let them choose which Minions they defeat."
- **R11** (CB p.103): "Melee: 1 square • Very Close: 3 squares • Close: 6 squares • Far: 12 squares • Very Far: 13+
  squares". CB p.104: "You have line of sight if you can see the target." "attack rolls against you are made with
  disadvantage."

## Public functions and roles

All asserted on `ConvexError.data.code` in `combat-attack-authz.test.ts` (each role on a fresh world):

| Function | Wrapper | anon | outsider | other player (on Ash) | player (own) | GM |
|---|---|---|---|---|---|---|
| `combatActions.attack` | keyedCampaignMutation `need: "view"` + `loadCharacter` edit, rate limit `roll` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok |
| `combatActions.targets` | campaignQuery `need: "view"` + `loadCharacter` edit | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok |
| `combatActions.pickMinions` | keyedCampaignMutation `need: "view"` + `loadCharacter` edit on the attack's character | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | ok |
| `combatRequests.sanction` | keyedGmMutation, rate limit `roll` | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | ok |
| `combatRequests.mine` | campaignQuery `need: "view"`, `enough: "owner"` | UNAUTHENTICATED | NOT_FOUND | ok (own only) | ok (own only) | ok (all) |

For the D12 matrix (tests/convex/authz/combat.entries.ts is not CA3's): `attack`, `targets`, `pickMinions` and `mine` are
access class `view` (otherPlayer FORBIDDEN on characterA for the first three); `sanction` is `gm`. With synthesized
arguments (`targetTokenIds: []`, an `entryId` without an offer) a granted caller meets domain codes
(COMBAT_TARGET_INVALID, COMBAT_TOKEN_NOT_FOUND, COMBAT_MAP_NOT_FOUND, REQUEST_NOT_OPEN) that can go in `okCodes`; but
`pickMinions` and `sanction` answer NOT_FOUND for an unknown row, which `okCodes` may not hold, so those entries need
`setup` like the authz test's `scene()` (a live map, Ash's token, a running encounter with a Minion pack in melee and an
enemy at Very Close range) and an attack made in `setup`.

## How it works

### `combatActions.attack {characterId, mapId, targetTokenIds, slot, trait?, modifier, experienceIds, advantage, disadvantage, help, options, damageOptions?, slayerDice?, tideTokens?}`

1. The character the caller edits, in this campaign. The map must be the campaign's live map (COMBAT_MAP_NOT_FOUND); the
   attacker is the character's PC token on it (COMBAT_TOKEN_NOT_FOUND). The weapon in `slot` (DICE_RULE when none).
2. Targets, 1..20, no repeats: each must be seen by the character (vision `tokenVisibility`) with a clear line
   (`lineOfSight`), else COMBAT_NO_LINE_OF_SIGHT - checked first, so a token the player can't see answers the same whatever
   it is; then an enemy token linked to an undefeated instance of a running encounter, all in one encounter, else
   COMBAT_TARGET_INVALID.
3. Any target outside the weapon's range (`rangeCheck`, `rangeFromWeapon`): a `combatRequests` sanction (payload: the
   character, `{kind: "attack", slot, targetTokenIds, roll}`, `outOfRange [{tokenId, band}]`). Nothing is rolled, paid or
   logged; the costs are only checked (unaffordable Experiences refuse now, NOT_ENOUGH_HOPE). Returns
   `{status: "pending", requestId, outOfRange}`.
4. Otherwise `resolveAttack`:
   - one Duality roll with the weapon's trait (a "choice" trait weapon needs `trait`), `attack: true`, one extra
     disadvantage if any target is in cover; Hope / Stress / Know the Tide / Slayer Dice / Fear as `actionRoll`
     (`resolveDuality`), armed countdowns tick on the public row;
   - `resolveHits` against each target's Difficulty (plus instance `effects[].difficulty`);
   - on any hit one damage roll (`resolveDamage`, weapon at Proficiency, `critical` on a critical roll, `damageOptions`);
   - each hit target: `applyDamageTo` with its resistance (the instance's `resistance`, a conditional one only while
     `resistanceActive`; else CA2's `alwaysOnResistance` for SRD blocks or the custom block's). A Minion instance (type
     Minion or a "Minion (X)" feature; a group is one instance whose HP are its Minions) loses one Minion on any damage and
     adds `floor(taken / X)` extra picks;
   - instances patched (hp, defeated) in the same mutation; the sheet saved;
   - one actionLog group: the **public row** (kind `combat`, the character, the attack roll as `roll`, summary
     `Ash attacks with Longsword: Agility 15 with Hope; damage 9 (Longsword: 4, 5) → Bandit: Hit, Goblin: Miss, Wolf:
     Defeated`, `before` sheet, `fearDelta`) and the **GM row** (kind `combat`, visibility `gm`, no characterId, the damage
     roll as `roll`, summary per target `Bandit: 9 phy → Minor → 1 HP (1/5)` / `Goblin: miss (7 vs Difficulty 12)` /
     `Ghost: 9 phy (immune: 0) → No damage → 0 HP (0/4)`, `adversaryBefore`);
   - a Minion offer when the hits earned extra picks and a Minion still stands (same encounter, seen, within the weapon's
     range, its Difficulty beaten or a critical): a `combatRequests` row of kind `minionOffer`.
   - Returns `{status: "resolved", entryId, roll, damage, targets [{tokenId, hit, defeated}], fearGained, minionOffer
     {requestId, extra, candidates [{instanceId, tokenId, name, available}]} | null, prompts}`.

### `combatActions.targets {characterId, mapId, slot?}`

Every enemy token the character sees that can be attacked: `{tokenId, band, inRange, lineOfSight, cover}` and nothing
else (the returns validator has no stat field). `inRange` uses the weapon in `slot` (default primary; false without one).
Empty when the map is not live or the character has no token on it.

### `combatActions.pickMinions {entryId, instanceIds}`

`entryId` is the attack's public row. `instanceIds` lists one id per Minion (repeat a group's id for several of its
Minions), at most `extra`, each within its candidate's `available` and the instance's remaining HP (else
COMBAT_TARGET_INVALID). Marks one HP per Minion, logs a public row ("Ash defeats 2 more Minions → Rats, More rats:
Defeated") and a GM row with `adversaryBefore` in the attack's group, and resolves the offer (once: REQUEST_NOT_OPEN
after). An empty list passes. An offer whose encounter ended is declined (`status: "declined"`).

### `combatRequests.sanction {requestId, approve}` (GM) and `combatRequests.mine`

Decline closes the request. Approve re-checks the token, line of sight and targets (a failure throws and leaves the request
open for a decline), skips the range check, and runs `resolveAttack` with the player who asked as the rows' actor (so they
see "their" attack and may undo it in its first minute). A request whose encounter is no longer running is declined on
approval. `mine` returns open sanctions and Minion offers (names, bands and counts only): a player's own, all for the GM;
those of an encounter no longer running are left out.

### Undo (U4)

`actionLog.undo` of either row (the player only the public row, in its first minute; the GM any time) undoes the group:
the sheet (`before`), the Fear (`fearDelta`), the countdown ticks, every instance's oldest `adversaryBefore` (Minion picks
included), and declines the open Minion offer. An instance changed after the group's newest row refuses with UNDO_STALE.

## What a player receives (U1)

- `attack`: the attack roll (no `difficulty`: the roll has none), their damage roll, per target `{tokenId, hit,
  defeated}`, Fear gained, prompts, the Minion offer (`available` is capped at the extra picks).
- The roll feed: only the public row; its summary names Hit / Miss / Defeated. The GM row (HP, severity, Difficulty) is
  `visibility: "gm"`, which `feed.list` never gives a player; `adversaryBefore` is never in a feed row.
- `targets`, `mine`, `pickMinions`: tokens, names, bands, booleans and counts.
- Tests: `combat-attack.test.ts` "what a player receives" walks every key of the attack result and the player's feed page
  (no hp, stress, difficulty, major, severe, thresholds, adversaryBefore) and checks the public summaries against
  `HP|Stress|Difficulty|threshold|Minor|Major|Severe|(n/n)`; the targets, Minion and sanction tests do the same.

## Checks

- `pnpm typecheck`, `pnpm lint` (convex/ and the new tests): clean.
- `pnpm vitest run tests/convex/combat-attack.test.ts tests/convex/combat-attack-authz.test.ts`: 24 passed.
- Full `vitest --maxWorkers=4 --testTimeout=60000`: 229 files passed, 5568 tests passed, 1 expected fail; 1 failure: `authz-matrix.test.ts` listed the five new functions as missing (fixed by the follow-up).
- Follow-up: `pnpm lint`, `pnpm typecheck` clean; full `vitest --maxWorkers=4 --testTimeout=60000`: 250 files, 6106 passed, 1 expected fail; `authz/combat.test.ts` 285 passed (25 new role cases); tracer guard OK.

## QUESTIONS (answered by the orchestrator 2026-10-22)

1. **Several targets for a weapon** (CB p.96: "By default, each attack roll can only target one adversary"): keep up to
   20 for now (cards like Whirlwind need several); the orchestrator asks the user.
2. **Cover with several targets**: one disadvantage on the single roll if any target is in cover; default kept, to be asked.
3. **The Slayer choice after an attack**: yes. `rolls.pendingChoices` / `storeSlayerDie` accept the attack's public
   `combat` row as the latest roll with Hope (its group is not a Tag Team), and the row records `hopeGained` like
   `actionRoll`. Done in the follow-up (`convex/rolls.ts` `slayerRoll`, `convex/lib/combatActions.ts`); test "the Slayer
   choice after an attack with Hope".
4. **Minion offer kind**: fine.

## Follow-up (second commit; owns widened by the orchestrator)

- Matrix entries in `tests/convex/authz/combat.entries.ts` (`attacks`): `combatActions.attack`, `targets`, `pickMinions`
  (`view`, otherPlayer FORBIDDEN), `combatRequests.mine` (`view`, otherPlayer ok), `combatRequests.sanction` (`gm`).
  Setups `arena`, `attacked`, `sanctioned` add a running encounter with a Minion pack in melee and an archer out of
  range, and make the attack or sanction the entry needs, so every role meets its real code.
- `convex/encounters.ts`: `end` and `remove` call `closeEncounterRequests`, declining the encounter's open sanctions and
  Minion offers. Test: "ending the encounter declines its open sanctions and Minion offers; deleting it does too".
- `convex/tables/combatRequests.ts` comment and `docs/data-model.md` (`combatRequests` row, `actionLog` fields, retention
  job) describe the `minionOffer` kind and `damageOptions`.
