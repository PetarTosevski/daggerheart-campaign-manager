import { webcrypto } from "node:crypto";

import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";
import { useMutation } from "convex/react";

import { scanGmFunctions } from "../../harness/gm-functions";
import { renderAsGm, renderAsPlayer, type RenderedScreen } from "../../harness";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { api, type Id } from "../../../src/convex";
import { CampaignFramePanels, type TrackerCampaign } from "../../../src/features/trackers";
import { partySummaryRow } from "../../harness/records";

beforeEach(() => {
  resetMotionTest();
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const gmNames = new Set(scanGmFunctions());

function table(
  frameId: string,
  role: "gm" | "player",
  options?: { witherPersists?: boolean },
): TrackerCampaign {
  return { _id: "campaign-1" as Id<"campaigns">, frameId, role, options };
}

function expectNoGm(screen: RenderedScreen) {
  const touched = [...screen.client.subscribed, ...screen.client.called];
  expect(touched.filter((name) => gmNames.has(name))).toEqual([]);
}

function CallsAssignReading() {
  const assign = useMutation(api.trackers.weredragon.assignReading);
  assign({ campaignId: "campaign-1", assignment: [0, 1, 2, 3, 4] } as never);
  return null;
}

test("a player render fails when it calls a GM tracker function", async () => {
  await expect(renderAsPlayer(<CallsAssignReading />)).rejects.toThrow(
    "Player called GM function trackers/weredragon:assignReading",
  );
});

test("a frame without its own tracker renders nothing and subscribes to nothing", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("beast-feast", "player")} />);
  expect(screen.queryByText("Wither Tokens")).toBeNull();
  expect(screen.queryByText("Sacred Pyres")).toBeNull();
  expect(screen.client.subscribed).toEqual([]);
  expectNoGm(screen);
});

test("a player reads Sacred Pyres and does not open the Lurking Darkness", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("age-of-umbra", "player")} />, {
    queries: {
      "trackers/ageOfUmbra:get": {
        pyres: [{ id: "p1", settlement: "Hush", lit: true }],
        blessedBranches: 2,
        atPyre: true,
        gm: { log: [{ gmRoll: 2, watchRoll: null, result: 2, outcome: "conflict", fearGained: 0, at: 1 }] },
      },
    },
  });
  expect(screen.getByText("Hush")).toBeTruthy();
  expect(screen.getByTestId("blessed-branches")).toHaveTextContent("2");
  expect(screen.getByRole("checkbox", { name: "The party is at a Sacred Pyre" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add pyre" })).toBeNull();
  expect(screen.queryByText("Lurking Darkness")).toBeNull();
  expect(screen.queryByRole("button", { name: "Roll Lurking Darkness" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["trackers/ageOfUmbra:get"]);
  expectNoGm(screen);
});

test("the GM adds a Sacred Pyre", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(<CampaignFramePanels campaign={table("age-of-umbra", "gm")} />, {
    queries: {
      "trackers/ageOfUmbra:get": { pyres: [], blessedBranches: 0, atPyre: false, gm: { log: [] } },
    },
    mutations: {
      "trackers/ageOfUmbra:addPyre": (args) => {
        seen.push(args);
        return { pyreId: "p2" };
      },
    },
  });
  await fireEvent.changeText(screen.getByLabelText("Settlement"), "Hush");
  await fireEvent.press(screen.getByRole("button", { name: "Add pyre" }));
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1", settlement: "Hush" });
  expect(typeof (seen[0] as { idempotencyKey: unknown }).idempotencyKey).toBe("string");
  expect(screen.client.called).toContain("trackers/ageOfUmbra:addPyre");
});

test("a player reads a hunt and its revealed clues", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("dark-heart-of-andaluria", "player")} />, {
    queries: {
      "trackers/andaluria:get": {
        role: "player",
        hunts: [
          {
            id: "h1",
            title: "The Drowned Bell",
            beat: "investigation",
            archived: false,
            clues: [{ id: "c1", text: "Salt on the altar" }],
            allCluesRevealed: false,
          },
        ],
      },
    },
  });
  expect(screen.getByText("The Drowned Bell")).toBeTruthy();
  expect(screen.getByText("Salt on the altar")).toBeTruthy();
  expect(screen.getByText("Investigation")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New hunt" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["trackers/andaluria:get"]);
  expectNoGm(screen);
});

