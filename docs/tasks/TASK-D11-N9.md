# TASK-D11-N9: Notes end to end

Plan `.omc/plans/d11-notes.yaml`, tracer N9 (wave 5, depends on N4, N5, N8). Bead dcm-bxp.10 (left open for the
orchestrator). Status: Review.

Title: D11 end to end - GM and players flow, privacy in the browser, 1440 / 390 visual pass, axe, docs and follow-up
beads.

## Rules implemented (quoted from the plan)

- ORCHESTRATOR NOTE: "at 390 px the whole index column (own pages, search, Shared, journals, bin, Quick keys) goes
  behind the 'Pages' disclosure; N2's '🔗 Session' relink button on log pages stays."
- "Any layout fix goes only into C/notes/page.tsx and notes.css; a needed change elsewhere means stop and report."
- 390 rules: "one column, no horizontal page scroll, targets >= 44 px, row actions visible on touch, labels on every
  control, keyboard reachable, reduced motion respected".

## What landed

### 390 px disclosure (page.tsx, notes.css)

- `page.tsx`: the index column gets one 'Pages' button (`aria-expanded`, `aria-controls`, shows '· <current page
  title>' in the page view) above a wrapper holding every index slot (search, own pages, Shared, journals, torn-out
  pages, Quick keys). Any navigation (`onPage` / `onView`: picking a page, a Shared row, a journal, a torn-out page,
  Undo, Migrate) closes it.
