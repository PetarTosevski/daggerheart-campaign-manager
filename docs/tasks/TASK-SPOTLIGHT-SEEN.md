# TASK-SPOTLIGHT-SEEN: death moves are the GM's to undo; players learn a spotlighted adversary only once seen

Status: Review. Branch `spotlight-seen` (not a plan tracer). Two rules the user decided on 2026-11-03, recorded at the
end of `.omc/plans/overnight-questions.md`.

## 1. Players can't undo death moves

The player-undo rule still lives in one place, `convex/lib/actionLog.ts`. `groupGmOnly(group)` is now the whole rule:

- `groupRolled`: as before, any row of the action rolled → GM only.
- `groupDeathMove` (new): the action holds a `kind: "death"` row other than a waiting request → GM only, rolled or
  not. It covers:
  - a confirmed move;
  - Blaze of Glory's finish step (`finishBlaze`, no dice, the player's own row);
  - Risk It All's split (`resolveRiskItAll`, no dice, the player's own row).
- `isDeathRequestRow`: HD4's request row (kind death, no roll, no `before`, a `death-request:` group,
  `DEATH_REQUEST_GROUP_PREFIX`). It stays the player's, so "Take it back" still works while the move waits for the GM.

`viewerCanUndo` and `undoEntry` both use it, so `feed.list`'s `canUndo`, `deathMoves.state`'s `undoEntryId` and the
HUD follow with no client logic. A player gets UNDO_EXPIRED with the message "Only the GM can undo a death move.".

Tests:

- `tests/convex/action-log.test.ts` (+1): a player's own death row without dice is UNDO_EXPIRED and the GM's to undo;
  a request row stays the player's.
- `tests/convex/hud-death-confirm.test.ts`: after Blaze's finish and Risk It All's split, the player's
  `undoEntryId` is null, undo is UNDO_EXPIRED (`deathMoves.undo` and `actionLog.undo`), the player's feed has
  `canUndo: false`, the GM's has `true`, and the GM undoes both.
- `tests/e2e/death.spec.ts`: after the player's Blaze finish (Castle High), the player has no "Undo death move".
- `death-moves.test.ts` needed no change: no player undid a death move there.

## 2. Players learn which adversary holds the spotlight only if the party saw it this scene

### The rule (`combatSpotlight.state`)

- **The GM** always gets `adversaryTokenId` and the new `adversaryName`.
- **A player**:
  - if the party never saw that token this scene → both null;
  - if the party saw it this scene → both are sent. The HUD lights a token it draws. If the token is not drawn now
    (fogged, hidden, out of vision), the GM's-turn card names it instead.
- `adversaryName` is the encounter instance's `label`: the same name a player's view gives the token
  (`otherIdentity`).

### What "seen this scene" is

Nothing recorded it before:

- explored areas are squares per character, not tokens;
- `revealedTo` is the GM's dim-light reveal;
- scenes have no id: a scene runs from one End scene to the next.

New table `combatSeen` (`convex/tables/combatSpotlight.ts`): `campaignId`, `tokenId`, `seenAt`, index
`by_campaign_token`. Rule 6 (its own table, not an array). Helpers are in `convex/lib/spotlightSeen.ts`.

### Where it is written, and why it catches every reveal path

A player's visible tokens are computed in one place, `buildView` (`combatVision.playerView`). Many paths can change
what it returns:

- a PC's or an adversary's move, placement or facing;
- a carried light, a map light, an object light;
- a door, the fog marks, the map's walls;
- the GM's dim-light reveal;
- the campaign's time of day;
- an area (darkness), including its cron expiry.

Hooking each of those mutations would mean loading and computing the scene in every one of them, and some paths (the
calendar, area expiry) live far from the map. Queries can't write. So the record is written from the view's own
output:

1. `playerView` now returns `unseenAdversaries`: the adversary tokens in `others` that have no `combatSeen` row.
2. The player's client (`useSeenSync` in `src/components/combat-map/vision/use-vision.ts`, mounted in
   `vision-layer.tsx` next to `useExploredSync`) sends that list to the new `combatVision.markSeen`.
   - The effect depends only on the list's text.
   - It is a sync derived from server data, the same pattern as the explored-area sync, not an initialisation.
3. `markSeen` (every member, `campaignMutation` `need: "view"`, own character only, COMBAT_NOT_YOUR_TOKEN otherwise,
   at most `MAX_COMBAT_TOKENS` ids or INVALID):
   - recomputes the character's view on the live map;
   - records only the adversaries it sees now (`adversariesSeenNow`), so a client cannot claim one it never saw.
