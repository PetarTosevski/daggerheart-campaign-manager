# TASK-HUD-SPOTLIGHT-LIGHT: the token in the spotlight stands in a stage light

Status: Review. Bead dcm-bxp.99.32.35 (not a plan tracer). User request (2026-11-02, verbatim): "When the spotlight is
on a token have that token illuminated as if a spotlight was shining on it (both players & adverseries)". Builds on
H1.S (spotlight state), H1.3 (HUD tokens), H5.2 (the stat block's Spotlight) and H7.1–H7.3 (tablet, phone).

## What lights

- **A PC holds the spotlight** (`holder.kind === "pc"`): that PC's token, for the GM and every player.
- **The GM spotlighted an adversary** (`gmTake({ tokenId })`, reason `adversary`): that adversary's token.
- **Nothing** when there is no row (the players, nobody in particular), or the GM holds it generally (`gmTook`, a roll
  with Fear or a failure).
- **Players never see a hidden one lit.** `state` sends players the opaque `adversaryTokenId` (no position). Each
  layer lights only a token it already draws: the player's `others` come from `combatVision.playerView`, which leaves
  out fogged and hidden tokens, so a token they can't see gets no light, no token and no DOM id. The reason line
  already says "An adversary is acting."

## What landed

- **Schema (widen, rule 7)** `convex/tables/combatSpotlight.ts`: `adversaryTokenId: v.optional(v.id("combatTokens"))`.
  Older rows have none and read as nothing lit. No migration: optional, and absent is the right value for every older
  row.
- **Helpers** `convex/lib/spotlight.ts`:
  - `spotlightAdversary(ctx, campaign, tokenId)`: `loadCombatToken` (COMBAT_TOKEN_NOT_FOUND for another campaign's
    or a made-up id), INVALID for a non-adversary token. It moves the spotlight to the GM with reason `adversary` and
    names the token.
  - `setHolder` writes a different adversary while the GM already holds it (patch: `reason` `adversary`, `rollBy`
    cleared, `since` kept). The same adversary again, or a general move while the GM holds it, writes nothing (CD10).
  - Any move to a new holder (PC → GM through `moveToGm`, any hand-back through `giveTo`) replaces the row without the
    field, which clears it.
- **Functions** `convex/combatSpotlight.ts`:
  - `gmTake` args `{ tokenId: v.optional(v.string()) }`. With it, `spotlightAdversary`; without it, `moveToGm`
    "gmTook" as before. Keyed: a replay under the same key with another token is IDEMPOTENCY_MISMATCH.
  - `state` returns `adversaryTokenId: Id<"combatTokens"> | null` (`returns` validator updated), non-null only while
    the GM holds it.
- **Client**:
  - `hud/spotlight/model.ts`: `afterTake(state, now, tokenId?)` mirrors the server (optimistic), `afterHandTo` clears
    the token, and the pure helpers `litOf(state)` and `isLit(lit, token)` (match by token id, or by a PC token's
    `characterId`).
  - `hud/spotlight/index.tsx`: `useSpotlightMoves().take(tokenId?)`. The menu's "Take the spotlight" calls
    `take()` (it no longer passes the click event).
  - `hud/statblock/panel.tsx`: Spotlight passes the adversary's token. `acts.tsx` / `attack.tsx`: a resolved attack or
    feature passes the acting adversary's token too (`ActMeta.tokenId`), since an adversary's action spotlights it
    (CB p.194).
  - `hud/spotlight/light.tsx` (+ `light.css`): `useSpotlightLit(campaignId, on)` reads `combatSpotlight.state` only
    inside the HUD (the subscription the spotlight parts share). `SpotlightPools` draws `.hud-spot-light` under each
    lit token of a layer.
  - `hud/token/face.tsx` / `token.css`: `TokenFace lit` adds `.tk-lit` and `data-lit="true"` (the glow).
  - `tokens/tokens-layer.tsx` (the GM's tokens, a player's PCs) and `vision/vision-layer.tsx` (a player's `others`):
    each draws `SpotlightPools` first inside `.cm-tokens-map` and passes `lit` to `TokenFace`. Two lines each, HUD face
    only. With the switch off the classic layers are unchanged.

## How it looks

Pure CSS radial gradients in the HUD's warm gold (`--hud-gold` / `--hud-gold-text`, the Hope colour; fallbacks for a
layer outside `.hud-root`):

- **Pool** (`.hud-spot-pool`): a circle 3.4 × the token's footprint, centred on it. Near-white warm gold in the middle,
  fading through gold to transparent about 1.2 footprints beyond the token's edge.
- **Beam** (`.hud-spot-beam`): a faint trapezoid from above (narrow at the top, as wide as the bright core at the
  token), fading upwards.
- **Glow** (`.tk-lit`): a warm halo behind the face, under the arcs, badges and face. The face is a touch brighter
  (`brightness(1.14)`).
- **Motion**: a 420 ms fade-in, then a slow 3.6 s breathing of the pool and beam (opacity 0.86 ↔ 1). Under
  `prefers-reduced-motion: reduce` there is no animation: a static light.
- **Layering**: `z-index: 1` inside the token layer, drawn before the tokens (which are z 10+), so every token, ring,
  arc, badge, the action ring and the name tags paint over it. `pointer-events: none`. The rest of the map is not
  dimmed. It lives in the layer that is scaled by zoom and moved by H2.2's make-room transform, so it follows the token
  at every size and with a sheet open.
- **Known limit**: a player's adversary pool is drawn in the `others` layer, which sits above the PC layer. Where the
  pool's faint outer edge reaches an adjacent PC token, it tints that token slightly.

## Tests

- `tests/convex/hud-spotlight.test.ts` (+6): an adversary is named for every member; the same one again writes
  nothing; another keeps `since`; a general take keeps it; a hand-back and a roll's move from a PC clear it; taking it
  from the start; PC token INVALID; another campaign's or a made-up token COMBAT_TOKEN_NOT_FOUND with no write; a keyed
  replay with another token is IDEMPOTENCY_MISMATCH; an older row without the field reads null. The existing "none"
  shape includes `adversaryTokenId: null`.
- `tests/unit/hud/spotlight.test.tsx` (+4): `afterTake` with a token, `litOf` / `isLit`, `SpotlightPools` placement
  and aria-hidden, nothing drawn for a layer without the token, `useSpotlightLit` skips outside the HUD.
- `tests/unit/hud/statblock-panel.test.tsx`: Spotlight and a resolved attack send `gmTake` with the token.
- `tests/e2e/hud-spotlight-light.spec.ts` (2): see Checks.
- Authz: `gmTake`'s new argument is optional, so `tests/convex/authz/spotlight.entries.ts` is unchanged (GM ok, others
  FORBIDDEN).

