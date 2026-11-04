# TASK-HUD-HD1: party banner query, scene query, enemy condition names for players

Plan `.omc/plans/combat-hud.yaml`, wave 1, tracer HD1 (boards Main, CmpTokens, GMDesktop). Bead dcm-bxp.99.32.8.
Server only: no UI, so no board shots (H1.1 / H1.2 / H1.3 draw from these queries).

## What landed

- `convex/combatHud.ts` (new):
  - `combatHud.party({ campaignId, mapId? })`: `campaignQuery`, `need: "view"`, `enough: "owner"`, returns
    `v.array(hudPartyMemberValidator)`. One row per PC token on the map (live map when `mapId` is left out): `characterId`,
    `tokenId`, `name`, `className`, `level`, `portrait`, `mine`, `hp` / `stress` / `armor` `{ marked, max }`, `hope`
    `{ value, max }`, `conditions [{ id, label }]`, `down`, `deathMoveDue`. Players read only the live map (another map
    reads as `[]`, as `combatTokens.party`); the GM any map. Unknown / other campaign's map: `[]`. No adversary, ally,
    neutral, custom or companion token ever appears.
  - `combatHud.scene({ campaignId })`: `need: "view"`, `enough: "owner"`; returns `{ fear, light, phase, day, canSetLight,
    canOpenTimeArc }`. `day` is `{ week, day, cycle }` in a frame with campaign time (Witherwild; initial time when the
    row is missing), else `null`. `canSetLight` = edit access and no campaign time (same rule as `campaigns.timeOfDay`);
    `canOpenTimeArc` = GM and campaign time.
- `convex/lib/combatHud.ts` (new): `hudConditionValidator`, `conditionLabel` / `hudConditions` (id → "Vulnerable"),
  `hudPartyMemberValidator`, `partyMemberOf` (the PC branch of `combatTokens.viewsOf`, copied, plus Hope, Armor, class,
  level and death move due). Armor max = `derivedDefense(sheet, installedAugments, featureScope(campaign)).armorScore`
  (the same cap `characters.adjustResource` uses); Hope max = `hopeMax(scars, hopeSlotBonus)`; `deathMoveDue` copies
  `deathMoves`' private `dueNow` (`deathMoveSpent !== true && canMakeDeathMove(...)`). A missing or unreadable character's
  token gets no banner (the classic token still shows it). The portrait validator is spelled out locally, not read from
  `tokenViewValidator`, because of an import cycle (`combatTokens` → … → `lib/combatVision` → `lib/combatHud`).
- `convex/lib/combatVision.ts`: `otherTokenValidator` widened with optional `conditions: [{ id, label }]` (answer 10a);
  `otherIdentity` fills it from the tracker instance's `conditions` (adversary) or the custom token's own, only when
  non-empty, so a row without conditions keeps the exact D9 shape (classic `combat-vision.test.ts` passes unchanged).
  The GM's labels (`tags`: Cursed, Glowing ...) are not sent. Hidden tokens are still filtered before this.
  `convex/combatVision.ts`: doc comments only.

## Tests

- `tests/convex/hud-party.test.ts`: banners hold the PCs only (no Bear / Goblin / difficulty / threshold in the JSON),
  `mine`, Hope / scars / Armor / conditions follow the sheet, death move due and Unconscious, live map only for players /
  any map for the GM / unknown id empty, no live map empty, outsider NOT_FOUND; scene in Witherwild (phase, day, arc for
  the GM only) and Beast Feast (Day / Dim / Night, no day, `canSetLight` for the GM only).
- `tests/convex/hud-enemy-conditions.test.ts`: visible Bear and custom Bandit carry condition names; exact row keys; no
  HP / Stress / Difficulty / thresholds; hidden Lurker absent; `previewAs` equals `playerView`; no field when none.
- Authz: `tests/convex/authz/hud.entries.ts` + `hud.test.ts` (area `hud`): both functions `access: "view"` for anon,
  outsider, player, other player, grantee, GM.

## Checks

- `pnpm typecheck`: clean (with a local `npx convex codegen`, not committed). ESLint on every changed file: clean.
- vitest `--maxWorkers=1`: focused files (hud-party, hud-enemy-conditions, authz hud + matrix guard, combat-vision,
  combat-tokens) pass. Full suite: 440 / 441 files, 10087 tests pass; the one failure is an unrelated dice flake in
  `tests/convex/rolls.test.ts` ("a server roll applies its own outcome", passes on 3 reruns), filed as dcm-yf2v.
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml HD1 rebuild HEAD`: OK.

## Beads

- dcm-bxp.99.32.8 (enemy condition names): done by this tracer; left open for the orchestrator to close at merge.
- Filed dcm-yf2v (flaky rolls test, unrelated to HD1).

## QUESTIONS

1. Days in every frame. Since lanes-2 CT every frame counts days (`campaignTime.calendar`, End day for every GM), but
   the acceptance says `day` is null without campaign time and `canOpenTimeArc` only with it. Built as specified. Should
   the disc in a core campaign
   a) show the light only (as built), or
   b) also show "Week n · Day n" from `calendar` and let the GM open End day?
2. GM tags on adversaries (`tags`: the GM's own labels like Cursed). Built: not sent to players. Should they
   a) stay GM only (as built), or
   b) reach players as badges like conditions?
3. `deathMoveDue` does not count the second step of a two-step move (Blaze of Glory / Risk It All waiting on
   `finishBlaze` / `resolveRiskItAll`); reading it needs a scan of the action log per PC. HD4 / H4.3 read
   `deathMoves.state` for that. OK?

## Merge-time actions

- Regenerate `convex/_generated` (new module `combatHud`; not committed from this branch).
- The authz area file `hud.entries.ts` is new and owned here; later HUD server tracers (HD2, HD3, H1.S, H5.3) add to it.
- No schema change.
