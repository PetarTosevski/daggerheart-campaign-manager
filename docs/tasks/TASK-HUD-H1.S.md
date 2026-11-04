# TASK-HUD-H1.S: spotlight state, the GM's take / hand-back, the players-only-react helpers, display

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 2, tracer H1.S (boards Main 'GM's turn', CmpTokens, GMDesktop,
CmpBlocked). Bead dcm-bxp.99.32.3. User answer 1c and the 2026-11-01 answer on movement (briefs).

## What landed

- **Table** `convex/tables/combatSpotlight.ts` (`combatSpotlightTables`; NOT composed into `convex/schema.ts`, see
  merge-time actions): at most one row per campaign (the scene being played now). `holder` `{ kind: "gm" } |
  { kind: "pc", characterId }`, `since` (ms), `reason` (`rollWithFear` | `failedRoll` | `adversary` | `gmTook` |
  `handedBack`), optional `rollBy` (the PC whose roll moved it). Index `by_campaign`. No row = the players hold it with
  nobody in particular. Its own table (rule 6 / CD10): it changes on many rolls, and only spotlight readers re-run.
- **Helpers** `convex/lib/spotlight.ts`:
  - `moveToGm(ctx, campaign, reason, rollBy?)` (`reason`: `rollWithFear` | `failedRoll` | `adversary` | `gmTook`):
    moves it to the GM; a no-op (no write, returns false) when the GM already holds it, so a run of Fear rolls does not
    re-run every reader and `since` / `reason` keep the first move.
  - `giveTo(ctx, campaign, characterId)`: hands it to an active PC of the campaign (NOT_FOUND another campaign's,
    INVALID not active); no-op when that PC holds it.
  - `assertMayAct(ctx, campaign, character, kind)` with `kind: "action" | "move" | "reaction"`: throws
    `SPOTLIGHT_WITH_GM` for a non-GM caller's `action` or token `move` while the GM holds it; `reaction` always passes;
    the GM (owner permission through `permissionFor`) always passes, including while playing for a PC. A character of
    another campaign is a programming error (plain `Error`). `ctx` needs `user` (every wrapper's ctx has it).
  - `spotlightOf(ctx, campaignId)`, `gmHoldsSpotlight(ctx, campaignId)` for other readers.
- **Functions** `convex/combatSpotlight.ts`:
  - `state({ campaignId })`: `campaignQuery`, `need: "view"`, `enough: "owner"`, `returns: spotlightStateValidator`:
    `holder` (null | `{ kind: "gm" }` | `{ kind: "pc", characterId, name }`), `since`, `reason`, `rollBy`
    (`{ characterId, name }` | null), `reactionsOnly` (a non-GM caller while the GM holds it), `canMove` (the GM). A
    holder PC that is gone reads as null.
  - `gmTake({ campaignId, idempotencyKey })` and `handTo({ campaignId, characterId, idempotencyKey })`:
    `keyedGmMutation` (`ctx.once`), return `{ moved }`.
  - **Undo:** not via `actionLog`. Its undo restores sheets, adversary instances, Fear and the calendar only; a
    spotlight snapshot would need a new `actionLog` field and an `undoEntry` branch (engine files, not H1.S's). The GM's
    undo of a take / hand-back is the opposite move. Undoing a *roll* that moved the spotlight: filed dcm-bxp.99.32.10.
- **Error code** `SPOTLIGHT_WITH_GM` in `src/lib/errors/spotlight.ts` ("The GM has the spotlight. Only reactions until
  it comes back to you."), joined in `app-error.ts` (`AppErrorCode`) and `convex-errors.ts` (`MESSAGES`).
- **Display** `src/components/combat-map/hud/spotlight/` (`index.tsx`, `model.ts`, `spotlight.css`):
  - `HudSpotlight` (the stub's name and props, unchanged; shell pop region): players, while the GM holds it: the
    "The GM has the spotlight" card (board `.gms`, left 690 / top 230, `role="status"`, with why: "Moss rolled with
    Fear." / "Moss failed a roll." / "An adversary is acting." / "The GM is making a move.") and the note "Reactions
    only until the spotlight comes back to you" (`.gmh`, above the hand; left 560 under `.sh-open`). The GM: a
    "Spotlight" panel under the Fear banner (right 24, top 196) with `SpotlightMenu`.
  - `SpotlightMenu({ campaignId, mapId? })` (GM only): who holds it, "Take the spotlight" (when the GM does not), and
    one "Hand the spotlight to <name>" button per PC on the map (`combatHud.party`, the banners' subscription) except
    the holder.
  - `SpotlightBannerTag({ campaignId, characterId })`: " · Spotlight" (board `.bn-c`) while that PC holds it.
  - `FearSpotlightTag({ campaignId })`: the SPOTLIGHT pill (board `.fb-spot`) while the GM holds it.
  - `SpotlightHandBack({ campaignId, characterId, name })` (GM only): "Give <name> the spotlight" for a banner's menu;
    nothing when that PC already holds it.
  - `useSpotlight(campaignId)`, `useSpotlightMoves(campaignId)` (`take()`, `handTo({ characterId, name })`, `error`;
    intents with optimistic updates built at the click), `GmTurnNotice({ state })`; `model.ts`:
    `spotlightReasonLine`, `holderLine`, `pcHolds`, `gmHolds`, `afterTake`, `afterHandTo`.
  - Every export calls `useQuery`: mount it under a `PartBoundary` (the shell's region parts already are).

Until beads dcm-bxp.99.32.4 (roll paths call `moveToGm`; spotlighting an adversary calls it with `adversary`) and
dcm-bxp.99.32.5 (use paths and token moves call `assertMayAct`) land, **only the GM moves the spotlight (gmTake /
handTo) and the server refuses nothing**: the HUD shows the GM's turn, but player actions still go through.

### For the parallel wave-2 tracers (wire after merge)

- H1.1 (banners): put `<SpotlightBannerTag campaignId characterId />` in the class line (`.bn-c`) and
  `<SpotlightHandBack campaignId characterId name />` in the banner's GM menu.
- H1.2 (Fear banner): put `<FearSpotlightTag campaignId />` under the Fear count, and, if the Fear banner gets a GM
  menu, `<SpotlightMenu campaignId mapId />` in it; then the GM panel in `HudSpotlight` can go (a one-line change in
  `hud/spotlight/index.tsx`: render nothing for the GM).
- H1.3 (tokens): nothing (GMDesktop's token "Spotlight" tag is the adversary's, H5.2).
- H5.2: spotlighting an adversary also calls `combatSpotlight.gmTake` (client) until dcm-bxp.99.32.4 does it on the
  server. H6.1 / H6.2: `state.reactionsOnly` disables non-reaction controls; the refusal code is `SPOTLIGHT_WITH_GM`.

## Board states matched

Shots from `tests/e2e/hud-spotlight.spec.ts` (real seed, 1440 × 900):
`test-results/visual/HUD-H1.S/player-gm-turn-1440.png` (Main 'GM's turn': the card at 690 / 230 and the reactions note
above the hand) and `gm-holds-1440.png` (the GM's interim spotlight panel). The banner tag and the Fear banner's
SPOTLIGHT have no host yet (H1.1 / H1.2 render the banners); they are covered by the unit tests. Differences from the
board: the card's line says why from the server's reason (the board's "The GM spent 1 Fear. The Lieutenant is acting."
needs the adversary's name, which `moveToGm` does not store yet).

## What moved out of the old column

Nothing: the classic page never showed who holds the spotlight (the Encounter tracker's per-instance spotlight counts
are a different thing and stay).

## Tests

- `tests/convex/hud-spotlight.test.ts` (12): no row / GM take / players and grantee reactions-only / take twice writes
  nothing / hand to a PC by name / keyed replay and IDEMPOTENCY_MISMATCH / NOT_FOUND another campaign's PC / INVALID a
  retired one / a gone holder reads as null / campaign isolation / `moveToGm` with Fear, failure, adversary (first move
  kept) / `assertMayAct` (action and move refused while the GM holds it, reaction ok, GM ok, ok while a PC or nobody
  holds it, foreign character throws).
- Authz: `tests/convex/authz/spotlight.entries.ts` + `spotlight.test.ts` (area `spotlight`): `state` `access: "view"`
  (other player, grantee ok), `gmTake` / `handTo` `access: "gm"`.
- `tests/unit/hud/spotlight.test.tsx` (8): the players' card and note, nothing while a PC / nobody holds it, loading
  status, banner tag, Fear tag, the GM's menu (hand back, take, holder excluded), the banner hand-back (GM only), copy
  and optimistic updaters.
- `tests/e2e/hud-spotlight.spec.ts` (1, two browsers): the GM takes it from the menu; the player's HUD shows the card and
  the note without a reload; the GM hands it to Moss and the notice leaves; axe on both views.

## Checks

Run with the merge-time edits below applied temporarily and a local `npx convex codegen` (all reverted before the
commit, so the branch alone does not typecheck until the orchestrator composes the schema and regenerates):
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest `--maxWorkers=1 --testTimeout=120000`, full suite: 446 / 446 files, 10158 passed + 1 expected fail.
- `tests/e2e/hud-spotlight.spec.ts` on ports 3143 / 3398: 1 passed.
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml H1.S rebuild HEAD`: OK.

## Beads

- dcm-bxp.99.32.3: done by this tracer; left open for the orchestrator.
- Filed dcm-bxp.99.32.10 (P3, `lane:w1-e1-triggers-rolls`, depends on .4): undoing a roll that moved the spotlight puts
  it back.

## QUESTIONS

1. Does ending a scene hand the spotlight back? CB p.107 ends the scene; CB p.100: "Once the GM has finished, play
   passes back to the PCs." Default (reversible): the row stays until the GM moves it; nothing in `combatScenes` touches
   it (an engine file). Should End scene (a) leave it (as built), or (b) clear it (the players hold it)?
2. Rolls outside combat. CB p.149 lists "Rolls with Fear on an action roll. / Fails an action roll." as moments for a GM
   move in any scene; answer 1c speaks of combat. Default left to dcm-bxp.99.32.4's call site: call `moveToGm` only
   while an encounter runs (safer: no refusals outside fights). (a) only during a running encounter, (b) on every
   action roll?
3. The GM playing for a PC (Play for this character) while holding the spotlight: built as never refused (the GM is
   acting). OK?

## Merge-time actions

1. `convex/schema.ts` (compose the table):

   ```ts
   import { combatSpotlightTables } from "./tables/combatSpotlight";
   // ...
     ...combatAreaTables,
     ...combatSpotlightTables,
     ...playForTables,
   ```

2. The campaign purge and its guards (files not owned here; with the table composed, `pnpm test` fails without them):
   - `convex/cleanup.ts`, in the purge steps after the `playFor` step:

     ```ts
     // Who holds the spotlight (plan combat-hud H1.S): one row per campaign.
     async (ctx, c, budget) => {
       const rows = await ctx.db.query("combatSpotlight").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
       await deleteRows(ctx, budget, "combatSpotlight", rows);
     },
     ```

   - `tests/convex/cleanup.test.ts`, in `seedCampaign` after the `playFor` insert:

     ```ts
     // The spotlight, handed to the PC (combat-hud H1.S).
     await ins("combatSpotlight", { campaignId: c, holder: { kind: "pc", characterId }, since: now, reason: "handedBack" });
     ```

   - `tests/convex/schema-guard.test.ts`, campaign-scoped list: add `"combatSpotlight",` after `"playFor",`.
3. `docs/data-model.md`: add the `combatSpotlight` table (fields and index as above; bounded, campaign-scoped).
4. Regenerate `convex/_generated` (new module `combatSpotlight`, new table).
5. After H1.1 / H1.2 merge: wire the tags and menus (see "For the parallel wave-2 tracers").
