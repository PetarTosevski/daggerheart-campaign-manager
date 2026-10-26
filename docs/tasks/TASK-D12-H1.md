# TASK-D12-H1: E2E foundation

Plan `.omc/plans/d12-hardening.yaml`, tracer H1 (wave 1, foundation, no dependencies). Bead dcm-bxp.11.

Title: E2E foundation - axe dependency, accessibility and tablet helpers, two-browser live fixture.

The helpers below are what H18-H22 build on. The bar comes from the user's answers of 2026-10-21 (Q6, Q7 in
`.omc/autopilot/d12-analysis.md`): zero serious or critical axe findings under WCAG 2.2 AA rules; tablets at 768x1024
and 1024x768; no sideways scroll; primary controls at least 44 px.

## Dependency

`@axe-core/playwright` **4.13.0** (devDependency, exact pin), published 2026-08-11, so it satisfies pnpm's
`minimumReleaseAge` with no exclusion. 4.14.0 (2026-10-15) is too new. It pulls `axe-core` ~4.13.0 (4.13.0, published
2026-08-05). N9 had not added the package when H1 started from `rebuild` at e0f3678, so this is the first copy; if N9
lands its own, keep one entry, at this version unless N9's is older and was already merged.

## tests/e2e/a11y.ts

| Export | What it does |
|---|---|
| `A11Y_TAGS` | `["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]` |
| `TABLET_VIEWPORTS` | `[{ width: 768, height: 1024 }, { width: 1024, height: 768 }]` |
| `TOUCH_TARGET_PX` | `44` |
| `expectNoSeriousA11yViolations(page, { include?, exclude?, reason? })` | Runs axe with `A11Y_TAGS`; fails on any `serious` or `critical` violation and prints each rule with its help URL and up to five selectors. `include` / `exclude` take a CSS selector or an array of them. An `exclude` without a non-empty `reason` throws before scanning. Returns the remaining moderate and minor violations (`AxeViolation[]`). |
| `summarizeViolations(violations)` | One line per violation (`[impact] rule-id: help (n nodes)`), for listing moderate and minor findings in a task doc or a test annotation. |
| `expectFitsViewport(page)` | No horizontal page scroll at the current viewport (`scrollWidth <= clientWidth`, polled). On failure names up to five elements that stick out past the right edge. |
| `expectTouchTargets(locator, min = 44)` | Every visible element the locator matches is at least `min` x `min` px; hidden (zero-size) matches are skipped, at least one must be visible. On failure lists each small target with its label and size. |

Example (a tablet row for one route):

```ts
import { expectFitsViewport, expectNoSeriousA11yViolations, expectTouchTargets, summarizeViolations, TABLET_VIEWPORTS } from "./a11y";

for (const viewport of TABLET_VIEWPORTS) {
  test(`codex at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await expectFitsViewport(page);
    await expectTouchTargets(page.getByRole("navigation", { name: "Campaign" }).getByRole("link"));
    const minor = await expectNoSeriousA11yViolations(page, { exclude: "canvas.dice", reason: "WebGL dice canvas: no DOM to check" });
    console.log(summarizeViolations(minor).join("\n")); // copy into the task doc
  });
}
```

Notes for H20-H22:

- `expectNoHorizontalScroll` in `tests/e2e/visual/helpers.ts` stays for the visual specs; `expectFitsViewport` is the
  same check with a diagnostic message.
- Set the viewport before `goto` when the layout is chosen at load; after it when testing a live resize.
- Open dialogs before scanning to cover them; axe scans only what is in the DOM.

## tests/e2e/live.ts

`gmAndPlayer(browser, { frame?, draft?, extra? }): Promise<LiveTable>`

1. A fresh browser context signs in as the test GM (`signInAsTestGm`); `convexAs` gives the GM's client.
2. Through the client: `campaigns.create` (frame `frame`, default `witherwild`, name `Live <random>`),
   `members.rotateJoinCode`, and `characters.create` of characterA (the level-1 Bard of `bardDraft`, named `Liriel`;
   `draft` overrides fields, `extra` goes to `characters.create` as is, for example `{ ikonis }` in Motherboard).
3. A second context signs in as `E2E_PLAYER_EMAIL` (`e2e-player@example.test`), opens `/join/<code>` and presses
   "Join campaign", landing on the dashboard.
4. The GM reads `members.roster` and calls `characters.assignOwner` to hand characterA to the player.
5. The GM's page opens the dashboard; both pages show the campaign's h1.

`LiveTable`: `{ gm, player, campaignId, campaignName, characterId, characterName, client, playerClient, close }`.
`client` is the GM's Convex client, `playerClient` the player's. Call `close()` (closes both contexts) in a `finally`:

```ts
test("fear changes reach the player", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser);
  try {
    await gm.getByRole("button", { name: "Fear 4 of 12" }).click();
    await expect(player.getByTestId("fear-value")).toHaveText("IV"); // no reload()
  } finally {
    await close();
  }
});
```

Every call makes a new campaign, so specs do not share state. The player account is shared across specs; a fresh
campaign keeps the one-active-character rule satisfied.

## tests/e2e/a11y-smoke.spec.ts

Runs every helper once: axe on `/signin` (plus the two refused `exclude`s without a reason), the title menu at both
tablet sizes (fits the viewport, the five menu items at least 44 px, axe on the menu), and `gmAndPlayer` (both pages
on the dashboard, only the GM has Players, the player's client reads characterA as its owner).

Finding: axe flags `color-contrast` [serious] on the title menu's footer ("Daggerheart Campaign Ledger", `text-faint`,
`--faint: #6f6880` on `#0c0b11`, 3.7:1, needs 4.5:1). H1 owns no app file, so the smoke spec scans only the menu nav
and the finding is bead **dcm-o95** for H20 (owns `globals.css` and the title menu). `text-faint` is used in 7 files,
so H20-H22 should expect it elsewhere too. Moderate and minor findings on `/signin` go to test annotations.

## Verification

- `pnpm exec playwright test tests/e2e/a11y-smoke.spec.ts` (ports 3181/3474, `E2E_REUSE_SERVERS=1` with the local
  backend and `scripts/e2e-next.mjs` started by hand): 4 passed, twice in a row (19.8 s, 34.9 s).
- `pnpm lint`, `pnpm typecheck` pass. `pnpm tracer:guard .omc/plans/d12-hardening.yaml H1` passes.
