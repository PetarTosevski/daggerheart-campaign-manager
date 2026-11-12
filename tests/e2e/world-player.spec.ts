// dcm-yzxx: the player's World map. A player clicks a revealed marker, reads its details (no edit control), opens
// the linked Codex location from them, and finds every revealed marker in the side list; a hidden marker and its
// secret location never show. The zoom buttons step along round percentages.

import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 90_000 });

test("a player opens a revealed marker's details and its Codex location; hidden ones stay hidden", async ({ browser }) => {
  const { player, client, campaignId, close } = await gmAndPlayer(browser);
  try {
    const key = () => crypto.randomUUID();
    const place = async (name: string, x: number, y: number, hidden: boolean) => {
      const { id } = await client.mutation(api.maps.addToken, { campaignId, type: "village", x, y, idempotencyKey: key() });
      await client.mutation(api.maps.updateToken, { campaignId, id, patch: { name, hidden, location: true } });
      return id;
    };
    const locate = async (name: string, tokenId: number, known: boolean) => {
      const { entryId } = await client.mutation(api.codex.create, { campaignId, kind: "location", idempotencyKey: key() });
      await client.mutation(api.codex.update, { entryId: entryId as Id<"codexEntries">, patch: { name, known } });
      await client.mutation(api.codex.setPin, { entryId: entryId as Id<"codexEntries">, tokenId });
      return entryId;
    };
    const alula = await place("Alula", 40, 40, false);
    const keep = await place("Wyrm keep", 60, 60, true);
    const alulaEntry = await locate("Alula", alula, true);
    await locate("Wyrm keep", keep, false);

    await player.goto(`/campaigns/${campaignId}/world`);
    const map = player.getByRole("application", { name: /^Map of/ });
    await expect(map).toBeVisible();

    // The side list holds the revealed marker only.
    const list = player.getByRole("complementary", { name: "Markers on the map" });
    await expect(list.getByRole("button", { name: /Alula/ })).toBeVisible();
    await expect(player.getByText("Wyrm keep")).toHaveCount(0);

    // Zoom buttons step along round values and show a whole percent.
    const level = player.getByLabel("Zoom level");
    await player.getByRole("button", { name: "Zoom in" }).click();
    await expect(level).toHaveText(/^(50|75|100|125|150|200|250|300|400|500|600)%$/);

    // Clicking the marker opens its read-only details.
    await map.getByRole("button", { name: /^Alula, Village/ }).click();
    const details = player.getByRole("region", { name: "About Alula" });
    await expect(details).toBeVisible();
    await expect(details.getByRole("textbox")).toHaveCount(0);
    await expect(details.getByRole("checkbox")).toHaveCount(0);
    await expect(details.getByRole("button", { name: /Delete/ })).toHaveCount(0);

    // The list selects too; Escape closes the details.
    await player.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await list.getByRole("button", { name: /Alula/ }).click();
    await expect(details).toBeVisible();

    // The details open the linked Codex location.
    await details.getByRole("link", { name: /Open in Codex/ }).click();
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}/codex\\?entry=${alulaEntry}`));
    await expect(player.getByRole("heading", { level: 2, name: "Alula" })).toBeVisible();
  } finally {
    await close();
  }
});
