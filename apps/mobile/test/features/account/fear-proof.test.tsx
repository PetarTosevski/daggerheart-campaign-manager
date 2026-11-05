import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, render } from "@testing-library/react-native";

import CampaignScreen from "../../../app/(auth)/campaign";

const mockFear = {
  value: 4,
  listeners: new Set<() => void>(),
  fearArgs: [] as unknown[],
};

jest.mock("convex/react", () => {
  // jest.mock is hoisted above imports, so the factory cannot reference them.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getFunctionName } = require("convex/server") as typeof import("convex/server");
  return {
    useQuery: (ref: unknown, args?: unknown) => {
      const [, setVersion] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setVersion((version) => version + 1);
        mockFear.listeners.add(listener);
        return () => {
          mockFear.listeners.delete(listener);
        };
      }, []);
      const name = getFunctionName(ref as never);
      if (name === "campaigns:list") {
        return [{ _id: "campaign-1", name: "The Table", fear: 99 }];
      }
      if (name === "campaigns:fear") {
        mockFear.fearArgs.push(args);
        return mockFear.value;
      }
      return undefined;
    },
  };
});

beforeEach(() => {
  mockFear.value = 4;
  mockFear.listeners.clear();
  mockFear.fearArgs = [];
});

test("shows Fear from campaigns.fear and updates when that result changes", async () => {
  const screen = await render(<CampaignScreen />);
  expect(screen.getByText("4")).toBeTruthy();
  expect(screen.queryByText("99")).toBeNull();
  expect(mockFear.fearArgs.at(-1)).toEqual({ campaignId: "campaign-1" });

  mockFear.value = 11;
  await act(async () => {
    for (const listener of mockFear.listeners) listener();
  });

  expect(screen.getByText("11")).toBeTruthy();
  expect(screen.queryByText("4")).toBeNull();
  expect(screen.queryByText("99")).toBeNull();
});
