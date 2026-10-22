import { expect, test, type Locator, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Map movement M1 (.omc/plans/map-movement.yaml): blocked moves on screen, the GM's warning, difficult terrain and
// doors, at 1440 and 390. A player can't walk (keys or a drag) through a wall or a cottage, walks through an opened
// gate but not the fence beside it, gets the movement-roll note in a garden plot (hatched), and opens a closed door
// on the map, walks and sees through it and closes it again. The GM walks a token through a wall with a warning.

const PLAYER = "e2e-player@example.test";
const W = 30;
const DIFFICULT = "Difficult terrain: a movement roll is needed to pass this turn";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Squares (indexes) of the rectangle x0..x1, y0..y1. */
function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * W + x);
  return out;
}

/** Screen pixels per map square at the current zoom. */
async function squarePx(page: Page): Promise<number> {
  const text = (await page.getByRole("region", { name: "Battle map" }).getByTestId("combat-zoom").textContent()) ?? "100%";
  return 48 * (Number.parseInt(text, 10) / 100);
}

/** Drags from the middle of `locator` by (dx, dy) screen pixels with real pointer moves. */
async function dragBy(page: Page, locator: Locator, dx: number, dy: number) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

for (const viewport of VIEWPORTS) {
  test(`movement at ${viewport.width}: walls, a cottage, a gate, a garden plot, a door, and the GM's warning`, async ({ page, browser }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(viewport);
    const { client, campaignId, url } = await openCombatMap(page);
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Village lane", idempotencyKey: crypto.randomUUID() });

    const context = await browser.newContext({ viewport });
    const player = await context.newPage();
    try {
      const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
      await signInAsTestGm(player, PLAYER);
      await expect(player).toHaveURL("/");
      const playerClient = await convexAs(player);
      await playerClient.mutation(api.members.joinByCode, { code });
      await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

      // ---- The scene (30 x 20, grass). A wall at x = 6, rows 8..12. A thatched cottage on squares 13..15 x 3..5. A
      // fence on row 9 (squares 17..19 and 23..25) with the wooden gate between them (20..22). A vegetable garden plot
      // on 13..15 x 14..16. A wall at x = 9, rows 13..19, with a Classic door in its gap at (9, 16), and a Ghoul
      // behind it at (12, 16).
      await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
      const ash = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.name === "Ash")!;
      const { tokenId: ghoulId } = await client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Ghoul", hp: 3, side: "enemy", idempotencyKey: crypto.randomUUID() });
      await client.mutation(api.combatTokens.move, { campaignId, tokenId: ghoulId, x: 12, y: 16 });
      await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: rect(6, 8, 6, 12), paint: "wall" });
      await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [...rect(9, 13, 9, 15), ...rect(9, 17, 9, 19)], paint: "wall" });
      const add = (key: string, x: number, y: number) =>
        client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite: { builtin: `town-street-and-market/${key}` }, x, y });
      await add("thatched-cottage", 14.5, 4.5);
      await add("wooden-fence-section", 18.5, 9.5);
      await add("wooden-fence-section", 24.5, 9.5);
      const { objectId: gateId } = await add("wooden-fence-gate", 21.5, 9.5);
      await add("vegetable-garden-plot", 14.5, 15.5);
      const { objectId: doorId } = await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "door", x: 9.5, y: 16.5 });
      // Along the wall. r = 1: a hand-placed Classic door (r 0.5) covers no vision sample, so it would block nothing
      // (M2 follow-up, reported); r 1 covers its own square.
      await client.mutation(api.combatMapEdit.updateObject, { campaignId, objectId: doorId, r: 1, rot: Math.PI / 2 });

      /** Puts Ash somewhere (the GM's move, never refused), facing east. */
      const place = async (x: number, y: number) => {
        await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x, y });
        await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });
      };
      const serverSquare = async (who: ConvexHttpClient) => {
        const t = (await who.query(api.combatTokens.party, { campaignId, mapId })).find((p) => p._id === ash._id)!;
        return `${t.x},${t.y}`;
      };
      const doorOpen = async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.objects.find((o) => o._id === doorId)?.open === true;

      // ---- The player.
      await place(5, 10);
      await player.goto(url);
      const board = player.getByRole("region", { name: "Battle map" });
      const mine = board.getByRole("button", { name: /^Ash, Party.*your character/ });
      const notice = board.getByTestId("combat-move-notice");
      await expect(mine).toHaveAttribute("data-square", "5,10");
      await expect(notice).toHaveAttribute("role", "status");
      await expect(notice).toHaveText("");
      const press = async (key: string) => {
        await player.keyboard.press(key);
      };
      /** Runs `move` and expects a fresh "Blocked" announcement, with Ash back on `square` on screen and on the server. */
      const expectBlocked = async (move: () => Promise<void>, square: string) => {
        const before = Number(await notice.getAttribute("data-seq"));
        await move();
        await expect.poll(async () => Number(await notice.getAttribute("data-seq"))).toBeGreaterThan(before);
        await expect(notice).toHaveText("Blocked");
        await expect(notice).toHaveAttribute("data-kind", "blocked");
        await expect(mine).toHaveAttribute("data-square", square);
        await expect.poll(() => serverSquare(playerClient)).toBe(square);
      };

      // A wall: the arrow step snaps back with "Blocked", and so does a drag two squares into it.
      await player.locator("body").click({ position: { x: 2, y: 2 } });
      await expectBlocked(() => press("ArrowRight"), "5,10");
      await expect(board.getByRole("alert")).toHaveCount(0);
      const step = await squarePx(player);
      await expectBlocked(() => dragBy(player, mine, 2 * step, 0), "5,10");
      // The notice goes away by itself.
      await expect(notice).toHaveText("", { timeout: 10_000 });

      // The cottage (a building): D steps into it and are refused.
      await place(12, 4);
      await expect(mine).toHaveAttribute("data-square", "12,4");
      await player.locator("body").click({ position: { x: 2, y: 2 } });
      await expectBlocked(() => press("d"), "12,4");

      // The fence blocks; the gate, once the GM has opened it, lets Ash through.
      await place(18, 8);
      await expect(mine).toHaveAttribute("data-square", "18,8");
      await expectBlocked(() => press("s"), "18,8");
      await client.mutation(api.combatVision.toggleDoor, { campaignId, objectId: gateId, open: true });
      await place(21, 8);
      await expect(mine).toHaveAttribute("data-square", "21,8");
      await press("s");
      await expect(mine).toHaveAttribute("data-square", "21,9");
      await press("s");
      await expect(mine).toHaveAttribute("data-square", "21,10");
      await expect.poll(() => serverSquare(playerClient)).toBe("21,10");

      // The garden plot: Ash walks in, its squares are hatched, and the card says a movement roll is needed.
      await place(12, 15);
      await expect(mine).toHaveAttribute("data-square", "12,15");
      await press("d");
      await expect(mine).toHaveAttribute("data-square", "13,15");
      await expect.poll(() => serverSquare(playerClient)).toBe("13,15");
      await expect(player.getByRole("region", { name: "Selected token" }).getByTestId("combat-difficult-note")).toHaveText(DIFFICULT);
      const hatch = board.getByTestId("combat-difficult-hatch");
      await expect(hatch).toHaveCount(1);
      await expect.poll(async () => Number(await hatch.getAttribute("data-squares"))).toBeGreaterThan(0);

      // The door: closed, it blocks and hides the Ghoul; the player opens it on the map, sees the Ghoul, walks through
      // and closes it again. From (7, 16) the door is 2 squares away, out of reach (plan d12-bugs B4): its switch is
      // disabled and says "Move next to it"; one step east puts Ash next to it.
      await place(7, 16);
      await expect(mine).toHaveAttribute("data-square", "7,16");
      const ghoul = board.getByRole("button", { name: /^Ghoul, Enemy/ });
      await expect(ghoul).toHaveCount(0);
      const doorSwitch = board.getByRole("button", { name: "Open door 1" });
      await expect(doorSwitch).toHaveAttribute("aria-disabled", "true");
      await doorSwitch.hover();
      await expect(doorSwitch.getByText("Move next to it")).toBeVisible();
      await player.locator("body").click({ position: { x: 2, y: 2 } });
      await press("d");
      await expect(mine).toHaveAttribute("data-square", "8,16");
      await expect.poll(() => serverSquare(playerClient)).toBe("8,16");
      await expectBlocked(() => press("d"), "8,16");
      await expect(doorSwitch).not.toHaveAttribute("aria-disabled");
      await doorSwitch.click();
      await expect(board.getByRole("button", { name: "Close door 1" })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(doorOpen).toBe(true);
      await expect(ghoul).toBeVisible();
      await player.locator("body").click({ position: { x: 2, y: 2 } });
      await press("d");
      await expect(mine).toHaveAttribute("data-square", "9,16");
      await press("d");
      await expect(mine).toHaveAttribute("data-square", "10,16");
      await expect.poll(() => serverSquare(playerClient)).toBe("10,16");
      await board.getByRole("button", { name: "Close door 1" }).click();
      await expect(board.getByRole("button", { name: "Open door 1" })).toHaveAttribute("aria-pressed", "false");
      await expect.poll(doorOpen).toBe(false);

      // ---- The GM: walks Ash through the wall at x = 6 with the keyboard; the move goes through, with a warning.
      await place(5, 10);
      await page.goto(url);
      const gmBoard = page.getByRole("region", { name: "Battle map" });
      const gmAsh = gmBoard.getByRole("button", { name: /^Ash, Party/ });
      await expect(gmAsh).toHaveAttribute("data-square", "5,10");
      // The GM sees every difficult square hatched (the garden plot's 9 at least).
      await expect.poll(async () => Number(await gmBoard.getByTestId("combat-difficult-hatch").getAttribute("data-squares"))).toBeGreaterThanOrEqual(9);
      await gmAsh.focus();
      await page.keyboard.press("ArrowRight");
      const gmNotice = gmBoard.getByTestId("combat-move-notice");
      await expect(gmNotice).toHaveAttribute("data-kind", "warning");
      await expect(gmNotice).toContainText("Moved through a wall or building");
      await expect(gmAsh).toHaveAttribute("data-square", "6,10");
      await expect.poll(() => serverSquare(client)).toBe("6,10");
      // The player's map follows.
      await expect(mine).toHaveAttribute("data-square", "6,10");
    } finally {
      await context.close();
    }
  });
}

