import { join } from "node:path";

import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { gotoSettings, settingsPanel } from "./config/helpers";
import { gmAndPlayer } from "./live";

// Plan config AU8 (server LB1; Q24 b, N6 b, N7 a, N8 a): Campaign settings > Lorekeeper, the GM's own books. The GM
// uploads the fixture PDF (tests/fixtures/pdf/sample.pdf, our own invented text) with the printed page number of its
// first page, sees 'Reading the book…' and then 'Indexed' with '<pages> pages · This campaign only', asks the
// Lorekeeper about it and gets a citation from it (the e2e fake model cites the first document it is given); a second
// campaign of the same GM never cites it. Then Remove (with its confirm) takes the book away. Needs `pnpm e2e:setup`
// (the fake model and the mini-book). Shots go to test-results/config-au8/.

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 30_000 });

const SAMPLE_PDF = join(process.cwd(), "tests", "fixtures", "pdf", "sample.pdf");
const TITLE = "Harbour Almanac";
/** Only the fixture's words answer this (its TIDE CHARTS page). */
const QUESTION = "Where does the harbour master post the tide chart each morning?";
const CITATION = new RegExp(`^📖 ${TITLE} · p\\.\\d+$`);

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-au8/${name}.png`, animations: "disabled" });

function chat(page: Page) {
  const column = page.getByRole("region", { name: "The Lorekeeper" });
  return {
    composer: column.getByRole("group", { name: "Ask the Lorekeeper" }),
    answers: column.getByRole("log", { name: "Conversation" }).getByRole("article", { name: "The Lorekeeper's answer" }),
  };
}

async function ask(composer: Locator, question: string) {
  const box = composer.getByRole("textbox", { name: "Your question" });
  await expect(box).toBeEnabled();
  await box.fill(question);
  await box.press("Enter");
}

test("the GM uploads a book PDF, the Lorekeeper cites it, another campaign does not, and Remove takes it away", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, campaignId, client } = table;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(gm, `/campaigns/${campaignId}/lorekeeper`, "lorekeeper");
    const rows = settingsPanel(gm).getByTestId("settings-lorekeeper-books");
    await expect(rows.getByText("PDF · Up to 20 MB and 300 pages")).toBeVisible();

    // Upload: the file, the title and the printed page number of the PDF's first page (N8 a).
    await rows.getByRole("button", { name: "Upload a book" }).click();
    const form = rows.getByRole("form", { name: "Upload a book" });
    await form.getByLabel("PDF file").setInputFiles(SAMPLE_PDF);
    await form.getByLabel("Title").fill(TITLE);
    await form.getByLabel("Printed page number of the PDF’s first page").fill("11");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=campaign-settings]" });
    await form.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(form).toBeHidden();

    // 'Reading the book…' (it may already be done), then 'Indexed' with its pages and switch.
    await expect(rows.getByText("Uploaded by you · 3 pages · This campaign only")).toBeVisible({ timeout: 90_000 });
    await expect(rows.getByRole("switch", { name: TITLE })).toHaveAttribute("aria-checked", "true");
    await expect(rows.getByText("Indexed")).toBeVisible();
    await shot(gm, "gm-book-indexed-1440");

    // The Lorekeeper of this campaign cites it.
    await gm.keyboard.press("Escape");
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    const here = chat(gm);
    await ask(here.composer, QUESTION);
    await expect(here.answers.last().getByRole("button", { name: CITATION })).toBeVisible({ timeout: 60_000 });

    // A second campaign of the same GM never sees or cites it.
    const { campaignId: otherId } = await client.mutation(api.campaigns.create, {
      frameId: "witherwild",
      name: `Other ${crypto.randomUUID().slice(0, 8)}`,
      idempotencyKey: crypto.randomUUID(),
    });
    await gm.goto(`/campaigns/${otherId}/lorekeeper`);
    const there = chat(gm);
    await ask(there.composer, QUESTION);
    await expect(there.answers.last().getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 60_000 });
    await expect(there.answers.last().getByRole("button", { name: CITATION })).toHaveCount(0);
    const otherBooks = await client.query(api.campaignBooks.list, { campaignId: otherId });
    expect(otherBooks.books).toEqual([]);

    // Remove asks first, then the book is gone.
    await gotoSettings(gm, `/campaigns/${campaignId}/lorekeeper`, "lorekeeper");
    await rows.getByRole("button", { name: `Remove: ${TITLE}` }).click();
    const confirm = rows.getByRole("group", { name: `Remove ${TITLE}?` });
    await confirm.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(rows.getByText(TITLE)).toHaveCount(0);
    await expect.poll(async () => (await client.query(api.campaignBooks.list, { campaignId })).books.length).toBe(0);

    // A phone-width panel keeps the rows usable.
    await gm.setViewportSize({ width: 390, height: 844 });
    await expect(rows.getByRole("button", { name: "Upload a book" })).toBeVisible();
    await shot(gm, "gm-books-390");
  } finally {
    await table.close();
  }
});