test("the GM names a new hunt", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(<CampaignFramePanels campaign={table("dark-heart-of-andaluria", "gm")} />, {
    queries: { "trackers/andaluria:get": { role: "gm", hunts: [] } },
    mutations: {
      "trackers/andaluria:createHunt": (args) => {
        seen.push(args);
        return { huntId: "h2" };
      },
    },
  });
  await fireEvent.changeText(screen.getByLabelText("New hunt name"), "The Drowned Bell");
  await fireEvent.press(screen.getByRole("button", { name: "New hunt" }));
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1", title: "The Drowned Bell" });
  expect(screen.client.called).toEqual(["trackers/andaluria:createHunt"]);
});

test("a player reads the hunt phase and not Kudamat", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("colossus-of-the-drylands", "player")} />, {
    queries: {
      "trackers/colossus:get": {
        phase: "hunt",
        colossiDefeated: 2,
        gm: { siphonMarked: 4, kudamatPower: 40, emerged: true, thresholds: { major: 8, severe: 16 }, log: [] },
      },
    },
  });
  expect(screen.getByText(/Hunt phase/)).toBeTruthy();
  expect(screen.getByTestId("colossi-defeated")).toHaveTextContent("2");
  expect(screen.queryByText("Kudamat")).toBeNull();
  expect(screen.queryByRole("button", { name: "Colossus defeated" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["trackers/colossus:get"]);
  expectNoGm(screen);
});

test("the GM records a defeated colossus", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(<CampaignFramePanels campaign={table("colossus-of-the-drylands", "gm")} />, {
    queries: {
      "trackers/colossus:get": { phase: "hunt", colossiDefeated: 1, gm: null },
    },
    mutations: {
      "trackers/colossus:defeatColossus": (args) => {
        seen.push(args);
        return { colossiDefeated: 2, roll: { reason: "defeat", dice: [3, 4], gained: 7, powerAfter: 7, at: 1 }, notice: "The shard is spent." };
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Colossus defeated" }));
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1" });
  expect(screen.getByText(/The shard is spent/)).toBeTruthy();
  expect(screen.queryByText("Kudamat")).toBeNull();
});

test("a player reads revealed Five Banners relationships only", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("five-banners-burning", "player")} />, {
    queries: {
      "trackers/fiveBanners:state": {
        role: "player",
        week: 3,
        relationships: [{ a: "armada", b: "jesthaen", value: 2, label: "Allies", rating: "+2", revealed: true }],
        nations: [],
      },
    },
  });
  expect(screen.getByText(/Week 3/)).toBeTruthy();
  expect(screen.getAllByLabelText("Armada and Jesthaen: Allies (+2)").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Advance week" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Worsen/ })).toBeNull();
  expect(screen.client.subscribed).toEqual(["trackers/fiveBanners:state"]);
  expectNoGm(screen);
});

test("a player with nothing revealed sees the empty Five Banners line", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("five-banners-burning", "player")} />, {
    queries: { "trackers/fiveBanners:state": { role: "player", week: 1, relationships: [], nations: [] } },
  });
  expect(screen.getByText(/hasn.t revealed any relationships or objectives yet/)).toBeTruthy();
  expectNoGm(screen);
});

test("the GM worsens a nation relationship", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(<CampaignFramePanels campaign={table("five-banners-burning", "gm")} />, {
    queries: {
      "trackers/fiveBanners:state": {
        role: "gm",
        week: 2,
        relationships: [{ a: "armada", b: "jesthaen", value: 2, label: "Allies", rating: "+2", revealed: true }],
        nations: [],
      },
    },
    mutations: {
      "trackers/fiveBanners:setRelationship": (args) => {
        seen.push(args);
        return { previousValue: 2, newValue: 1 };
      },
    },
  });
  await fireEvent.press(screen.getAllByLabelText(/Armada and Jesthaen: Allies/)[0]!);
  await fireEvent.press(screen.getByRole("button", { name: /Worsen Armada.Jesthaen relationship/ }));
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1", a: "armada", b: "jesthaen", value: 1 });
  expect(screen.client.called).toContain("trackers/fiveBanners:setRelationship");
});

