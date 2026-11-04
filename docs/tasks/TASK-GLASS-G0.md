# TASK-GLASS-G0: brandButton draws the glass button, the viewer is set once per campaign

Plan `.omc/plans/glass-buttons.yaml`, tracer G0; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.1.
Design `reference/designs/buttons/arcane-glass.html`. Built on the briefs' default answers (Q1-Q9 = a).

## What changed

| File | Change |
|---|---|
| `src/components/brand/buttons.tsx` | `brandButton` / `BrandButton` keep their signature (`variant`, `size`, `className`; `brandButton` also takes `class`) and return glass classes from `glassButtonClass`. New role variants and `icon` / `round` options. cva removed. |
| `src/components/brand/glass-button.ts` | New `wrap` option (`gb-wrap`). Nothing else changes, so `hudButtonClass` is untouched. |
| `src/components/brand/glass-button.css` | Cascade note in the header; `.gb.gb-wrap` (brand-only: min-height instead of a fixed height, labels wrap); touch rule `:where(.gb.gb-sm) { min-height: 44px }` at `max-width: 1100px, pointer: coarse`. No `.gb` rule the HUD uses changed. |
| `src/components/brand/viewer.tsx` (new) | `Viewer`, `viewerFor(role)`, `ViewerProvider`, `useViewer()`, `ViewerScope` (gives portalled content the campaign's `data-viewer`; `display: contents`). |
| `src/components/brand/modal.tsx` | The close ✕ is `<BrandButton variant="cancel" icon round>`. The dialog inherits the shell's `data-viewer` (native `<dialog>` stays in the DOM). |
| `src/app/(gm)/campaigns/[campaignId]/campaign-shell.tsx` | The shell's root `<div>` carries `data-viewer={viewerFor(campaign.role)}`, wrapped in `<ViewerProvider>`. Nothing else in the shell is restyled (G2's job). |
| `tests/unit/brand/buttons.test.tsx` (new) | The whole variant / size table, explicit roles, icon / round / wrap, call-site classes, the viewer helpers, Modal's ✕. |
| `tests/unit/hud/glass-button.test.ts` | `wrap` case; the HUD never gets `gb-wrap`. |
| `tests/e2e/glass-foundation.spec.ts` (new) | Viewer colours (probe + the real Players dialog), outside a campaign, hover + focus axe, reduced motion, touch 44 px, wrapping, layout utilities. |
| `tests/e2e/visual/GLASS-G0.spec.ts` (new) | Shots and the HUD before / after fingerprint. |

## Variant -> role map (brandButton)

| `variant` | Glass role | Notes |
|---|---|---|
| (none) / `outline` | neutral | |
| `pill` | neutral | Q8 (a): the glass shape, no round ends |
| `solid` | confirm | |
| `primary` | confirm, **large** | Q4 (a): large glass. Large unless the call site passes `size="sm"` (`end-scene.tsx`, which G2 / G11 turn into danger). |
| `danger`, `dangerSolid` | danger | |
| `confirm`, `cancel`, `neutral`, `tool`, `danger`, `allow`, `deny`, `normal`, `advantage`, `disadvantage` | the same role | new; use these in the area tracers |

| `size` | Glass size |
|---|---|
| `sm` | `gb-sm`: 34 px, 44 px under `max-width: 1100px` or `pointer: coarse` |
| `md` (default) | 44 px |
| `lg`, `xl` | `gb-lg`: 54 px |

