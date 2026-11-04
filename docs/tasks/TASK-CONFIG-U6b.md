# TASK-CONFIG-U6b: Reduce motion and text size applied app-wide

Plan `.omc/plans/config.yaml`, wave 3, tracer U6b; briefs `.omc/plans/config-briefs.md` (U6b block, "User answers
2026-11-04" Q12 a and Q13 a, "Questions 2026-11-05": defaults taken, none touch U6b); bead dcm-jh6d.21. Reads
P1's `preferences.get` (TASK-CONFIG-P1.md). Mode: add. Client only; no server change, no codegen.

## What landed

- **`PrefsSync`** (`src/app/(gm)/prefs-sync.tsx`, mounted next to `AccentSync` in the (gm) layout) sets two
  attributes on `<html>` from `preferences.get`:
  - `data-reduce-motion` (present when the account's Reduce motion is on);
  - `data-text-size="small" | "medium" | "large"`.
  - No React state: a layout effect writes the DOM attributes (rule CL7). States: signed in and loaded = the account's
    values, also cached in `localStorage["dcm:display-prefs"]`; loading = the cached values; signed out (query
    skipped via `useConvexAuth`) = neither attribute, cache cleared; unmounted = neither attribute.
  - It follows the account live: a change on another device reaches every open page (the e2e test checks it).
- **No flash, no hydration mismatch.** The (gm) layout renders an inline script before the page. It runs while the
  server HTML is parsed and applies the cached values, so a hard load paints at the saved size. The e2e test checks
  that the first `data-text-size` write happens while `readyState` is still `loading`, and that the console shows no
  hydration error.
  - The script sits in a hidden `<span>`'s HTML, not a React `<script>`. React never creates a script element on the
    client then, so a client navigation into the app logs no "script tag" warning. On that navigation the script
    doesn't run, and PrefsSync applies the same values.
  - The layout can't import `src/lib/use-reduced-motion.ts` (a Server Component can't import a module that uses
    `useSyncExternalStore`), so the script spells out the key and attribute names. The unit test renders the layout and
    runs the script against the module's constants.
  - The cache is a copy of the account's values, never their source (Q15 b still holds). `/signin` sits outside (gm)
    and always shows Medium.
- **`src/lib/use-reduced-motion.ts`:**
  - `useReducedMotion()`: `useSyncExternalStore` over `matchMedia` change events and a `MutationObserver` on the
    `<html>` attribute. Server snapshot `false`.
  - `prefersReducedMotion()`: the same answer read once, for code outside React (dice, Web Animations, `scrollIntoView`).
  - Both return device OR account (Q13 a): On = calmer even when the device doesn't ask. Off = follow the device.
    Nothing forces motion on a device that asks for less.
  - Also: the attribute names, the cache key and the apply / read / write helpers PrefsSync uses.
- **`globals.css`:**
  - **Text size (Q12 a):** `html[data-text-size="small"] { zoom: 0.9 }`, `large` gets 1.15, Medium has no rule. The unit
    test checks these against `TEXT_SIZE_ZOOM`.
  - **Viewport units:** zoom scales them too (in Chromium, 100dvh inside a 1.15 root paints 115% of the screen). The
    screen-tall surfaces divide by `--text-zoom`: `.hud-root` (Combat HUD under the app bar), `.cfg-setp` (Campaign
    settings slide-over) and `.cfg-pop` (Preferences popover).
  - **Reduce motion:** under `html[data-reduce-motion]`, every element and pseudo-element gets `animation: none` and
    `transition: none` (`!important`), and scroll behaviour becomes `auto`. That covers every per-file
    `@media (prefers-reduced-motion: reduce)` block at once (about 30 across the app).
  - **Exceptions, as the media blocks have them:** loading spinners keep turning (`.animate-spin`; `.cm-spin` at
    2.4 s). The Combat Map hit flash (`.cmx-flash`) keeps its plain 1.8 s fade, because `flash.tsx` removes it on
    `animationend`. The HUD's `--hud-t-*` motion tokens are 0 ms. `.ln-card[data-current]` and the gold buttons'
    hover lose their transform. config.css's opt-in animations (`no-preference`) are cancelled by the blanket rule.

## Checks on the Combat Map (zoom)

- **Pointer math holds.** `stageToSquares` and `screenScale` divide by `getBoundingClientRect().width / offsetWidth`,
  which includes the root zoom.
  - The e2e test drags a token two squares at Large with real pointer moves, and it lands on `x + 2`. The drag step is
    48 px × map zoom × 1.15.
  - The pick / hit panels and the phone edges use bounding rects only, so they are consistent too.
- **HUD layout.** Before the `--text-zoom` fix, the HUD at Large measured 971 px tall in a 900 px viewport (the dock
  sat below the screen), and at Small it left a gap. Now the e2e test checks that the HUD spans the full width and
  ends at the bottom of the screen at Small, Medium and Large (1440×900).
  - Media queries still see the real viewport. At Large on a 1180-1280 px screen, the HUD keeps its desktop layout in
    a smaller CSS viewport (1280 / 1.15 ≈ 1113 px). At 1440×900 the screenshots show nothing clipped.
- **Pixel-identical HUD checks** run at Medium, which has no zoom rule and no attribute change, so they are unaffected.
- **No scoping needed:** zoom applies on the Combat Map too (the plan's default).

## Follow-ups (outside owns)

1. **Direct `matchMedia("(prefers-reduced-motion: reduce)")` reads.** Each should switch to `prefersReducedMotion()`
   (or `useReducedMotion()` in render) from `@/lib/use-reduced-motion`; each is a one-line change. Until then, CSS
   calms every CSS animation, but these JS-driven motions still follow only the device:
   - `src/components/party/dice/settings.ts` (U6a owns it): `prefersReducedMotion`, 3D default and `canAnimate3d`;
   - `src/components/party/dice/dice3d/index.ts`: `reducedMotion()`, which skips the 3D roll;
   - `src/components/combat-map/hud/queue/index.tsx:196`: the count pulse (Web Animations);
   - `src/components/combat-map/map-view/map-canvas.tsx:207`: the canvas animation;
   - `src/components/notes/bin/index.tsx:37`: the bin's paper animation;
   - smooth `scrollIntoView` in `src/components/adversaries/catalogue/index.tsx:161` and
     `src/components/adversaries/environments/index.tsx:179` (U6e owns both),
     `src/components/adversaries/environments/opened-adversary.tsx:31` and `src/components/adversaries/custom/index.tsx:53`;
   - `src/app/(gm)/campaigns/[campaignId]/party/new/steps-5-9.tsx:162` and
     `src/app/(gm)/campaigns/[campaignId]/party/[characterId]/level-up-draft.tsx:446`.
2. **Other viewport units under zoom** are caps or minimums that grow or shrink by 10-15%. Left as they are; revisit
   if a screen shows clipping:
   - `max-height: calc(100dvh - …)` on `.sh-modal`, HUD hit / dock / scene / phone sheets;
   - `.lk-root[data-page]` height (the page scrolls a little at Large);
   - `.w-vp` (World map) height;
   - `100vw` caps on narrow screens (fear, scene, tokens, journal header);
   - `min-h-screen` pages (only taller).

## Out-of-owns edits

None.

## Questions

None open. Q12 a and Q13 a as answered; N1-N11 don't touch U6b.

## Files

| File | Change |
|---|---|
| `src/app/(gm)/prefs-sync.tsx` | New: `PrefsSync`. |
| `src/app/(gm)/layout.tsx` | Mounts `PrefsSync`; inline display-cache script before the page. |
| `src/app/globals.css` | Text-size zoom + viewport compensation; reduce-motion rules. |
| `src/lib/use-reduced-motion.ts` | New: `useReducedMotion`, `prefersReducedMotion`, attribute / cache helpers. |
| `tests/unit/prefs-sync.test.tsx` | New: PrefsSync states, cache, layout script, hook (device OR account), CSS rules. |
| `tests/e2e/prefs-applied.spec.ts` | New: live text size, hard load without flash or hydration error, HUD fit and token drag at Large, reduce motion on / off with the device. |

## Checks run

- `pnpm lint`, `pnpm typecheck`: pass.
- `vitest tests/unit/prefs-sync.test.tsx`: 10 / 10. Full suite (`--maxWorkers=1 --testTimeout=120000`): 545 files, 11832 passed (1 expected fail, 1 todo).
- `E2E_PORT=3965 E2E_CONVEX_PORT=4065 playwright test tests/e2e/prefs-applied.spec.ts --workers=1`: 3 / 3. Set
  `E2E_SHOTS_DIR` to save its screenshots.
- Screenshots: `/mnt/c/Users/Petar/Downloads/dcm-screens/config-u6b/`. Dashboard and Combat Map at Small / Medium /
  Large, and Large after the drag.
