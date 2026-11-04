// Plan config U3p (Q11 b): the campaign tab's presence beat hands our convex/presence.ts functions to the component's
// usePresence hook (room = campaign id; the library owns the timer), and the GM's Players section marks each member
// Online / Away from presence.list.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";

const CAMPAIGN = "c1" as Id<"campaigns">;
const ANA = "u-ana" as Id<"users">;
const IVA = "u-iva" as Id<"users">;
const LUKA = "u-luka" as Id<"users">;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const results: Record<string, unknown> = {};
const queryArgs: Record<string, unknown> = {};
const mutations: string[] = [];
const presenceCalls: unknown[][] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    queryArgs[functionName(ref)] = args;
    return args === "skip" ? undefined : results[functionName(ref)];
  },
  useMutation: (ref: unknown) => {
    mutations.push(functionName(ref));
    return () => Promise.resolve(null);
  },
}));

vi.mock("@convex-dev/presence/react", () => ({
  default: (...args: unknown[]) => {
    presenceCalls.push(args);
    return undefined;
  },
}));

const { PresenceBeat } = await import("@/components/config/presence-beat");
const { PresenceSlot } = await import("@/components/config/sections/players/presence");

beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key];
  for (const key of Object.keys(queryArgs)) delete queryArgs[key];
  mutations.length = 0;
  presenceCalls.length = 0;
});

describe("PresenceBeat", () => {
  it("hands heartbeat, disconnect and the roomList stub to usePresence with the campaign as the room", () => {
    const { container } = render(<PresenceBeat campaignId={CAMPAIGN} />);
    expect(container).toBeEmptyDOMElement();
    expect(presenceCalls).toHaveLength(1);
    const [api, roomId, , interval] = presenceCalls[0] as [Record<string, unknown>, string, string, unknown];
    expect(functionName(api.heartbeat)).toBe("presence:heartbeat");
    expect(functionName(api.disconnect)).toBe("presence:disconnect");
    expect(functionName(api.list)).toBe("presence:roomList");
    expect(roomId).toBe(CAMPAIGN);
    // The library's default interval; no timer or mutation of our own.
    expect(interval).toBeUndefined();
    expect(mutations).toEqual([]);
  });
});

describe("PresenceSlot", () => {
  const renderRows = () =>
    render(
      <ul>
        {[ANA, IVA, LUKA].map((userId) => (
          <li key={userId} data-testid={userId}>
            <PresenceSlot campaignId={CAMPAIGN} userId={userId} />
          </li>
        ))}
      </ul>,
    );

  it("renders nothing while the list loads", () => {
    renderRows();
    expect(screen.queryByText("Online")).toBeNull();
    expect(screen.queryByText("Away")).toBeNull();
    expect(queryArgs["presence:list"]).toEqual({ campaignId: CAMPAIGN });
  });

  it("marks online members Online and the rest (offline or never seen) Away", () => {
    results["presence:list"] = [
      { userId: ANA, online: true },
      { userId: IVA, online: false },
    ];
    renderRows();
    expect(screen.getByTestId(ANA)).toHaveTextContent("Online");
    expect(screen.getByTestId(IVA)).toHaveTextContent("Away");
    expect(screen.getByTestId(LUKA)).toHaveTextContent("Away");
    expect(screen.getByTestId(ANA).querySelector("[data-presence]")).toHaveAttribute("data-presence", "online");
  });
});
