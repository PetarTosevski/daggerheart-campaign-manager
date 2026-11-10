import "./mocks";
import { webcrypto } from "node:crypto";

import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { GmMapTools } from "../../../src/features/world/edit/gm-tools";
import type { Id } from "../../../src/convex";
import { renderAsGm } from "../../harness";
import { campaignId, mapView } from "../world/fixtures";

beforeEach(() => {
  resetMotionTest();
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  }
});

const data = mapView("gm");
const id = campaignId as Id<"campaigns">;

test("reset terrain calls maps:setTerrain", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(<GmMapTools campaignId={id} data={data} isCustomFrame={false} />, {
    mutations: {
      "maps:setTerrain": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Reset terrain" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ campaignId, reset: true });
});

test("removing a marker calls maps:removeToken", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(<GmMapTools campaignId={id} data={data} isCustomFrame={false} />, {
    mutations: {
      "maps:removeToken": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  await fireEvent.press(screen.getByText("Haven"));
  await fireEvent.press(screen.getByRole("button", { name: "Remove marker" }));
  expect(calls).toEqual([{ campaignId, id: 1 }]);
});

test("picking a marker type arms placement", async () => {
  const screen = await renderAsGm(<GmMapTools campaignId={id} data={data} isCustomFrame={false} />);
  await fireEvent.press(screen.getByRole("button", { name: "Village" }));
  expect(screen.getByRole("button", { selected: true })).toBeTruthy();
});