4. Once recorded, the view answers an empty list and nothing more is sent.

Any path that makes an adversary visible to a player shows up in that player's view, so this one hook catches them
all.

**Paths it cannot catch:**

- No player has the Combat Map open while the adversary is in sight. That is arguably "not seen". The GM's
  `previewAs` never counts.
- The adversary is visible for less time than the round trip: the server re-checks when the write arrives.
- Between the token appearing and the write landing (one round trip), a spotlighted, visible adversary reads null for
  the player. The HUD shows the GM's generic title, then lights the token.

### When it is cleared

- **End scene**: `forgetSeen` deletes the campaign's rows, at most `SEEN_MAX` (400) per call, outside the undo group
  like the areas. This runs from:
  - `endScene` (the Combat Map / Encounter tab End scene, the dashboard's `scenes.end`, `encounters.end`);
  - the session end (`sessions.end`, which ends the scene too).
  Afterwards the view lists the adversaries still in sight, and the client records them again.
- **The campaign purge**: a new step in `convex/cleanup.ts`.
- **Bound**: one row per adversary token seen since the last scene end.
- **Not cleared**: a deleted token's row. It lingers, harmless, until the next scene end.

### Update: seen is party knowledge, the card always names it (dcm-onze, user 2026-11-04)

- `combatSeen` was already one row per campaign + token, so no data change: once any player's character saw an
  adversary, `combatSpotlight.state` names it for every player of the campaign, a player with no token on the map
  included. The reset rules are unchanged.
- `state` gains `adversaryPortrait` (a returns field only): the rulebook art the token draws (`adversaryArtSrc`), null
  whenever `adversaryName` is null. The players' disc and phone disc draw it instead of reading their own
  `playerView`, so the portrait is party knowledge too and is never sent for an adversary nobody saw.
- `gmTurnTitle(state)` drops `drawn`: "<full label> has the spotlight" (the instance label the token shows, e.g.
  "Jagged Knife Lieutenant has the spotlight") whenever a name is sent, drawn on this map or not; otherwise "The GM
  has the spotlight". `GmTurnNotice` no longer subscribes to `playerView`.
- The section below describes the first version.

### HUD

`hud/spotlight` only:

- `model.ts`:
  - the new `gmTurnTitle(state, drawn)` gives "<name> has the spotlight" when the id and the name are known and the
    player's map does not draw the token; otherwise "The GM has the spotlight";
  - `afterTake` / `afterHandTo` set `adversaryName: null`, so the optimistic state keeps the generic title until the
    server answers.
- `index.tsx`:
  - `GmTurnNotice` takes `campaignId` and reads the drawn tokens from `playerView` (the subscription the vision layer
    already holds), only while an adversary is named;
  - the title is `data-testid="hud-gm-turn-title"`.
- The light stays on drawn tokens only (`litOf` / `isLit` unchanged).
- The card's reason line still says "An adversary is acting.".

## Files

- Server:
  - `convex/lib/actionLog.ts`, `convex/deathMoves.ts`;
  - `convex/tables/combatSpotlight.ts`, `convex/lib/spotlightSeen.ts` (new);
  - `convex/lib/combatVision.ts`, `convex/combatVision.ts`, `convex/combatSpotlight.ts`;
  - `convex/combatScenes.ts`, `convex/sessions.ts`, `convex/cleanup.ts`.
- Client:
  - `src/components/combat-map/hud/spotlight/{model.ts,index.tsx}`;
  - `src/components/combat-map/vision/{use-vision.ts,vision-layer.tsx}`.
- Tests:
  - `tests/convex/spotlight-seen.test.ts` (new, 6);
  - `tests/convex/hud-spotlight.test.ts`, `action-log.test.ts`, `hud-death-confirm.test.ts`;
  - `cleanup.test.ts`, `schema-guard.test.ts`, `authz/combat.entries.ts` (markSeen: view);
  - `tests/unit/hud/spotlight.test.tsx` (+2);
  - `tests/e2e/hud-spotlight-light.spec.ts` (+1 test, +1 check), `tests/e2e/death.spec.ts`.
- Docs: `docs/data-model.md` (`combatSeen` row), this file.

## Merge-time actions

- `npx convex codegen` (`convex/_generated` is not committed): new table `combatSeen`, new function
  `combatVision.markSeen`, new `playerView` field `unseenAdversaries`, new `state` field `adversaryName`.
- No migration: a new table, and new fields in returns only.
- An older campaign starts with no rows. Players see a spotlighted adversary only after their map is next opened with
  it in sight.