Shots: `test-results/visual/HUD-SPOTLIGHT-LIGHT/` (`gm-pc-lit-1440`, `player-pc-lit-1440`,
`gm-adversary-lit-sheet-open-1440`, `player-adversary-lit-1440`, `player-hidden-adversary-not-revealed-1440`,
`gm-pc-lit-sheet-open-1440`, `{gm,player}-pc-lit-{1024,390}`, `player-adversary-lit-390`).

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest, full suite (`--maxWorkers=2 --testTimeout=120000`): 477 / 477 files, 10597 passed + 1 expected fail.
- `tests/e2e/hud-spotlight-light.spec.ts`: 2 / 2. (1) Nobody lit; Moss lit for the GM and the player, pool centred
  on the token, z 1, `pointer-events: none`, clicks reach the token; the GM's stat-block Spotlight lights the
  Lieutenant for both, not Moss; the hidden Bandit is lit for the GM, while the player gets no light, no token and no
  `data-token`; a hand-back to Brannoc moves the light; a general take lights nothing; axe on the GM and the player.
  (2) Pool on the token with the GM's sheet open (make-room), at 1024 and 390 for both; the adversary at 390; the
  breathing animation by default, `none` under reduced motion.
- All `hud-*.spec.ts` on a host with load around 20, rerunning failures with `E2E_REUSE_SERVERS=1`: every spec passed
  except `hud-hit.spec.ts:80` and `hud-queue.spec.ts:65`. Both failed only on Convex "Function execution timed out
  (maximum duration: 1s)" errors (the HUD parts' "failed to load" boundaries), not on an assertion this change
  touches. Rerun them on a quiet machine.

## Merge-time actions

- `npx convex codegen` (the usual; `convex/_generated` is not committed). The table edit is in
  `convex/tables/combatSpotlight.ts`, already composed into `convex/schema.ts`.
- No migration: the field is optional and absent on older rows by design.
