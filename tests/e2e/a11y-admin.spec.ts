import { expect as baseExpect, test } from "@playwright/test";

import { expectFitsViewport, expectNoSeriousA11yViolations, TABLET_VIEWPORTS } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { E2E_OWNER_EMAIL, setAppOwner } from "./owner";

// Plan config AX: App admin at the two tablet sizes. Every tab, reached by its `?tab=` link as the shared e2e owner
// (tests/e2e/owner.ts), passes axe (WCAG 2.0-2.2 A/AA, no serious or critical findings) and does not scroll sideways.
// The desktop pass is in admin-superadmin.spec.ts. Read-only: nothing on the shared backend changes.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "lorekeeper", label: "Lorekeeper" },
  { id: "features", label: "Feature switches" },
  { id: "maintenance", label: "Maintenance" },
] as const;

test("every App admin tab passes axe and fits a tablet, upright and sideways", async ({ page }) => {
  await signInAsTestGm(page, E2E_OWNER_EMAIL);
  await expect(page).toHaveURL("/");
  setAppOwner();
  for (const viewport of TABLET_VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const tab of TABS) {
      await page.goto(tab.id === "overview" ? "/admin" : `/admin?tab=${tab.id}`);
      const panel = page.getByRole("tabpanel", { name: tab.label });
      await expect(panel.getByRole("heading", { level: 3 }).first()).toBeVisible();
      await expect(panel.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
      await expectFitsViewport(page);
      await expectNoSeriousA11yViolations(page);
    }
  }
});
