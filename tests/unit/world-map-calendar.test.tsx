// Plan world-journey MC1: the World map shows the campaign calendar - the Witherwild arc or the day card - with the
// dashboard's read-only rule (only the GM, outside the app owner's view, may End day).
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";

vi.mock("@/app/(gm)/campaigns/[campaignId]/time-arc", () => ({
  TimeArc: ({ readOnly }: { readOnly?: boolean }) => <div data-testid="arc" data-readonly={String(readOnly)} />,
}));
vi.mock("@/app/(gm)/campaigns/[campaignId]/time-of-day", () => ({
  DayCard: ({ readOnly }: { readOnly?: boolean }) => <div data-testid="day" data-readonly={String(readOnly)} />,
}));

const { MapCalendar, mapCalendarFor } = await import("@/app/(gm)/campaigns/[campaignId]/world/map-calendar");

type Campaign = Parameters<typeof mapCalendarFor>[0];
const base: Campaign = { _id: "c1" as Id<"campaigns">, frameId: "witherwild", role: "gm", ownerView: false };

describe("mapCalendarFor", () => {
  it("picks the arc for the Witherwild and the day card for other frames", () => {
    expect(mapCalendarFor(base).kind).toBe("arc");
    expect(mapCalendarFor({ ...base, frameId: "beast-feast" }).kind).toBe("day");
    expect(mapCalendarFor({ ...base, frameId: "custom" }).kind).toBe("day");
  });

  it("is editable only for the GM outside the owner's read-only view", () => {
    expect(mapCalendarFor(base).readOnly).toBe(false);
    expect(mapCalendarFor({ ...base, role: "player" }).readOnly).toBe(true);
    expect(mapCalendarFor({ ...base, ownerView: true }).readOnly).toBe(true);
  });
});

describe("MapCalendar", () => {
  it("renders the arc for the Witherwild GM, editable", () => {
    render(<MapCalendar campaign={base} />);
    expect(screen.getByTestId("arc").dataset.readonly).toBe("false");
    expect(screen.queryByTestId("day")).toBeNull();
  });

  it("renders the day card read-only for a player of another frame", () => {
    render(<MapCalendar campaign={{ ...base, frameId: "beast-feast", role: "player" }} />);
    expect(screen.getByTestId("day").dataset.readonly).toBe("true");
    expect(screen.queryByTestId("arc")).toBeNull();
  });
});
