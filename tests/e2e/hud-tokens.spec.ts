import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H1.3 (docs/tasks/TASK-HUD-H1.3.md): with the HUD switch on every token wears the HUD face (CmpTokens
// "Token anatomy" / "Token kinds"): svg.tk-arc with HP left (left half) and Stress marked (right half), the gold Hope
// chip on PCs, condition badges, the side colour. Accessible names say "n of N Hit Points marked" (answer 2). The GM's
// adversaries carry arcs; a player's never do, and no adversary number reaches a player's DOM (hard rule 2). Tokens
// stay buttons that open a sheet / stat block, drag and keyboard moves keep working.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function squarePx(page: Page): Promise<number> {
  const text = (await page.getByTestId("combat-zoom").textContent()) ?? "100%";
  return 48 * (Number.parseInt(text, 10) / 100);
}

async function dragBy(page: Page, locator: Locator, dx: number, dy: number) {
  const box = (await locator.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** The seed's marks: Moss 2 HP / 3 Stress marked and Vulnerable; the Lieutenant 2 HP / 1 Stress and Vulnerable; the Bandit Restrained. */
async function markScene(s: HudScene) {
  const { client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "hp", delta: 2 });
  await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "stress", delta: 3 });
  await client.mutation(api.characters.toggleCondition, { characterId: moss.characterId, condition: "vulnerable" });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId });
  const instance = (tokenId: string) => tokens.find((t) => t._id === tokenId)!.instanceId!;
  const lt = instance(s.enemies.lieutenant.tokenId);
  const key = () => crypto.randomUUID();
  await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: lt, delta: 2, idempotencyKey: key() });
  await client.mutation(api.encounterTracking.markStress, { campaignId, instanceId: lt, delta: 1, idempotencyKey: key() });
  await client.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: lt, condition: "vulnerable", idempotencyKey: key() });
  await client.mutation(api.encounterTracking.toggleCondition, {
    campaignId,
    instanceId: instance(s.enemies.bandit.tokenId),
    condition: "restrained",
    idempotencyKey: key(),
  });
  const party = await client.query(api.combatHud.party, { campaignId, mapId: s.mapId });
  const lieutenant = tokens.find((t) => t._id === s.enemies.lieutenant.tokenId)!.stats!;
  return { party, lieutenant };
}

test("the GM: PC and adversary tokens with arcs, Hope chips, badges and side colours; a click opens the sheet or stat block", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { gm } = s;
  try {
    const { party, lieutenant } = await markScene(s);
    const mossRow = party.find((p) => p.name === "Moss")!;
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const hud = gm.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    const board = gm.getByRole("region", { name: "Battle map" });

    // Moss for the GM: an ally PC (teal), arcs, Hope chip, Vulnerable badge; the name says the marks.
    const moss = board.getByRole("button", {
      name: `Open Moss’s sheet, 2 of ${mossRow.hp.max} Hit Points marked, 3 of ${mossRow.stress.max} Stress marked, ${mossRow.hope.value} Hope, Vulnerable`,
    });
    await expect(moss).toBeVisible();
    await expect(moss.getByTestId("hud-token-face")).toHaveAttribute("data-tone", "ally-pc");
    const hpLeft = Math.round((100 * (mossRow.hp.max - 2)) / mossRow.hp.max);
    await expect(moss.locator("svg.tk-arc path.a-hp")).toHaveAttribute("stroke-dasharray", `${hpLeft} 100`);
    await expect(moss.locator("svg.tk-arc path.a-hp")).toHaveAttribute("pathLength", "100");
    await expect(moss.getByTestId("hud-token-hope")).toHaveText(String(mossRow.hope.value));
    await expect(moss.locator(".tk-cd[title='Vulnerable']")).toHaveCount(1);

    // The Lieutenant for the GM: red, with arcs (HP left, Stress marked), its stat block on click.
    const ltName = s.enemies.lieutenant.name;
    const lt = board.getByRole("button", { name: new RegExp(`^Open the ${escape(ltName)}’s stat block, 2 of ${lieutenant.hpMax} Hit Points marked, 1 of ${lieutenant.stressMax} Stress marked, Vulnerable$`) });
    await expect(lt).toBeVisible();
    await expect(lt.getByTestId("hud-token-face")).toHaveAttribute("data-tone", "enemy");
    await expect(lt.locator("svg.tk-arc path.a-st")).toHaveAttribute("stroke-dasharray", `${Math.round(100 / lieutenant.stressMax)} 100`);
    await expect(lt.getByTestId("hud-token-hope")).toHaveCount(0);
    // Every token on the GM's map has arcs (four PCs, four adversaries).
    await expect(board.locator("svg.tk-arc")).toHaveCount(8);
    await expect(board.locator(`[data-tone="enemy"] .tk-cd-restrained`)).toHaveCount(1);

    await lt.click();
    await expect(hud).toHaveClass(new RegExp(`sh-open sh-${s.enemies.lieutenant.tokenId}`));
    await expect(lt).toHaveAttribute("aria-pressed", "true");
    await lt.click();
    await expect(hud).not.toHaveClass(/sh-open/);
    await moss.click();
    await expect(hud).toHaveClass(new RegExp(`sh-${mossRow.characterId}`));

    // Keyboard moves keep working (the GM moves any token).
    const [lx, ly] = (await lt.getAttribute("data-square"))!.split(",").map(Number) as [number, number];
    await lt.focus();
    await gm.keyboard.press("ArrowUp");
    await expect(lt).toHaveAttribute("data-square", `${lx},${ly - 1}`);

    await expectNoSeriousA11yViolations(gm);
  } finally {
    await s.close();
  }
});