- `notes.css`: the button shows and the wrapper collapses only at <= 720 px; wider screens are unchanged. N2's own
  'Pages' toggle inside `PageGroups` is hidden and its list always shown inside the column (selectors scoped to
  `.bj-index`, so no change in N2's files). The '🔗 Session' button is untouched.

### Specs

| Spec | What it proves | Result |
|---|---|---|
| `tests/e2e/notes-flow.spec.ts` | GM + Ash (A) + Bram (B) in three browsers at 1440x900 and 390x844: the GM adds a session log linked to the live session (picker preselects it, meta shows its date), writes while a second GM tab follows live, migrates the open task to a new 'Session 3' (original `migrated`), shares the log with everyone and 'Rumors & hooks' with A only. A and B write in their character journals ('Ash’s Journal' / 'Bram’s Journal') and add to the GM's 'everyone' page (' - Ash', ' - Bram'; the case N3 and N5 could not run). A sets 'Clues & secrets' players-only, B hides 'My goals' from everyone. Every seat's two Shared tabs hold exactly the allowed pages (server lists compared in full, UI rows spot-checked). The GM tears out the 'everyone' page: B's list loses it, A's open copy says 'This page isn't shared with you.' (the case N7 asked for); Undo brings it back with its four entries. Bram retires: 'Bram’s journal' (3 pages, not 'My goals') under Past journals for the GM and A, read only, Tear out for the GM only. At 390 the index is hidden until 'Pages' is opened. | 2 passed (43 s) |
| `tests/e2e/notes-a11y.spec.ts` | axe (serious + critical) inside `.bj-root` on the page view, the @ picker, the sharing dialog, the threads view, 'Shared by players', a journal view and a torn-out page; keyboard only (Tab / Shift+Tab / arrows / Enter / Escape): add an entry with a mention, cycle its bullet, open the sharing dialog and pick 'Everyone' with ArrowDown, Escape returns focus to the chip, toggle threads, switch Shared tabs with the arrows, open a player's journal, tear out a page and Undo it, open the bin. At 1440 and 390 (at 390 'Pages' is opened by keyboard). | 2 passed |
| `tests/e2e/visual/D11-N9.spec.ts` (@visual) | Shots of every board region, seeded like the board's story. | 1 passed, 13 shots |

## Accessibility findings

- axe: 0 violations of any impact (not only serious / critical) in all seven views at both widths. A probe page proved
  the injected axe reports (button-name, image-alt, color-contrast) inside the same `.bj-root` scope.
- Keyboard: every task is reachable and works by keyboard. One bug: the first write on a default page (before the
  journal exists) remounts the add row, so focus drops to `<body>`, the chosen bullet kind resets to Task and text
  typed meanwhile is lost (bead dcm-bxp.102; the spec tabs back to the input). The same remount is what makes
  `notes-entries.spec.ts` test 1 fail under load.
- axe-core is injected from pnpm's store (transitive dependency of eslint-plugin-jsx-a11y) because D11 adds no
  dependency (bead dcm-bxp.112).

## Visual check

Board: `node scripts/board-shots.mjs notes:all` -> `test-results/visual/board/notes-<region>-1440.png`. App:
`E2E_VISUAL=1 ... tests/e2e/visual/D11-N9.spec.ts` -> `test-results/visual/D11-N9/<region>-{1440,390}.png` plus
`index-open-390.png`. (Playwright empties `test-results/` on every run; shoot the board after the app run.)

| Region | 1440 vs board | 390 (rules) |
|---|---|---|
| empty | Match: hero type, index column, paper, toolbar, chips, KEY. Deviations: no campaign nav row in the shot (the campaign shell owns it), no 'Writing as' / PIN (A1, A2), 'Download my journal' (Q9), Shared / Players’ journals / Past journals / Torn-out pages added, visibility icon per page, sharing chip + '🔗 Session' push 'Tear out page' to a second toolbar row. | Pass: one column, 'Pages · Session 1' closed, no horizontal scroll, 44 px targets. |
| index (390 only) | not on the board | Pass: 'Pages' open shows search, groups, Shared, journals, bin, Quick keys above the paper. |
| page | Match: the eleven lines with every kind and state, the star, the Mira link, chips, add row, KEY. Deviation: rows about 4 px tighter than the board (bead dcm-bxp.113). | Pass. |
| threads | Match: purple tape, intro line, glyphs, '<page> →' chips. | Pass. |
| search | Match: 'ferry' keeps only Session 1 ('2 open'), 'No matches.' in Collections / Future log, the two ferry rows highlighted. The Shared / journals / bin blocks stay below. | Pass (index behind 'Pages'). |
| player | Match: 'Liriel’s Journal', player default pages and tapes. Deviations: class from the real sheet (Bard; the board's story uses Seraph), chip 'Private · GM can read', no 'Writing as' / PIN. | Pass. |
| tear | Match: clip-path halves and scraps mid-rip, the next page under it. Deviation (N7): the rip is a fixed overlay with two clones; the Undo toast shows (Q11). | Pass. |

Deliberate deviations overall: switcher and PIN dropped (A1, A2); Shared section, journals lists, bin, pickers and
download added; session-linked titles and dates (Q5, D6); mobile layout with the one 'Pages' disclosure; ARIA fixes
(radio chips with `aria-checked` only, labelled controls, 44 px targets, row actions visible on touch).

## Bugs and changes outside N9's files (not fixed here)

1. Existing 390 px specs reach index blocks without opening the new 'Pages' disclosure: `notes-bin.spec.ts` (both 390
   tests), `notes-journals.spec.ts` (390), `notes-sharing.spec.ts` (390, times out clicking a hidden tab). The
   orchestrator applies the diff below (an `openIndex(page)` helper and calls after each navigation); with it the
   three files pass (see Evidence). Bead dcm-bxp.114.
2. `notes-entries.spec.ts` test 1: the add-row remount (dcm-bxp.102) loses the 'Old Mag' note under load.
3. `notes-entries.spec.ts` test 2: opens the player's page as the GM by `?page=`, which shows 'Missing page' since N2
   (predicted in N5's question 1). Bead dcm-bxp.103.

Diff for item 1 (to apply on rebuild):

```diff
diff --git a/tests/e2e/notes-bin.spec.ts b/tests/e2e/notes-bin.spec.ts
index da81cc6..ac90936 100644
--- a/tests/e2e/notes-bin.spec.ts
+++ b/tests/e2e/notes-bin.spec.ts
@@ -67,6 +67,18 @@ const paper = (page: Page) => page.getByRole("region", { name: "Journal page" })
 const toast = (page: Page) => page.getByRole("status").filter({ hasText: "Page torn out" });
 const binList = (page: Page) => page.getByRole("list", { name: "Torn-out pages" });
 
+/** At 390 px the whole index column sits behind the 'Pages' disclosure (N9); opens it when it is closed. */
+async function openIndex(page: Page) {
+  const toggle = page.getByRole("complementary", { name: "Journal index" }).getByRole("button", { name: /^Pages/ });
+  await expect(page.getByRole("complementary", { name: "Journal index" })).toBeVisible();
+  if (!(await toggle.isVisible())) return;
+  // Retried: a click that lands before hydration does nothing.
+  await expect(async () => {
+    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
+    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
+  }).toPass();
+}
+
 async function tearOut(page: Page) {
   const button = paper(page).getByRole("button", { name: "Tear out page" });
   await button.scrollIntoViewIfNeeded();
@@ -104,6 +116,7 @@ for (const viewport of VIEWPORTS) {
 
     await page.goto(`/campaigns/${campaignId}/notes?page=${pageId}`);
     await expect(paper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
+    await openIndex(page);
     await expect(page.getByRole("region", { name: "Torn-out pages" }).getByText("Nothing torn out.")).toBeVisible();
 
     // First click arms, second tears: the rip plays over the paper, the sound is synthesised, the toast offers Undo.
@@ -130,6 +143,7 @@ for (const viewport of VIEWPORTS) {
     // Again: this time it waits under Torn-out pages ('30 days left'); the toast goes after 10 seconds.
     await tearOut(page);
     await expect(toast(page)).toBeVisible();
+    await openIndex(page);
     const row = binList(page).getByRole("listitem").filter({ hasText: "Rumors & hooks" });
     await expect(row).toContainText("30 days left");
     await expect.poll(() => serverState(client, campaignId, pageId)).toEqual({ listed: false, binned: true });
@@ -141,8 +155,10 @@ for (const viewport of VIEWPORTS) {
     await expect(torn.getByText("the mill burned")).toBeVisible();
     await expect(torn.getByRole("textbox", { name: "New entry" })).toHaveCount(0);
     if (viewport.width < 640) await expectNoHorizontalScroll(page);
+    await openIndex(page);
     await row.getByRole("button", { name: "Restore Rumors & hooks" }).click();
     await expect(paper(page).getByLabel("Page title")).toHaveValue("Rumors & hooks");
+    await openIndex(page);
     await expect(page.getByRole("region", { name: "Torn-out pages" }).getByText("Nothing torn out.")).toBeVisible();
     await expect.poll(() => serverState(client, campaignId, pageId)).toEqual({ listed: true, binned: false });
     expect((await client.query(api.notesEntries.entries, { campaignId, page: pageId })).entries.map((e) => e.text)).toEqual(["the mill burned"]);
@@ -166,6 +182,7 @@ for (const viewport of VIEWPORTS) {
       await expect(toast(player)).toBeVisible();
       await expect(player.getByTestId("tear-frame")).toHaveCount(0);
       expect(await audio()).toBe(0);
+      await openIndex(player);
       await expect(binList(player).getByRole("listitem").filter({ hasText: "Session 1" })).toContainText("30 days left");
       await expect.poll(() => codeOf(gm.query(api.notesEntries.entries, { campaignId, page: pageId }))).toBe("NOTE_PAGE_NOT_FOUND");
       await expect.poll(async () => (await gm.query(api.notesBin.bin, { campaignId })).length).toBe(0);
diff --git a/tests/e2e/notes-journals.spec.ts b/tests/e2e/notes-journals.spec.ts
index 67c7f7b..6d4bfa0 100644
--- a/tests/e2e/notes-journals.spec.ts
+++ b/tests/e2e/notes-journals.spec.ts
@@ -62,9 +62,22 @@ async function expectStrip(page: Page, titles: string[]) {
   for (const title of titles) await expect(strip(page).getByRole("button", { name: new RegExp(`^${title}`) })).toBeVisible();
 }
 
+/** At 390 px the whole index column sits behind the 'Pages' disclosure (N9); opens it when it is closed. */
+async function openIndex(page: Page) {
+  const toggle = page.getByRole("complementary", { name: "Journal index" }).getByRole("button", { name: /^Pages/ });
+  await expect(page.getByRole("complementary", { name: "Journal index" })).toBeVisible();
+  if (!(await toggle.isVisible())) return;
+  // Retried: a click that lands before hydration does nothing.
+  await expect(async () => {
+    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
+    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
+  }).toPass();
+}
+
 /** Opens Ash's past journal from the index. */
 async function openPast(page: Page) {
   await page.goto(page.url().split("?")[0]!);
+  await openIndex(page);
   await pastList(page).getByRole("button", { name: /^Ash’s journal/ }).click();
   await expect(page).toHaveURL(/view=journal&journal=/);
   await expect(paperColumn(page).getByText("Past journal · read only")).toBeVisible();
@@ -104,6 +117,7 @@ for (const viewport of [
 
         // ---- The GM opens Ash's journal: neither page is there; the GM adds to 'Session 1' (Q3).
         await gm.page.goto(notesUrl);
+        await openIndex(gm.page);
         await expect(playersList(gm.page).getByRole("button", { name: /^Ash/ })).toContainText("Player journal · Bard · 2 pages");
         await playersList(gm.page).getByRole("button", { name: /^Ash/ }).click();
         await expect(gm.page).toHaveURL(/view=journal&journal=/);
@@ -122,6 +136,7 @@ for (const viewport of [
         if (viewport.width < 640) await expectNoHorizontalScroll(gm.page);
         // Players get no 'Players’ journals' list (Q2).
         await B.page.goto(notesUrl);
+        await openIndex(B.page);
         await expect(pastList(B.page)).toContainText("No past journals.");
         await expect(playersList(B.page)).toHaveCount(0);
 
@@ -129,6 +144,7 @@ for (const viewport of [
         await setStatus("retired");
         await expect.poll(() => pastNames(B)).toEqual([["Ash’s journal", 3]]);
         await gm.page.goto(notesUrl);
+        await openIndex(gm.page);
         await expect(playersList(gm.page)).toContainText("No player has written yet.");
         await openPast(gm.page);
         await expectStrip(gm.page, ["Session 1", "Party secrets", "My goals"]);
@@ -141,6 +157,7 @@ for (const viewport of [
         await expect(paperColumn(B.page).getByRole("button", { name: "Tear out page" })).toHaveCount(0);
         if (viewport.width < 640) await expectNoHorizontalScroll(B.page);
         await A.page.goto(notesUrl);
+        await openIndex(A.page);
         await openPast(A.page);
         await expectStrip(A.page, ["Session 1", "Party secrets", "True name", "My goals"]);
 
@@ -151,6 +168,7 @@ for (const viewport of [
         await paperColumn(gm.page).getByRole("button", { name: "Click again to tear out" }).click();
         await expect.poll(() => pastNames(B)).toEqual([["Ash’s journal", 2]]);
         await expectStrip(gm.page, ["Session 1", "My goals"]);
+        await openIndex(gm.page);
         await expect(index(gm.page).getByRole("region", { name: "Torn-out pages" })).toContainText("from Ash’s journal");
         await expectStrip(B.page, ["Session 1", "My goals"]);
 
@@ -168,11 +186,13 @@ for (const viewport of [
             ["My goals", "gm"],
           ]);
         await gm.page.goto(notesUrl);
+        await openIndex(gm.page);
         await expect(pastList(gm.page)).toContainText("No past journals.");
         await playersList(gm.page).getByRole("button", { name: /^Ash/ }).click();
         await expectStrip(gm.page, ["Session 1", "My goals"]);
         await expect(paperColumn(gm.page).getByRole("textbox", { name: "New entry" })).toBeVisible();
         await B.page.goto(notesUrl);
+        await openIndex(B.page);
         await expect(pastList(B.page)).toContainText("No past journals.");
 
         // ---- Dead, then active: the same cycle.
@@ -191,6 +211,7 @@ for (const viewport of [
         await expect.poll(() => pastNames(B)).toEqual([["Ash’s journal", 2]]);
         await expect.poll(() => A.client.query(api.notesJournals.pastJournals, { campaignId }).then(() => "ok", () => "refused")).toBe("refused");
         await gm.page.goto(notesUrl);
+        await openIndex(gm.page);
         await openPast(gm.page);
         await expectStrip(gm.page, ["Session 1", "My goals"]);
         const fresh = await gm.client.mutation(api.members.rotateJoinCode, { campaignId });
@@ -199,6 +220,7 @@ for (const viewport of [
         await expect(paperColumn(gm.page).getByText("read only", { exact: true })).toBeVisible();
         await expect(paperColumn(gm.page).getByRole("textbox", { name: "New entry" })).toBeVisible();
         await gm.page.goto(notesUrl);
+        await openIndex(gm.page);
         await expect(playersList(gm.page).getByRole("button", { name: /^Ash/ })).toContainText("2 pages");
       } finally {
         await a.close();
diff --git a/tests/e2e/notes-sharing.spec.ts b/tests/e2e/notes-sharing.spec.ts
index 4aa5c1f..12d8bf3 100644
--- a/tests/e2e/notes-sharing.spec.ts
+++ b/tests/e2e/notes-sharing.spec.ts
@@ -57,7 +57,20 @@ const index = (page: Page) => page.getByRole("complementary", { name: "Journal i
 const sharedBlock = (page: Page) => index(page).getByRole("region", { name: "Shared" });
 const paper = (page: Page) => page.getByRole("region", { name: "Journal page" });
 
+/** At 390 px the whole index column sits behind the 'Pages' disclosure (N9); opens it when it is closed. */
+async function openIndex(page: Page) {
+  const toggle = page.getByRole("complementary", { name: "Journal index" }).getByRole("button", { name: /^Pages/ });
+  await expect(page.getByRole("complementary", { name: "Journal index" })).toBeVisible();
+  if (!(await toggle.isVisible())) return;
+  // Retried: a click that lands before hydration does nothing.
+  await expect(async () => {
+    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
+    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
+  }).toPass();
+}
+
 async function openTab(page: Page, name: "Shared by players" | "Shared by GM") {
+  await openIndex(page);
   const tab = sharedBlock(page).getByRole("tab", { name });
   await tab.click();
   await expect(tab).toHaveAttribute("aria-selected", "true");
@@ -199,7 +212,7 @@ for (const viewport of [
         // ---- A shares another page ('People we met') with chosen B only: B sees it, the GM loses it.
         await expect(sharedRow(gmPanel, "People we met", "Ash")).toBeVisible();
         await A.page.goto(`/campaigns/${campaignId}/notes`);
-        if (viewport.width < 640) await index(A.page).getByRole("button", { name: /^Pages/ }).click();
+        await openIndex(A.page);
         await index(A.page).getByRole("navigation", { name: "Your pages" }).getByRole("button", { name: /People we met/ }).click();
         dialog = await openSharing(A.page);
         await dialog.getByRole("radio", { name: /Chosen players/ }).check();
@@ -211,6 +224,7 @@ for (const viewport of [
           .toEqual(["People we met", "Session 1"]);
         await dialog.getByRole("button", { name: "Done" }).click();
         await expect(paper(A.page).getByRole("button", { name: "Sharing: Chosen players · Bram" })).toBeVisible();
+        await openIndex(B.page);
         await expect(sharedRow(panel, "People we met", "Ash")).toBeVisible();
         await expect(sharedRow(gmPanel, "People we met", "Ash")).toHaveCount(0);
         await expect
```

## Follow-up beads (all under dcm-bxp)

| Bead | P | What |
|---|---|---|
| dcm-bxp.100 | 2 | D12: authz-matrix entries for every D11 notes public function |
| dcm-bxp.101 | 2 | D12 backup carries only pages the GM may read; never players' private, players-only or unticked chosen pages |
| dcm-bxp.102 | 2 | Bug: first write on a default page remounts the add row (focus, bullet kind, typed text lost) |
| dcm-bxp.103 | 2 | Bug: notes-entries e2e test 2 opens a player's page by `?page=` (Missing page) |
| dcm-bxp.114 | 2 | Apply the 390 'Pages' helper to notes-bin / notes-journals / notes-sharing specs (diff above) |
| dcm-bxp.104 | 3 | QUESTION (N4 Q1): search matches words / prefixes, not any substring |
| dcm-bxp.105 | 3 | Move threads and bin optimistic updaters to `src/lib/optimistic/` (N4 Q2, N7 Q3) |
| dcm-bxp.106 | 3 | QUESTION (N5 Q2): the input shows raw `@[name](id)` tokens while editing |
| dcm-bxp.107 | 3 | Dedicated second e2e player account (N6) |
| dcm-bxp.108 | 3 | QUESTION (N8 Q1): hide past journals with no readable page? |
| dcm-bxp.109 | 3 | QUESTION (N8 Q2): a player can open another present player's journal by URL |
| dcm-bxp.110 | 3 | Journal view meta shows the creation date, not the linked session's date (N8 deviation) |
| dcm-bxp.111 | 3 | QUESTION (N3 deviation 3): default pages share one createdAt, so migration never finds a later default page |
| dcm-bxp.112 | 3 | Add @axe-core/playwright; shared axe helper; axe on the campaign shell |
| dcm-bxp.113 | 3 | Entry rows ~4 px tighter than the board |
| dcm-bxp.81 | 3 | (existing) N7 Q1: GM-torn departed page unrestorable after a rejoin |

Questions and notes from N0-N8 already settled on rebuild, so no bead: the Caveat weights build failure (N3 item 2;
`page.tsx` now loads Caveat without weights) and the notes-shell player heading (N2; notes-shell passes). Recorded
decisions without a question (N0 index deviation, N1 decisions, N5 ARIA 1.1 combobox, N6 static chip and
`removeRecipient` for ex-members) need nothing further.

## Evidence

Run on a heavily loaded machine (load average 12-24) with the backend and `scripts/e2e-next.mjs` started by hand on
E2E_PORT 3160 / E2E_CONVEX_PORT 3432 and `E2E_REUSE_SERVERS=1`.

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm exec vitest run --maxWorkers=4 --testTimeout=60000`: 185 files, 2466
  tests passed.
- `tests/e2e/notes-flow.spec.ts`: 2 passed (1440, 390). `tests/e2e/notes-a11y.spec.ts`: 2 passed, axe 0 violations in
  14 scans. `E2E_VISUAL=1 tests/e2e/visual/D11-N9.spec.ts`: 1 passed.
- Full notes set (`playwright test tests/e2e/notes-`, 27 tests) with the item-1 diff applied: 22 passed. Failed:
  notes-entries test 1 (dcm-bxp.102) and test 2 (dcm-bxp.103), both independent of N9; notes-bin 1440 / 390 tests hit
  their default 30 s timeout under load (the same four bin tests passed together in the previous run with the diff,
  and every notes-bin / notes-sharing / notes-journals test passed at least once with it). Without the diff the 390
  tests of notes-bin (2), notes-journals (1) and notes-sharing (1) fail on the hidden index (item 1).
- `pnpm tracer:guard .omc/plans/d11-notes.yaml N9`: clean (only owned files changed; the spec diff above is not
  committed).
