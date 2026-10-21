import { expect as baseExpect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { gmAndPlayer } from "./live";

// D12 H19 (.omc/plans/d12-hardening.yaml; analysis section 4): the live combat map with the GM and the player side by
// side, never reloading. The GM switches the live map (the player's board follows) and moves an adversary; the
// player walks their own token (the GM's board follows, also its facing) and the explored area reaches the GM's
// preview of their view; the GM hides and erases fog over an enemy; doors open and close from either side; a blocked
// move snaps back on both boards. Rule checks live in combat-maps / combat-movement / combat-vision specs.

// Live updates on a heavily loaded machine can take longer than the default 5 s; nothing here waits on a timer.
const expect = baseExpect.configure({ timeout: 15_000 });

const MAP_W = 30;
/** Fog canvas pixels per square (vision-layer.tsx FOG_PX). */
const FOG_PX = 12;

/** Alpha of the fog canvas at a point in squares (the GM's preview has no padding). */
async function fogAlpha(page: Page, sx: number, sy: number): Promise<number> {
  return page.getByTestId("combat-fog").evaluate(
    (el, [x, y]) => (el as HTMLCanvasElement).getContext("2d")!.getImageData(Math.floor(x!), Math.floor(y!), 1, 1).data[3]!,
    [sx * FOG_PX, sy * FOG_PX],
  );
}

/** Runs a seeding call (or the whole gmAndPlayer setup) again when the loaded local backend times out a Convex function (rolled back, so safe). */
async function seed<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= 4 || !String(error).includes("timed out")) throw error;
    }
  }
}