/** A hash of every pixel of the map canvas (FNV-1a over the RGBA bytes). */
async function canvasHash(page: Page): Promise<number> {
  return page.getByTestId("combat-map-canvas").evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i]!, 0x01000193);
    return h >>> 0;
  });
}

/** The canvas hash once it has stopped changing (sprite images arrive and repaint for a while after a load). */
async function stableHash(page: Page): Promise<number> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const now = await canvasHash(page);
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [400, 600, 800, 1000], timeout: 30_000 },
    )
    .toBe(true);
  return last;
}

test("doors are drawn closed and swung open in Classic and Sprites; the repaint after a toggle equals a full paint", async ({ page }) => {
  test.setTimeout(240_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Gatehouse", idempotencyKey: crypto.randomUUID() });
  // A Classic door, the wooden door sprite and the fence gate sprite, each in a gap of a painted wall row.
  const wall: number[] = [];
  for (let x = 0; x < 22; x++) if (![4, 10, 15, 16, 17].includes(x)) wall.push(7 * 22 + x);
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: wall, paint: "wall" });
  const doors = [
    (await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "door", x: 4.5, y: 7.5 })).objectId,
    (await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite: { builtin: "dungeon/wooden-door-closed" }, x: 10.5, y: 7.5 })).objectId,
    (await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite: { builtin: "town-street-and-market/wooden-fence-gate" }, x: 16.5, y: 7.5 }))
      .objectId,
  ];
  const setAll = async (open: boolean) => {
    for (const objectId of doors) await client.mutation(api.combatVision.toggleDoor, { campaignId, objectId, open });
  };

  for (const style of ["classic", "sprites"] as const) {
    await setAll(false);
    await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style });
    await page.goto(url);
    await expect(page.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", style);
    const closedHash = await stableHash(page);
    const closed = await canvasPng(page);
    // Open every door: only their rectangles repaint (map-canvas partial repaint), and the doors change visibly.
    await setAll(true);
    await expect.poll(() => canvasHash(page)).not.toBe(closedHash);
    await stableHash(page);
    const opened = await canvasPng(page);
    expect((await canvasDiff(page, closed)).changed).toBeGreaterThan(500);
    // A fresh load paints the whole map: the same picture (the browser's gradient and edge rasterising differs by a
    // few levels on a handful of pixels between a clipped and a whole paint).
    await page.reload();
    await expect(page.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", style);
    await stableHash(page);
    expect(await canvasDiff(page, opened)).toEqual(expect.objectContaining({ strong: 0 }));
    // Closing them again repaints back to the closed map.
    await setAll(false);
    await expect.poll(async () => (await canvasDiff(page, closed)).strong, { timeout: 30_000 }).toBe(0);
  }
});

/** The map canvas as a PNG data URL (lossless). */
async function canvasPng(page: Page): Promise<string> {
  return page.getByTestId("combat-map-canvas").evaluate((el) => (el as HTMLCanvasElement).toDataURL("image/png"));
}

/** Pixels of the map canvas that differ from `png`: any difference, and by more than 12 levels in a channel. */
async function canvasDiff(page: Page, png: string): Promise<{ changed: number; strong: number }> {
  return page.getByTestId("combat-map-canvas").evaluate(async (el, src) => {
    const canvas = el as HTMLCanvasElement;
    const image = new Image();
    image.src = src;
    await image.decode();
    const other = document.createElement("canvas");
    other.width = canvas.width;
    other.height = canvas.height;
    const octx = other.getContext("2d")!;
    octx.drawImage(image, 0, 0);
    const a = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const b = octx.getImageData(0, 0, canvas.width, canvas.height).data;
    let changed = 0;
    let strong = 0;
    for (let i = 0; i < a.length; i += 4) {
      let d = 0;
      for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a[i + k]! - b[i + k]!));
      if (d > 0) changed++;
      if (d > 12) strong++;
    }
    return { changed, strong };
  }, png);
}
