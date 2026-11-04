# TASK-GLASS-GZ: clean-up of the Arcane Glass buttons roll-out

Plan `.omc/plans/glass-buttons.yaml`, tracer GZ (bead dcm-q861.17). Built on every area tracer merged on `rebuild`
(G0-G13; G14 / G15 skipped, Q3 = a), rebased on Config S1 / S2 / P2.

## What changed

| File | Change |
|---|---|
| `src/components/brand/buttons.tsx` | `BrandVariant` is `GlassRole` only: the legacy names `primary`, `solid`, `outline`, `pill`, `dangerSolid` and the size `xl` are gone, with `brandRole`, `LEGACY_ROLE` and the "primary is large" rule. `BrandSize` is `GlassSize`. No variant = neutral, no size = md. |
| `src/components/party/death/badges.tsx` (out of owns) | the last two callers of `variant="pill"` → `variant="neutral"` (same classes as before). |
| `src/components/ui/button.tsx` | deleted (shadcn; nothing imported it, the e2e sign-in form already used BrandButton). |
| `src/components/brand/glass-button.css` | the switched-on rule also takes the checked radio of a glass radio group: `.gb[aria-checked="true"]:where([role="radio"])` next to `.gb[aria-pressed="true"]` (`:where` keeps the toggles' specificity). |
| `src/app/(gm)/campaigns/[campaignId]/combat-map/combat-map.css` | `.cm-btn` (+ hover, focus, disabled, `aria-pressed`, `.cm-sm`, touch), `.cm-btn.cm-danger`, `.cm-go` (+ disabled), `.cm-chip` (+ hover, focus, touch) deleted. The HUD dock's Player view keeps the `.cm-btn` look under `.cm-pv-btn:where(:not(.gb))` / `.cm-pv-item:where(:not(.gb))` (same declarations, same specificity, same place in the file). Header comment updated. |
| `src/components/combat-map/vision/header.tsx` (out of owns) | the non-glass Player view and its items drop the `cm-btn` class (`"cm-pv-btn"`, `"cm-pv-item"`). |
| `tests/unit/brand/buttons.test.tsx` | roles only; a `@ts-expect-error` check that the legacy names are gone. |
| `tests/unit/brand/button-guard.test.ts` | new: the guard (below). |
| `tests/e2e/visual/GLASS-GZ.spec.ts` | new: area shots and the HUD before / after fingerprint. |
| `.omc/plans/glass-buttons-briefs.md` (out of owns) | `pnpm tracer:guard .omc/plans/glass-buttons.yaml <ID>` (the script takes the plan path). |
| `tests/e2e/visual/GLASS-G0.spec.ts` (out of owns) | the Players dialog comment and the hover shot no longer call Invite a confirm (G2 made it neutral): `players-dialog-gm-hover-invite-neutral`; the strip's label "Start Session (confirm, lg)". |
| `tests/e2e/visual/GLASS-G1.spec.ts` (out of owns) | Config S1: the gear opens the Campaign settings dialog, so the app-bar test checks that dialog and its round cancel ✕ (`app-bar-gm-campaign-settings`) instead of the old popover's Players button. |
| `tests/e2e/visual/{C3,C5,C6,C8,MV-M1,SP-P6,SP-P9,SP-P10}.spec.ts` (out of owns, bead dcm-9tz0) | broken since the HUD cut-over; fixed with `openMapTools`, the "Your character" drawer and the HUD token names (details below). |

## Old names and classes

- **Variants:** `grep` finds no `variant="primary|solid|outline|pill|dangerSolid"` on BrandButton / brandButton. The
  sheet's own `Pill variant="solid"` (`party/sheet-ui`) is a different component and stays (Q3 = a).
- **Removed CSS:** `.cm-btn`, `.cm-btn.cm-sm`, `.cm-btn.cm-danger`, `.cm-btn[aria-pressed]`, `.cm-go`, `.cm-chip`.
- **Inventory classes still in CSS, and why:**
  - `trk-btn`, `trk-btn-parch`, `trk-btn-sm`, `trk-btn-attack` (`tracker.css`, `hud/statblock/statblock.css`,
    `hud/responsive/tablet.css`): the HUD stat block renders the tracker's components with `glass` off. Removing them
    changes the HUD.
  - `cm-pv-btn` (`hud/dock/dock.css`, `combat-map.css`): the HUD dock's Player view.
  - `dk-btn`, `dkc-btn`, `xs-btn`, `hf-ghost`: the character sheet (Q3 = a).
  - `bj-ghost`, `bj-paper-btn`, `jrr-btn`: buttons on paper (Q5 = a).
  - `trk-act` (a section), `env-acts` / `env-act-note`, `bj-act` / `bj-actions` (containers, not buttons).
  - All other inventory classes (`cm-linkbtn`, `adx-*`, `enc-*`, `env-act`, `cx-ghost`, `zbtn`, `lk-act`, `lk-send`,
    `bj-danger` buttons, `jr-ghost`, `jp-` / `js-danger`, `jl-add-btn`, `wz-ghost`, `wz-primary`, `ih-btn`,
    `ab-pop-btn`, `trk-spot-btn`) are gone from the markup and the CSS.

## The guard

`tests/unit/brand/button-guard.test.ts` scans every string in `src/**/*.{ts,tsx}` (comments stripped) and fails on:

- a class with a `btn` / `ghost` part after a prefix (`cm-btn`, `trk-btn-sm`, `cx-ghost`), or another inventory class
  (`cm-go`, `zbtn`, `adx-primary`, `env-act`, …);
- the Tailwind ghost button: `border` + `bg-transparent` + `hover:bg-white/5` in one string.

A class on a glass button (a string beside `gb`, a template calling brandButton / glassButtonClass, a prop of
`<BrandButton`) is a layout modifier and passes (`cfg-acct-btn`). The allowed places, each with its reason, are the
HUD (`combat-map/hud/`), the HUD's Player view (`vision/header.tsx`) and stat block (`tracker/actions/{choices,
feature-use,result}.tsx`), the sheet (`party/[characterId]/`, `party/{dice,extras,features}/`), the wizard's card
faces (`party/new/steps-5-9.tsx`), the paper (`notes/`, `journal/recap`) and two in-place title edits
(`journal/log`, `journal/session-head`). A second test fails when an allowed entry no longer has a hand-styled button,
so the list only shrinks; a third checks the shadcn Button is gone.

## Radios

G4's radios (Five Banners objective size / steps, Colossus phase) now get the full switched-on glass look (gold glass
tint and rim) from the new rule; their `tone: "hope"` stays and agrees with it. G3's radio grids (countdown start
value, chase die) are still hand-styled (G3 left them because glass had no checked state); they are not touched here
(see questions). The HUD has no glass radio (`hud-opt` is its own class), and the fingerprint below is unchanged.

## The Combat HUD is unchanged

`visual/GLASS-GZ.spec.ts` "the Combat HUD is unchanged" fingerprints every visible `.gb`, `.cm-pv-btn`, `.cm-pv-item`
and `.trk-btn` in the HUD (size, colour, background, border, radius, font, padding, min sizes, gap, cursor, opacity,
justify, white-space, box-sizing): GM at 1440 / 1024, player at 1440 / 1024 / 390, the GM's Player view hovered and
open (its menu items), a stat block open (its `trk-btn` Use buttons) and the tools drawer.

- Run with `GLASS_GZ_LABEL=before` on a build without the CSS changes, and on this branch: the two JSON files are
  byte-identical.
- Screenshots: 0 pixels differ in 7 of 8 pairs; the player at 390 has 12 differing pixels, which a second run of the
  "before" build shows too (run-to-run noise of the map's light, not a button).

## Visual specs fixed (dcm-9tz0)

- C3: `openMapTools` before the maps list.
- C5: `openMapTools`; scrolls the stage into view before clicking the crate.
- C6: GM selects tokens with focus + Enter after `openMapTools` (HUD names `Open Liriel’s sheet`, `Open the Bear’s stat
  block`), closes the stat block before the shots; the player opens "Your character" for the Selected token card.
- C8: "Your view" card and the light pill checks inside the "Your character" drawer; the dock's "Fit the map to the
  screen"; the GM's Bandit selected after `openMapTools`.
- MV-M1: HUD token names; the movement-roll note in the "Your character" drawer; the blocked notice text is now
  "Something blocks the way.".
- SP-P6: picks the map in the drawer, closes it for the shot. SP-P9: `openMapTools` before Edit. SP-P10: the Torch
  from the "Your character" drawer.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest (`--maxWorkers=1 --testTimeout=120000`): 529 files, 11155 passed, 1 expected fail, 1 todo.
- `pnpm build`: passes.
- Full e2e with `E2E_VISUAL=1` (servers started by hand on 3921 / 4021, `E2E_REUSE_SERVERS=1`, `--workers=2`, the
  machine loaded by other sessions): 543 passed, 28 failed, 1 skipped, 2 did not run (55 min). Most failures were
  sign-in timeouts under load. `--last-failed --workers=1`: 22 passed, 6 still fail, none in GZ's area:
  - `campaign-preload.spec.ts:110`: "dashboard never two copies of the page", 14 sections where it allows 13.
  - `hud-make-room.spec.ts:32`: `area-pick-result` never appears.
  - `visual/GLASS-G4.spec.ts` weredragon: axe `listitem` (`.border-[#8f6a2b] > li` outside a list).
  - `visual/HUD-H1.3.spec.ts`: strict-mode violation, two elements with the same `data-token`.
  - `visual/S13.spec.ts` GM: "Label as Pronouns" is 69 × 18 at 390. Player: the sheet has 47 buttons where the spec
    expects 45.

  GZ changes only class strings and CSS no longer used outside the HUD dock's Player view. The HUD fingerprint is
  identical. None of these specs touch a removed class or a glass radio.
- The 8 visual specs from dcm-9tz0 and `GLASS-G0` / `GLASS-G1` / `GLASS-GZ` pass.
- After these runs `rebuild` gained Config P1, G1, R2, G2, U1 and U3. The branch is rebased on them; lint, typecheck
  and the brand tests (the guard included) pass again. The e2e suite was not rerun on that tip.

## Shots

`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-gz/`:

- `<area>-{gm,player}-1440` for dashboard, party, countdowns (GM), codex, world, lorekeeper, adversaries, journal and
  notes; `dashboard-{gm,player}-{1024,390}`;
- `hud-before-*` / `hud-after-*`: the HUD (GM, player, Player view open, stat block, tools drawer).