test("live combat map: map switch, tokens both ways, explored areas, fog, doors and a blocked move", async ({ browser }) => {
  test.setTimeout(240_000);
  const { gm, player, campaignId, characterName, client, close } = await seed(() => gmAndPlayer(browser));
  try {
    // ---- The scene, seeded by the GM: 'Old road' (live, the first map) and 'Cellar'. On the road (30 x 20, day):
    // Liriel at (15, 10) facing east; a Bandit at (20, 8) in her view; a wall at x = 24 (rows 5..15) with a Classic door at
    // (24, 10) and a Ghoul behind it at (27, 10); a short wall south of Liriel (14..16, 11) for the blocked move.
    const { mapId } = await seed(() => client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() }));
    await seed(() => client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Cellar", idempotencyKey: crypto.randomUUID() }));
    await seed(() => client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() }));
    const liriel = (await seed(() => client.query(api.combatTokens.list, { campaignId, mapId }))).find((t) => t.name === characterName)!;
    const { tokenId: banditId } = await seed(() => client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 3, side: "enemy", idempotencyKey: crypto.randomUUID() }));
    const { tokenId: ghoulId } = await seed(() => client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Ghoul", hp: 3, side: "enemy", idempotencyKey: crypto.randomUUID() }));
    await seed(() => client.mutation(api.combatTokens.move, { campaignId, tokenId: liriel._id, x: 15, y: 10 }));
    await seed(() => client.mutation(api.combatTokens.turn, { campaignId, tokenId: liriel._id, angle: 0 }));
    await seed(() => client.mutation(api.combatTokens.move, { campaignId, tokenId: banditId, x: 20, y: 8 }));
    await seed(() => client.mutation(api.combatTokens.move, { campaignId, tokenId: ghoulId, x: 27, y: 10 }));
    const wall = [...[5, 6, 7, 8, 9, 11, 12, 13, 14, 15].map((y) => y * MAP_W + 24), ...[14, 15, 16].map((x) => 11 * MAP_W + x)];
    await seed(() => client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: wall, paint: "wall" }));
    const { objectId: doorId } = await seed(() => client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "door", x: 24.5, y: 10.5 }));
    // r = 1 so the door covers its own square (see combat-movement.spec.ts).
    await seed(() => client.mutation(api.combatMapEdit.updateObject, { campaignId, objectId: doorId, r: 1, rot: Math.PI / 2 }));

    // ---- Both open the combat map once; from here on nobody reloads.
    const url = `/campaigns/${campaignId}/combat-map`;
    await Promise.all([gm.goto(url), player.goto(url)]);
    const tools = gm.getByRole("complementary", { name: "Map tools" });
    const maps = tools.getByRole("list", { name: "Campaign maps" });
    const gmBoard = gm.getByRole("region", { name: "Battle map" });
    const board = player.getByRole("region", { name: "Battle map" });
    const headline = player.locator(".cm-headline");
    await expect(headline).toHaveText("Old road");
    const mine = board.getByRole("button", { name: new RegExp(`^${characterName}, Party.*your character`) });
    await expect(mine).toHaveAttribute("data-square", "15,10");
    const gmLiriel = gmBoard.getByRole("button", { name: new RegExp(`^${characterName}, Party`) });
    await expect(gmLiriel).toHaveAttribute("data-square", "15,10");

    // ---- Map switch: the GM shows 'Cellar', then 'Old road' again; the player's board follows each time.
    await maps.getByRole("listitem").filter({ hasText: "Cellar" }).getByRole("button", { name: "Set live" }).click();
    await expect(headline).toHaveText("Cellar");
    await expect(mine).toHaveCount(0);
    await maps.getByRole("listitem").filter({ hasText: "Old road" }).getByRole("button", { name: "Set live" }).click();
    await expect(headline).toHaveText("Old road");
    await expect(mine).toHaveAttribute("data-square", "15,10");

    // ---- GM -> player: the GM selects the Bandit and steps it south with the keyboard.
    const playerBandit = board.getByRole("button", { name: /^Bandit, Enemy/ });
    await expect(playerBandit).toHaveAttribute("data-square", "20,8");
    const gmBandit = gmBoard.getByRole("button", { name: /^Bandit, Enemy/ });
    await gmBandit.click();
    await gm.keyboard.press("ArrowDown");
    await expect(gmBandit).toHaveAttribute("data-square", "20,9");
    await expect(playerBandit).toHaveAttribute("data-square", "20,9");

    // ---- Doors: closed, the door hides the Ghoul. The GM opens it from the Doors card: the player's door switch
    // flips and the Ghoul appears; the player closes it on the map: the GM's card flips back and the Ghoul goes.
    const ghoul = board.getByRole("button", { name: /^Ghoul, Enemy/ });
    await expect(ghoul).toHaveCount(0);
    await expect(board.getByRole("button", { name: "Open door 1" })).toHaveAttribute("aria-pressed", "false");
    await tools.getByRole("button", { name: "Open door 1" }).click();
    await expect(tools.getByRole("button", { name: "Close door 1" })).toHaveAttribute("aria-pressed", "true");
    await expect(board.getByRole("button", { name: "Close door 1" })).toHaveAttribute("aria-pressed", "true");
    await expect(ghoul).toBeVisible();
    await board.getByRole("button", { name: "Close door 1" }).click();
    await expect(board.getByRole("button", { name: "Open door 1" })).toHaveAttribute("aria-pressed", "false");
    await expect(tools.getByRole("button", { name: "Open door 1" })).toHaveAttribute("aria-pressed", "false");
    await expect(ghoul).toHaveCount(0);

    // ---- The GM previews Liriel's view: (8, 10), behind her, is unseen fog.
    await gm.getByRole("button", { name: /Player view/ }).click();
    await gm.getByRole("menu", { name: "Open the player view as" }).getByRole("menuitemradio", { name: characterName }).click();
    await expect(gm.getByRole("button", { name: new RegExp(`Viewing as ${characterName}`) })).toBeVisible();
    await expect(gm.getByTestId("combat-fog")).toBeVisible();
    await expect.poll(() => fogAlpha(gm, 8.5, 10.5)).toBeGreaterThan(250);

    // ---- Player -> GM: Liriel steps west (she turns west) and sees (8, 10); the GM's board and preview follow.
    await player.locator("body").click({ position: { x: 2, y: 2 } });
    await player.keyboard.press("ArrowLeft");
    await expect(mine).toHaveAttribute("data-square", "14,10");
    await expect(gmLiriel).toHaveAttribute("data-square", "14,10");
    await expect(gmLiriel).toHaveAttribute("data-face", /^-?180$/);
    await expect.poll(() => fogAlpha(gm, 8.5, 10.5)).toBeLessThan(10);
    // She steps back east: (8, 10) is out of sight but explored (synced by the player's client), so the GM's preview
    // shows it as explored fog, neither clear nor unseen.
    await player.keyboard.press("ArrowRight");
    await expect(mine).toHaveAttribute("data-square", "15,10");
    await expect(gmLiriel).toHaveAttribute("data-square", "15,10");
    await expect(gmLiriel).toHaveAttribute("data-face", "0");
    await expect
      .poll(async () => {
        const a = await fogAlpha(gm, 8.5, 10.5);
        return a > 10 && a < 250;
      })
      .toBe(true);
    await tools.getByRole("group", { name: "See the map as" }).getByRole("button", { name: "GM (everything)" }).click();
    await expect(gm.getByTestId("combat-fog")).toBeHidden();

    // ---- Fog: the GM's Hide brush over the Bandit hides it from the player; Erase brings it back.
    const vision = tools.getByRole("region", { name: "Vision and fog" });
    await vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Hide" }).click();
    await vision.getByRole("group", { name: "Brush size" }).getByRole("button", { name: "Brush 3" }).click();
    const stage = gmBoard.getByTestId("combat-stage");
    const squareCentre = async () => {
      await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
      const box = (await stage.boundingBox())!;
      const step = box.width / MAP_W;
      return { x: box.x + 20.5 * step, y: box.y + 9.5 * step };
    };
    let at = await squareCentre();
    await gm.mouse.click(at.x, at.y);
    await expect(gmBoard.getByTestId("combat-fog-marks-hide")).toBeVisible();
    await expect(playerBandit).toHaveCount(0);
    await vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Erase" }).click();
    at = await squareCentre();
    await gm.mouse.click(at.x, at.y);
    await expect(gmBoard.getByTestId("combat-fog-marks-hide")).toHaveCount(0);
    await expect(playerBandit).toBeVisible();
    // Put the brush away (back to selecting tokens).
    await vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Off" }).click();
    await expect(vision.getByRole("group", { name: "Fog brush" }).getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");

    // ---- A blocked move: south of Liriel is the short wall. The step snaps back with "Blocked"; the GM's board never
    // shows her inside the wall.
    const notice = board.getByTestId("combat-move-notice");
    const before = Number(await notice.getAttribute("data-seq"));
    await player.locator("body").click({ position: { x: 2, y: 2 } });
    await player.keyboard.press("ArrowDown");
    await expect.poll(async () => Number(await notice.getAttribute("data-seq"))).toBeGreaterThan(before);
    await expect(notice).toHaveText("Blocked");
    await expect(mine).toHaveAttribute("data-square", "15,10");
    await expect(gmLiriel).toHaveAttribute("data-square", "15,10");
    await expect
      .poll(async () => {
        const t = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((x) => x._id === liriel._id)!;
        return `${t.x},${t.y}`;
      })
      .toBe("15,10");

    // ---- GM -> player on the player's own token: the GM steps Liriel north; the player's token follows.
    await gmLiriel.click();
    await gm.keyboard.press("ArrowUp");
    await expect(gmLiriel).toHaveAttribute("data-square", "15,9");
    await expect(mine).toHaveAttribute("data-square", "15,9");

    await expect(gm.locator(".cm-root").getByRole("alert")).toHaveCount(0);
    await expect(player.locator(".cm-root").getByRole("alert")).toHaveCount(0);
  } finally {
    await close();
  }
});
