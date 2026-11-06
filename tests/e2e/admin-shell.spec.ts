import { expect as baseExpect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";

// Plan config AD1 (design reference/designs/config/Admin.dc.html): /admin is the app owner's page. A signed-in
// non-owner gets the plain 'Not allowed' view (Q17 changed: heading, 'This page is for the app owner.', a link back to
// the main menu) with no admin text and no tabs; a signed-out visitor goes to sign-in like every (gm) page. The
// owner's frame and tabs are covered by tests/unit/admin/shell.test.tsx until AD0's owner identity lands (the owner
// e2e is AX's superadmin spec).

test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test("a signed-in non-owner sees 'Not allowed' and no admin content", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/admin?tab=accounts");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Not allowed" })).toBeVisible();
  await expect(main.getByText("This page is for the app owner.")).toBeVisible();
  await expect(page).toHaveTitle("Not allowed");
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByText(/App admin|Owner only|Saved · changes apply right away/)).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  await main.getByRole("link", { name: "Back to the main menu" }).click();
  await expect(page).toHaveURL("/");
});

test("a signed-out visitor goes to sign-in and comes back to /admin", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    await expect(page).toHaveURL(`/signin?next=${encodeURIComponent("/admin")}`);
    await expect(page.getByText(/App admin|Owner only/)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
