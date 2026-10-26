# TASK-D12-H7: Authz matrix - characters and character extras

Plan `.omc/plans/d12-hardening.yaml`, tracer H7 (depends on H0). Beads folded in: dcm-bxp.51 (`characters.toggleCondition`),
dcm-bxp.64 (`characters.applyDamage` with `negateMinor`). Harness API: `docs/tasks/TASK-D12-H0.md`.

## What landed

`tests/convex/authz/characters.entries.ts`: 44 entries, `pending` empty (`characters:get` stays in core.entries.ts,
H5's; 44 + 1 = the 45 character functions). `characters.test.ts` is unchanged (`runMatrix(area)`).

| Access | Count | Functions |
|---|---|---|
| `view` | 4 | characters.listByCampaign, characters.create, characterExtras.addCookbookEntry, characterExtras.removeCookbookEntry |
| `own` | 40 | every other function (characterId, `loadCharacter` / `editable` / the extras' `load` -> `permissionFor`) |

Every `own` entry runs the otherPlayer row: playerB acts on playerA's characterA. Reads (get, corruption,
augmentSwapOpen, portraitUrl) are ok for otherPlayer (a party member views every sheet, `rolePermission`); every write
is FORBIDDEN for otherPlayer.

### GM-only character functions

`loadCharacter(..., "owner")`, so `player: "FORBIDDEN"` (the owner is refused too):

- `characters:setTrait`: intended. Its doc and `updateSheet`'s trait check say players change traits only through
  level-up (user 2026-10-18); the GM can correct them. H0's FORBIDDEN for the owner is this rule, not a bug.
- `characters:assignOwner`, `characters:remove`: GM only by their docs.
- `characterExtras:repairCompanion`: GM only (CB 295, a technomancer's repair).

### Frame and class worlds (entry `world`)

| World | Entries |
|---|---|
| Motherboard, Beastbound rangers with an Ikonis (`MOTHERBOARD_RANGER`) | corruption, augmentSwapOpen, saveCompanion, setCompanionRemnant, repairCompanion, replaceCompanion, saveIkonis, gatherScrap, tradeScrap, addRelic, sellRelic, craftAugment, salvageAugment, installAugments, correctWallet |
| Witherwild druids (`DRUID`) | setBeastform |
| Beast Feast | addIngredient, removeIngredient, addCookbookEntry, removeCookbookEntry |
| Castle High | saveSkyshard |

The plan's acceptance also names Weredragon. Weredragon has no character extra: it is a frame tracker
(`convex/trackers/weredragon.ts`, H14's trackers area), so no characters entry needs a Weredragon world.

### Arguments and okCodes

Validation that runs before access is given valid args: adjustGold and adjustResource `delta: 1`, applyDamage
`damage: 1`, gatherScrap one die, and zod-parsed blobs (beastform state, companion, Ikonis, relic name, ingredient,
cookbook entry, skyshard). setExperience and moveCard read a real Experience id and loadout card from characterA's sheet
(otherwise the owner would get NOT_FOUND / INVALID). attachPortrait's setup stores an unclaimed PNG and picks it for
`v.id("_storage")`. create's setup retires characterA (one active character per player); removeCookbookEntry's setup
has playerA add a recipe, so the author and the GM remove it and otherPlayer is FORBIDDEN.

`okCodes` (a domain code thrown after the access check) where a successful call needs state the matrix does not build:

| Entry | okCode | Why |
|---|---|---|
| characters:applyDamage | CLASS_FEATURE_RULE | the `negateMinor` path (bead .64) without a New moon |
| characters:takeCard | INVALID | a level-1 character has no Domain Deck pick left |
| repairCompanion, replaceCompanion | EXTRA_RULE | no Corruption marked / companion not lost |
| tradeScrap, sellRelic, craftAugment, salvageAugment, installAugments, removeIngredient | EXTRA_RULE | no quantum, relic, scrap, built augment, open rest or ingredient |

## knownBugs

None. Every entry passes with the expectations read from the code: no player can change another player's character or
its extras, outsiders get NOT_FOUND, anonymous callers UNAUTHENTICATED.

## Checks

- `pnpm vitest run tests/convex/authz/characters.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`:
  2 files, 226 tests passed (characters 217 rows, guard 9).
- Area runtime (characters.test.ts alone, 217 rows): tests 14.6 s at load average 32, 33.5 s at load average 40
  (16 cores, other tracers running); under the 60 s budget.
- `pnpm exec eslint` on the owned files and `pnpm typecheck`: clean.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H7`: passes.
