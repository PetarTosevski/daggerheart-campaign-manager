# TASK-HUD-H9.1: spotlight disc, GM popover and light pools

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, tracer H9.1, batch B (boards CmpTokens, GMDesktop,
GMTablet, Main, PlayerTablet, PlayerPhone, CmpTokensDesign). Delta `.omc/plans/combat-hud-v2-delta.md`; user answers
2026-11-04 bind: **Q7 (a)**, **Q8 (a)**, **Q11 (b)** (keep the banner's " · Spotlight" tag; drop only the Fear banner's
SPOTLIGHT pill). Mode: replace. No server change, no codegen (H9.S's `handToParty` / `gmTake({ pay })` are used as is).

## What landed

- **The disc** (`hud/spotlight/disc.tsx` `SpotlightDisc`, CmpTokens 'Spotlight' / `.spd`): hangs from a cord left of
  the day disc, mounted by `HudFear` in the fear box (its own `PartBoundary`): right 300 / top 0 on the page (tablet
  right 208, cord 16, disc 54, beam 90 × 84). Faces: the whole party = 2 × 2 mini portraits; a PC = the portrait
  (`Portrait`, next/image); an adversary = its initial on red with the purple ring, cord, beam and lilac name; the GM
  generally (or an adversary a player may not learn) = a flame on red, "The GM". Label "SPOTLIGHT" + the holder's name.
  Faces are stacked and cross-fade (200 ms opacity); none under prefers-reduced-motion. With a sheet open the disc moves
  left with the Fear banner (desktop: the fear box's transform) and hides at tablet width.
- **GM**: a real `<button>` "Spotlight: <name>. Change who has it" with `aria-expanded`; it opens `panels.ts`
  "spotlight" (one GM panel at a time). The popover (`role="dialog"` "Spotlight", `.spp`: right 200 / top 150, 360 px;
  tablet right 120 / top 120, 330 px) opens on the holder's tab with the focus on that tab; Left / Right / Home / End
  move between the tabs; Escape and Close close it and the focus returns to the disc.
  - **Party**: "The whole party — No one chosen · players decide who acts" first (Q8 a), then each PC from
    `combatHud.party`: "Druid · Hope 1 · HP 2 of 6 marked". "Give", or "Has it" on the holder (`aria-pressed`).
  - **Adversaries**: "How you take it" **Free** ("A player failed or rolled with Fear", default) / **1 Fear** ("Interrupt
    the players"; `aria-disabled` with "This needs 1 Fear. You have 0." at 0 Fear), then each adversary token on the
    map (`combatTokensReads.list`): "Leader · HP 2 of 6 marked", "Take" / "Has it" (purple).
  - A row moves the spotlight and closes: `handToParty`, `handTo({ characterId })`, `gmTake({ tokenId, pay })`, each
    with an optimistic update (`afterHandToParty`, `afterHandTo`, `afterTake`; a paid take also drops Fear by 1 in
    `combatHud.scene` and `campaigns.fear`). The holder's own row only closes. Q7 (a) and the board's script: "1 Fear"
    is sent only when the spotlight moves from the party or a PC to an adversary (`takePay`); while the GM already
    holds it, moving between adversaries is free (the server's per-GM-turn spotlight count stays the rule for their
    actions). A refusal shows under the disc in the refusal table's words (`refusalFor`, NOT_ENOUGH_FEAR).
  - Footer: "Playing around one screen? Set it to whoever acts and the table sees the light move on the map."
- **Players**: the same disc, view only (`div role="img"` "Spotlight: <name>"). Which adversary a player sees named is
  the server's rule as it is today (`combatSpotlight.state`: only one the party saw this scene; bead dcm-onze will
  change "seen" to party knowledge server-side; nothing here needs to change for it). The "The GM has the spotlight"
  card and the reactions note stay.
- **Phone** (`PhoneSpotlight`, in `hud/phone/strip.tsx`; PlayerPhone `.mspot`, `.mb.lit`): a 44 px disc under the party
  strip (right 10) with the "Spotlight · Moss" pill, gold or purple, and the PC holder's mini banner lit (gold inset +
  a cone of light, `data-lit`).
- **Light pools** (`hud/spotlight/light.tsx` / `light.css`): gold under a PC holder's token, **purple** under an
  adversary's (`#c9bdf2` family, CmpTokensDesign "GM spotlight light"), and for the whole party every PC in a smaller,
  dimmer gold pool (opacity .75, no beam). `mix-blend-mode: screen` as the board's `.pool`. Every token in a layer has a
  pool element and only the lit ones show (`data-on`, `data-pool`), so the light fades out under the old holder and in
  under the new one over 300 ms; none (and no breathing) under prefers-reduced-motion. Only lit pools carry
  `data-testid="hud-spotlight-light"`. `tokens-layer.tsx` and `vision-layer.tsx` needed no change: they already pass
  their drawn tokens and `isLit` stays the face glow (a single holder only). Players get pools only on tokens their
  map draws.
- **Removed**: `SpotlightMenu` (the GM spotlight panel), `FearSpotlightTag` and `fear/spotlight-slot.tsx` (the Fear
  banner's SPOTLIGHT pill), the GM branch of `HudSpotlight` (it renders nothing for the GM), and the panel's CSS.
  `useSpotlightInColumn` (hud/phone/media.ts, not owned) is no longer used by anything.
- **Kept**: `SpotlightBannerTag` (" · Spotlight" on the holder's banner, Q11 b), `SpotlightHandBack`, the player's
  GM's-turn card.
- **Banners**: on the GM view no banner gets the "you" trim, whatever `mine` says (`HudBanners` maps it off for
  `role === "gm"`).

## Specs and tests (owns)

- `tests/unit/hud/spotlight-disc.test.tsx` (new): player disc names, GM popover (tabs, rows, Has it, Give / Take,
  whole party, focus, Escape / Close back to the disc, arrow keys), 1 Fear paid from a PC / free between adversaries /
  disabled at 0, phone disc, pools (PC / adversary / party, fade elements), model helpers.
- `tests/unit/hud/spotlight.test.tsx` (added to owns by the orchestrator): the Fear-pill and GM-menu cases are gone;
  `litOf(nobody)` is now the whole party; the GM gets nothing from `HudSpotlight`.
- `tests/unit/hud/banners.test.tsx`: the GM view never shows the "you" trim.
- `tests/e2e/hud-spotlight.spec.ts` (rewritten; the old `.hud-map .cm-toolbar` / spotlight panel checks at 75-80 are
  gone): the GM's disc and popover keyboard-first (Enter, Escape, focus back), give to Moss, take the Lieutenant with 1
  Fear (Fear 3 → 2 once), reopen on Adversaries, back to the whole party; the player's disc, banner tag and GM's-turn
  card live; placement at 1440 and 1024 (right 300 / 208, clear of the dock, popover on screen, 44 px tabs at tablet),
  the phone disc and lit mini banner at 390; axe on each.
- `tests/e2e/hud-spotlight-light.spec.ts`: nobody chosen now lights every PC (`data-pool="party"`); the Lieutenant's
  pool is purple (`data-pool="gm"`) for the GM and the player.
- `tests/e2e/hud-blocked-gm.spec.ts`: comment only (the GM spotlight panel is gone).
- `tests/e2e/visual/HUD-H9.1.spec.ts`: board renders (E2E_VISUAL=1).

## Not done here (other owners)

- The phone's off-screen edge chip moving from top 150 to 226 to clear the disc (`hud/phone/edges.tsx`, H9.6).
- `useSpotlightInColumn` in `hud/phone/media.ts` can be deleted by its owner (H9.6).

## Buttons (rebuild 6d1d2929, arcane glass)

Every popover button goes through `hudButtonClass`: Close `cancel`, the tabs `tool`, Free and the Party rows neutral,
1 Fear and the Adversaries' Take rows `primary` (confirm). `fear/confirm.tsx` Cancel is `cancel`; `fear/fear.css`
drops `.hud-fc .hud-fc-yes`'s solid fill and the forced 38 px button height. The disc itself is the hanging object
from the board, not a glass button.

## Interim until H9.3 merges

The GM's title row still has Areas, Fog, Dice, Player view and End scene. At 1440 its right end (End scene) runs under
the disc, and axe flags `target-size` on `.hud-tr > .hud-end`. So `hud-spotlight`, `hud-spotlight-light`,
`hud-banners` and `hud-blocked-gm` fail their GM axe checks until H9.3 removes those buttons; the player's title row
("Your character") also sits close to the disc's label. Verified with those GM title-row tools hidden locally (a
temporary rule, not committed): all 8 tests pass.

## Checks

- `pnpm typecheck`, eslint on every changed file: clean.
- vitest `tests/unit/hud`: 35 files, 463 tests pass.
- e2e (`E2E_PORT=3705 E2E_CONVEX_PORT=3805`, `--workers=1`, servers started by hand, `E2E_REUSE_SERVERS=1`):
  hud-spotlight (2), hud-spotlight-light (3), hud-banners, hud-blocked-gm: 8 passed. This needed the GM title row hidden
  as above; without that, the GM axe checks fail on the H9.3 overlap.
- Shots: `test-results/visual/HUD-H9.1/` (gm-popover-party-1440 / -1024, gm-popover-adversaries-1440,
  gm-disc-adversary-1440, player-disc-moss-1440, player-disc-adversary-1440, player-phone-390) and
  `test-results/visual/HUD-SPOTLIGHT-LIGHT/` (gm-party-lit-1440, gm-pc-lit-1440, player-adversary-lit-1440, …).