test("a player reads Soul Echoes and occurred disasters", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("journey-to-horizon", "player")} />, {
    queries: {
      "trackers/horizon:get": {
        role: "player",
        echoesCollected: 3,
        occurred: [{ id: "1a", tier: 1, text: "Bandits and marauders harry travelers." }],
      },
    },
  });
  expect(screen.getByText(/3 of 10 collected/)).toBeTruthy();
  expect(screen.getByText(/Bandits and marauders harry travelers/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Soul Echo 4 of 10" })).toBeNull();
  expect(screen.queryByText("GM only")).toBeNull();
  expect(screen.client.subscribed).toEqual(["trackers/horizon:get"]);
  expectNoGm(screen);
});

test("the GM sets Soul Echoes", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(<CampaignFramePanels campaign={table("journey-to-horizon", "gm")} />, {
    queries: {
      "trackers/horizon:get": { role: "gm", partyTier: 1, echoesCollected: 3, boxes: {} },
      "sessionRecords:list": [],
    },
    mutations: {
      "trackers/horizon:setEchoes": (args) => {
        seen.push(args);
        return { previousValue: 3, newValue: 4, levelUps: 1, horizonUnlocked: false };
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Soul Echo 4 of 10" }));
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1", value: 4 });
  expect(screen.getByText("The party levels up.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["trackers/horizon:get", "sessionRecords:list"]);
});

test("a Weredragon player rolls the night sky and submits a secret", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("reign-of-the-weredragon", "player")} />, {
    queries: {
      "trackers/weredragon:get": {
        role: "player",
        revelations: [
          { kind: "secret", die: null, text: "", status: "hidden" },
          { kind: "ally", die: 3, text: "A ranger in the pines.", status: "revealed" },
          { kind: "key1", die: null, text: "", status: "hidden" },
          { kind: "key2", die: null, text: "", status: "hidden" },
          { kind: "showdown", die: null, text: "", status: "hidden" },
        ],
        secrets: [],
        pendingRoll: null,
        showdownReady: false,
      },
    },
    mutations: {
      "trackers/weredragon:readNightSky": (args) => {
        seen.push(args);
        return { roll: [1, 2, 3, 4, 5] };
      },
      "trackers/weredragon:submitSecret": (args) => {
        seen.push(args);
        return { secretId: "s1" };
      },
    },
  });
  expect(screen.getAllByText("Not yet revealed.").length).toBeGreaterThan(0);
  expect(screen.getByText("A ranger in the pines.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Apply reading" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Roll the night sky" }));
  await fireEvent.changeText(screen.getByLabelText("Secret Forlorne is hiding"), "The crown is glass.");
  await fireEvent.press(screen.getByRole("button", { name: "Submit secret" }));
  expect(screen.client.called).toEqual(["trackers/weredragon:readNightSky", "trackers/weredragon:submitSecret"]);
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1" });
  expect(seen[1]).toMatchObject({ campaignId: "campaign-1", text: "The crown is glass." });
  expectNoGm(screen);
});

test("a Weredragon player waits while a roll is unplaced", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("reign-of-the-weredragon", "player")} />, {
    queries: {
      "trackers/weredragon:get": {
        role: "player",
        revelations: [
          { kind: "secret", die: null, text: "", status: "hidden" },
          { kind: "ally", die: null, text: "", status: "hidden" },
          { kind: "key1", die: null, text: "", status: "hidden" },
          { kind: "key2", die: null, text: "", status: "hidden" },
          { kind: "showdown", die: null, text: "", status: "hidden" },
        ],
        secrets: [{ id: "s1", authorId: "p", text: "Old secret", used: false, authorName: null, createdAt: 1 }],
        pendingRoll: [6, 5, 4, 3, 2],
        showdownReady: false,
      },
    },
  });
  expect(screen.getByTestId("night-sky-roll")).toHaveTextContent("6 · 5 · 4 · 3 · 2");
  expect(screen.getByRole("button", { name: "Roll the night sky" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Apply reading" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /Used:/ })).toBeNull();
  expect(screen.getByText("Old secret")).toBeTruthy();
  expectNoGm(screen);
});

test("the GM applies a night-sky reading", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(<CampaignFramePanels campaign={table("reign-of-the-weredragon", "gm")} />, {
    queries: {
      "trackers/weredragon:get": {
        role: "gm",
        revelations: [
          { kind: "secret", die: null, text: "", status: "hidden" },
          { kind: "ally", die: null, text: "", status: "hidden" },
          { kind: "key1", die: null, text: "", status: "hidden" },
          { kind: "key2", die: null, text: "", status: "hidden" },
          { kind: "showdown", die: null, text: "", status: "hidden" },
        ],
        secrets: [],
        pendingRoll: [1, 2, 3, 4, 5],
        showdownReady: false,
      },
    },
    mutations: {
      "trackers/weredragon:assignReading": (args) => {
        seen.push(args);
        return { clashes: [] };
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Apply reading" }));
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1", assignment: [0, 1, 2, 3, 4] });
  expect(screen.client.called).toContain("trackers/weredragon:assignReading");
});

test("a player reads Wither tokens and cannot end the session", async () => {
  const screen = await renderAsPlayer(<CampaignFramePanels campaign={table("witherwild", "player")} />, {
    queries: {
      "charactersReads:partySummary": [
        partySummaryRow({ _id: "char-1", corrupt: false, sheet: { wither: 3 } }),
        partySummaryRow({ _id: "char-2", corrupt: true, sheet: { wither: 9 } }),
        partySummaryRow({ _id: "char-3", sheet: { wither: 2 } }),
      ],
    },
  });
  expect(screen.getByText("Wither Tokens")).toBeTruthy();
  expect(screen.getByTestId("wither-panel-count")).toHaveTextContent("5 on sheets · 15 in pool");
  expect(screen.getByText(/clear all Wither tokens/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /End Session/ })).toBeNull();
  expect(screen.client.subscribed).toEqual(["charactersReads:partySummary"]);
  expectNoGm(screen);
});

test("the GM ends a Witherwild session and converts tokens to Fear", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(<CampaignFramePanels campaign={table("witherwild", "gm")} />, {
    queries: {
      "charactersReads:partySummary": [partySummaryRow({ sheet: { wither: 4 } })],
      "sessions:current": { startedAt: 1, extraCharacters: true },
    },
    mutations: {
      "sessions:end": (args) => {
        seen.push(args);
        return { tokens: 4, fearGained: 4, fearLost: 0, journeyEnds: [], entryId: null };
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "End Session · convert 4 to Fear" }));
  expect(screen.getByText(/Extra characters are no longer allowed/)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "End session" }));
  expect(seen[0]).toMatchObject({ campaignId: "campaign-1", convertWither: true });
  expect(screen.getByText("Session ended. 4 Wither tokens → +4 Fear.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["charactersReads:partySummary", "sessions:current"]);
  expect(screen.client.called).toEqual(["sessions:end"]);
});

test("the house rule keeps Wither when the GM ends the session", async () => {
  const seen: unknown[] = [];
  const screen = await renderAsGm(
    <CampaignFramePanels campaign={table("witherwild", "gm", { witherPersists: true })} />,
    {
      queries: {
        "charactersReads:partySummary": [partySummaryRow({ sheet: { wither: 1 } })],
        "sessions:current": { startedAt: 1, extraCharacters: false },
      },
      mutations: {
        "sessions:end": (args) => {
          seen.push(args);
          return { tokens: 0, witherKept: 1, fearGained: 0, fearLost: 0, journeyEnds: [], entryId: null };
        },
      },
    },
  );
  expect(screen.getByText("House rule: Wither stays on the sheets across sessions.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "End Session · keep Wither" }));
  await fireEvent.press(screen.getByRole("button", { name: "End session" }));
  expect(seen[0]).toMatchObject({ convertWither: false });
  expect(screen.getByText("1 Wither token stay on the sheets.")).toBeTruthy();
});