test("a player: PCs with arcs and Hope, adversaries without a ring or a number, live marks; drag and keys still move", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { player, client } = s;
  try {
    const { party } = await markScene(s);
    const mossRow = party.find((p) => p.name === "Moss")!;
    const brannocRow = party.find((p) => p.name === "Brannoc")!;
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    const hud = player.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    const board = player.getByRole("region", { name: "Battle map" });

    // Your token: gold, arcs, Hope chip.
    const moss = board.getByRole("button", { name: new RegExp(`^Open Moss’s sheet \\(your character\\), 2 of ${mossRow.hp.max} Hit Points marked`) });
    await expect(moss).toBeVisible();
    await expect(moss.getByTestId("hud-token-face")).toHaveAttribute("data-tone", "you");
    await expect(moss.locator("svg.tk-arc")).toHaveCount(1);
    await expect(moss.getByTestId("hud-token-hope")).toHaveText(String(mossRow.hope.value));
    // An ally PC: teal, arcs and Hope (party numbers are public, Q4).
    const brannoc = board.getByRole("button", { name: new RegExp(`^Open Brannoc’s sheet, 0 of ${brannocRow.hp.max} Hit Points marked`) });
    await expect(brannoc.getByTestId("hud-token-face")).toHaveAttribute("data-tone", "ally-pc");
    await expect(brannoc.getByTestId("hud-token-hope")).toHaveText(String(brannocRow.hope.value));

    // Adversaries: red, their condition names (answer 10a), no ring and no number anywhere (hard rule 2).
    const lt = board.getByRole("button", { name: `${s.enemies.lieutenant.name}, Enemy, Vulnerable` });
    await expect(lt).toBeVisible();
    await expect(lt.getByTestId("hud-token-face")).toHaveAttribute("data-tone", "enemy");
    await expect(lt.locator(".tk-cd[title='Vulnerable']")).toHaveCount(1);
    await expect(board.getByRole("button", { name: `${s.enemies.bandit.name}, Enemy, Restrained` })).toBeVisible();
    await expect(board.locator('[data-tone="enemy"]')).toHaveCount(3);
    await expect(board.locator('[data-tone="enemy"] .tk-arc, [data-tone="enemy"] .tk-hope')).toHaveCount(0);
    await expect(board.locator("svg.tk-arc")).toHaveCount(4);
    for (const label of await board.locator('button:has([data-tone="enemy"])').evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label")} ${e.textContent}`))) {
      expect(label).not.toMatch(/\d/);
    }
    // The hidden Bandit never reaches the DOM.
    await expect(board.getByRole("button", { name: new RegExp(`^${escape(s.enemies.hiddenBandit.name)},`) })).toHaveCount(0);

    // Live: the GM marks another Hit Point on Moss; the player's ring and name follow.
    await client.mutation(api.characters.adjustResource, { characterId: mossRow.characterId, resource: "hp", delta: 1 });
    const moss3 = board.getByRole("button", { name: new RegExp(`^Open Moss’s sheet \\(your character\\), 3 of ${mossRow.hp.max} Hit Points marked`) });
    await expect(moss3).toBeVisible();
    await expect(moss3.locator("path.a-hp")).toHaveAttribute("stroke-dasharray", `${Math.round((100 * (mossRow.hp.max - 3)) / mossRow.hp.max)} 100`);

    // A click opens the ally's (view-only) sheet; an adversary only selects / targets.
    await brannoc.click();
    await expect(hud).toHaveClass(new RegExp(`sh-${brannocRow.characterId}`));
    await lt.click();
    await expect(hud).toHaveClass(new RegExp(`sh-${brannocRow.characterId}`));
    await expect(board.getByRole("button", { name: `${s.enemies.lieutenant.name}, Enemy, Vulnerable, your target` })).toHaveAttribute("aria-pressed", "true");

    // Drag and keys still move your token.
    const [mx, my] = (await moss3.getAttribute("data-square"))!.split(",").map(Number) as [number, number];
    await dragBy(player, moss3, 0, await squarePx(player));
    await expect(moss3).toHaveAttribute("data-square", `${mx},${my + 1}`);
    await moss3.focus();
    await player.keyboard.press("ArrowLeft");
    await expect(moss3).toHaveAttribute("data-square", `${mx - 1},${my + 1}`);

    await expectNoSeriousA11yViolations(player);
  } finally {
    await s.close();
  }
});