Options: `icon` (44 × 44, no wrapping; give it an `aria-label`), `round` (with `icon`: the design's Close ✕).
Every labelled brandButton gets `gb-wrap`: the size is a minimum height and a long label wraps instead of clipping.
The legacy names stay as aliases until GZ.

## Cascade decision: glass-button.css stays unlayered

- `.gb` is unlayered, so it beats every Tailwind utility (utilities live in `@layer utilities`).
- On a glass button these call-site utilities have **no effect**; area tracers delete them:
  - colour, background, border, shadow;
  - radius (`rounded-*`), height (`h-*`, `min-h-*`), padding (`px-*`, `py-*`);
  - font size / weight / family (`text-[15px]`, `font-display`), `gap-*`;
  - `display` (`hidden`, `flex`, `sm:inline-flex`) and `position` (`absolute`), because `.gb` sets `display: inline-flex`
    and `position: relative`.
    To hide a glass button responsively, wrap it or use the `hidden` attribute.
- These still apply, because `.gb` does not set them: width (`w-full`, `max-w-*`), margins (`ml-auto`), self alignment
  (`self-start`), flex item sizing (`flex-1`, `flex-none`), `order-*`, grid placement.
- **Why not `@layer components`:** the HUD's own CSS is unlayered and tuned against `.gb`'s specificity (for example
  `spotlight.css` `.hud-spp-tabs button.hud-btn { height: 36px }`, `areas.css` `.hud-areas .hud-btn`). Layering `.gb`
  would make every unlayered rule beat it regardless of specificity, which changes the HUD. It would also let stale
  call-site utilities leak onto the glass.
- Per-area unlayered CSS classes that are stacked on a glass button (`jh-start`, `jl-add-btn`, `jt-reset`, `jr-play`,
  `js-plan`, `jrth-open`, `cm-btn`) fight `.gb` by specificity and source order. Drop the colour / shape parts of them,
  or the whole class.

## How `data-viewer` is set

- `campaign-shell.tsx`: root `<div data-viewer="gm" | "player">` (`viewerFor(campaign.role)`: `gm` for the GM, `player`
  for everyone else; Q1 a).
  - Every page and every native `<dialog>` (`Modal`, the Tome book) inside a campaign inherits it from the DOM.
  - The Combat HUD's root keeps its own `data-viewer`, which has the same value, so nothing changes there.
- `ViewerProvider` carries the same value in React context.
  - Content portalled to `<body>` wraps itself in `<ViewerScope>` to get the attribute back.
  - Only the notes bin toast needs it today (`src/components/notes/bin/index.tsx`, G13's).
  - The card dialog is the card face, so it is out of scope.
- Outside a campaign (sign-in, main menu, new campaign, frames, join, settings) there is no attribute. The CSS default is
  the player's colours (Q2 a).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean, with no call-site edit. The 78 existing uses compile unchanged.
- vitest:
  - `tests/unit/brand`, `tests/unit/hud/glass-button.test.ts`: 21 tests pass.
  - The full suite (`--maxWorkers=1 --testTimeout=120000`): 519 files, 11046 passed, 1 expected fail.
- e2e, servers started by hand on ports 3841 / 3941 with `E2E_REUSE_SERVERS=1` and `--workers=1`:
  - `glass-foundation`: 4 passed.
  - `visual/GLASS-G0`: 3 passed.
  - `hud-shell`, `hud-tablet`, `hud-phone`, `hud-result`, `hud-answers`, `hud-dock`, `a11y-smoke`, `a11y-entry`,
    `a11y-signin`: 43 passed.

## HUD unchanged: before / after

`visual/GLASS-G0.spec.ts` "the Combat HUD is unchanged" was run twice:

- with `GLASS_G0_LABEL=before` on a build of `rebuild`'s versions of the five source files;
- on this branch.

Results:

- `hud-fingerprint-before.json` and `hud-fingerprint-after.json` are byte-identical. The fingerprint holds every visible
  HUD `.gb` button's class, size, colour, box-shadow, background, radius, font, padding, min-height and white-space,
  for the GM at 1440 / 1024 and the player at 1440 / 1024 / 390.
- The HUD screenshots `hud-before-*.png` vs `hud-after-*.png`: 0 pixels differ in all 5 pairs.

## Shots

In `/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g0/` (and `test-results/visual/GLASS-G0/`):

- `signin-{1440,1024,390}`, `menu-{…}`, `menu-strip-{…}`: outside a campaign, in the player's colours.
- `dashboard-{gm,player}-{1440,1024,390}`: the dashboards. Their hand-styled buttons are still the old look; they are
  the area tracers'.
- `strip-{gm,player}-{…}`: one button of every role in each viewer's colours.
  - GM: confirm purple, cancel gold.
  - Player: the other way round.
  - Danger is ember for both; the switched-on chip is gold; disabled is grey.
- `strip-{gm,player}-hover-confirm`, `strip-{gm,player}-focus-cancel`: a hovered confirm and a keyboard-focused button.
- `players-dialog-gm-{…}`, `players-dialog-gm-hover-invite`, `players-dialog-gm-focus-close`: a real Modal.
  - Invite (solid) is a Fear confirm for the GM; Remove is danger; Copy link / New code are neutral.
  - The ✕ is a round Hope cancel.
- `hud-before-*`, `hud-after-*`: the HUD, identical.

## Notes for the area tracers (G1-G13)

- Use `<BrandButton variant="confirm|cancel|danger|neutral|tool|allow|deny|…">`, or `brandButton({ … })` for links.
  Use `glassButtonClass` only for a raw class string; pass `wrap: true` for a labelled button so it matches brandButton.
- Delete colour / shape / size utilities on glass buttons (see the cascade section): they silently do nothing. Keep
  layout utilities.
- Do not stack your old area class (`cm-btn`, `jh-start`, …) on a glass button unless it only does layout.
- Switches and chips: `variant="neutral"` with `aria-pressed`; the switched-on one glows gold. Page tabs
  (`role="tab"`) stay as they are.
- Steppers and the row ✕: `variant="neutral" size="sm" icon` (44 px on touch by itself).
- Close ✕ of a panel: `variant="cancel" icon round`.
- `primary` is large. A headline confirm that should stay medium passes `variant="confirm"`.
- Two confirms side by side: only the main one is confirm, the other neutral.
- Portalled UI (`createPortal(…, document.body)`): wrap it in `<ViewerScope>` from `@/components/brand/viewer`.
  G13 does this for the notes bin toast.
- The shell's hero pills and the Start-session dialog (`campaign-shell.tsx`) are still hand-styled; G2 owns them.
- Paper surfaces (Notes page, recap paper, Tome book) keep ink-on-paper buttons (Q5 a). Do not put brandButton there
  without a paper variant.
- The hover fill swaps the text colour. Run axe with one button hovered (see `glass-foundation.spec.ts`).
