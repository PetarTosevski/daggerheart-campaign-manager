# TASK-JOURNAL-JD4: Plan server

Plan `.omc/plans/journal.yaml`, tracer JD4 (bead dcm-z9rz.7). This tracer is server only, with no UI. It is bound by
the user's answers Q6 (one encounter per Combat scene; the old session encounter shows on the first Combat scene) and
Q7 (scene progress is automatic from the Combat Map; the GM marks non-combat scenes).

## What landed

**`convex/sessionPrep.ts`**

- **`get`**: each scene now comes back with `title?`, `state?`, `encounterId?` and `encounter`.
  - `encounter` is null, or the scene's encounter from `sceneEncounterId` (its own, or the legacy session encounter on
    the first Combat scene). Only Combat scenes have one.
  - The encounter carries `_id`, `name`, `status`, `pcs`, `adversaries`, `budget`, `spent`, `verdict`, `onMap` and
    `instances[]`.
  - Each instance carries `_id`, `label`, `type`, `count` (a Minion group's size, else 1), `bp`, `defeated` and `onMap`.
  - `bp` is the type's cost. A Minion group costs its own groups the size of the party. Summoned adversaries and
    unknown types cost 0.
  - `onMap` means the instance has a token on the campaign's live map. It is read once per query from
    `by_campaign_live` and `by_map`.
  - The top-level legacy `encounter` summary is unchanged, for the old Sessions UI.
  - The per-scene `encounter` is optional in the returns type only: the old UI's optimistic `addScene` builds a scene
    without it. The server always sends it. JX2 can narrow it once the old UI is gone.
- **`setScene`** takes a new optional `title`.
  - Each call sets exactly one of type, text or title; anything else is INVALID.
  - The title is trimmed and capped at `SESSION_TEXT_MAX.sceneTitle` (120). An empty title clears it.
  - Changing a scene to a non-Combat type drops its own encounter link. The encounter itself stays.
- **`setSceneState({ sessionId, sceneId, state })`** is a `gmMutation`.
  - `playing`: the scene that was playing becomes `done`. While the session is live it writes one log line
    `{ auto: true, event: "scene", text: "Scene N began · <title>" }`, or "Scene N began" when the scene has no title.
  - A scene that is already playing is a no-op, so it never logs twice.
  - A played session's scene refuses `playing` with `SESSION_SCENE_STATE`.
  - `done` changes only that scene. `planned` clears the state.
  - "Next" is derived on the client with `nextSceneId`.
- **`linkSceneEncounter({ sessionId, sceneId, encounterId })`**, **`createSceneEncounter({ sessionId, sceneId })`**
  (keyed, retry-safe) and **`unlinkSceneEncounter({ sessionId, sceneId })`** work on D8's own encounter rows and never
  copy them.
  - A non-Combat scene is refused with `SESSION_SCENE_STATE`.
  - A scene that already shows a different encounter is refused with `SESSION_HAS_ENCOUNTER`.
  - A created draft is named after the scene title, else "Session N · Scene K", under `encounters.create`'s
    `ENCOUNTER_LIMIT`.
  - Unlinking the first Combat scene also clears the legacy `sessionPrep.encounterId` it shows.
- The old `createEncounter` / `linkEncounter` / `unlinkEncounter` keep their behaviour. Their draft insert is shared
  with `createSceneEncounter`.

**`convex/lib/sessions.ts`**

- `campaignEncounter` is new.
- `sessionPlayEncounter(ctx, session, prep)` picks the encounter in this order, skipping dangling links:
  1. the playing Combat scene's encounter;
  2. else the encounter of the first Combat scene after the playing scene (from the top when none is playing) that is
     not done and has one;
  3. else the legacy session encounter, with no `sceneId`.
- `currentSessionEncounter` uses `sessionPlayEncounter` and also returns `sceneId?`. Callers keep their shapes:
  `sessionPrep.current`, `combatTokensReads.sessionEncounter` and `combatTokens.placeSessionEncounter`.
- `sceneBeganLine`, `playScene` (shared by `setSceneState` and the hook) and `playCurrentScene` (the Combat Map hook)
  are new.

**`convex/combatTokens.ts`** (added to JD4's owns by the orchestrator): `placeSessionEncounter` now calls
`playCurrentScene(ctx, found, ctx.user._id)` right after `startEncounter`. "+ Session encounter" on the Combat Map
therefore marks that encounter's scene Playing now (the previous one Done) and logs "Scene N began". This only happens
while the session is live. The legacy encounter without a scene plays nothing. `encounters.start` in the Adversaries
tab is deliberately not hooked: Q7 says the progress comes from the Combat Map.

## Migration

None. The legacy `sessionPrep.encounterId` is read as the first Combat scene's encounter (`sceneEncounterId`, as the
brief says), so no rows change shape.

## Tests

- `tests/convex/journal-plan.test.ts` covers:
  - title and state;
  - scene lines while live and none while planned;
  - the played-session refusal;
  - create, link and unlink per scene with chips and BP;
  - refusals for non-Combat scenes, an occupied scene and a bad id;
  - the legacy encounter on the first Combat scene;
  - dangling links and `onMap`;
  - `current` following scene progress;
  - the Combat Map hook on a live session (scene played, previous done, one line) and on a planned session (nothing).
- `tests/convex/session-prep.test.ts`: the `scenes` equality gains `encounter: null`.
- `tests/convex/authz/journal-plan.{entries,test}.ts`: the four new functions, GM-only (grantee FORBIDDEN).

## Questions (defaults taken)

1. The Combat Map hook runs only for a live session. Placing a planned session's encounter, for example while trying
   out the map, does not touch scene states. Alternative: also mark the scene (without a log line).
2. The hook also runs when the encounter was already running, because the GM started it in the Adversaries tab: placing
   it on the map is what plays the scene. It is idempotent while the scene is playing. If the GM placed a scene that is
   Done, the scene would be ignored, because `current` skips done scenes.
3. Setting a scene with its own encounter to Social, Exploration or Downtime drops the link (the encounter stays). The
   alternative is to refuse.
4. A Minion chip's `bp` is its own groups the size of the party, so chips can add up to more than `spent`, which groups
   every Minion together.
5. `setSceneState('playing')` is allowed on a planned session (state only, no log line) and refused on a played one.
6. The same encounter may be linked to several scenes.

## Merge-time actions

- Run codegen: no new module, but `sessionPrep` has new functions.
- JP1 / JP2 read `sessionPrep.get` `scenes[].encounter` and call `setSceneState` / `createSceneEncounter` /
  `linkSceneEncounter` / `unlinkSceneEncounter`.
- JX2: narrow the per-scene `encounter` to required once the old prep UI is deleted.
