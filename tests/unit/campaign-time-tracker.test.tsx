import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CampaignTimeTracker } from "@/components/campaign-time/campaign-time-tracker";
import type { CampaignTimeData } from "@/lib/data/campaign-time";

vi.mock("@/app/(app)/dashboard/campaign-time-actions", () => ({
  changeCampaignTimeAction: vi.fn(),
}));

const campaignId = "11111111-1111-4111-8111-111111111111";
const initialIdempotencyKey = "22222222-2222-4222-8222-222222222222";

function makeData(): CampaignTimeData {
  return {
    current: {
      currentWeek: 1,
      currentCycle: "DAY",
      currentCycleDay: 1,
    },
    history: [],
  };
}

describe("CampaignTimeTracker", () => {
  it("shows canonical time, the full cycle, and a write-free advance preview", () => {
    render(
      <CampaignTimeTracker
        campaignId={campaignId}
        initialIdempotencyKey={initialIdempotencyKey}
        data={makeData()}
      />,
    );

    expect(
      screen.getByText("Week 1 • Day Cycle • Dawn", { selector: "output" }),
    ).toBeVisible();
    expect(screen.getByText("Cycle day 1 of 7")).toBeVisible();
    expect(screen.getByRole("list", { name: "Day Cycle phases" })).toHaveTextContent(
      "Day 1DawnDay 2SunriseDay 3MorningDay 4ForenoonDay 5MiddayDay 6AfternoonDay 7Civil Twilight",
    );
    expect(screen.getByText("Preview — no changes yet")).toBeVisible();
    expect(screen.getByText("Week 1 • Day Cycle • Sunrise")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm advance one day" }),
    ).toBeEnabled();
    expect(screen.getByText("No campaign-time changes yet")).toBeVisible();
  });

  it("previews a valid correction and enables its compensating commit", async () => {
    const user = userEvent.setup();
    render(
      <CampaignTimeTracker
        campaignId={campaignId}
        initialIdempotencyKey={initialIdempotencyKey}
        data={makeData()}
      />,
    );

    await user.click(screen.getByText("Correct campaign time"));
    const commit = screen.getByRole("button", { name: "Commit correction" });
    expect(commit).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Cycle"), "NIGHT");
    await user.clear(screen.getByLabelText("Cycle day"));
    await user.type(screen.getByLabelText("Cycle day"), "7");

    expect(
      screen.getByText("Week 1 • Night Cycle • Pre-Dawn"),
    ).toBeVisible();
    expect(commit).toBeEnabled();
  });

  it("renders preserved transition and correction history", () => {
    const data = makeData();
    data.history = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        operationId: "44444444-4444-4444-8444-444444444444",
        eventType: "correction",
        previous: {
          currentWeek: 2,
          currentCycle: "NIGHT",
          currentCycleDay: 1,
        },
        next: data.current,
        note: "The prior advance was recorded accidentally.",
        correctsEventId: "55555555-5555-4555-8555-555555555555",
        createdAt: "2026-07-19T12:00:00.000Z",
      },
    ];

    render(
      <CampaignTimeTracker
        campaignId={campaignId}
        initialIdempotencyKey={initialIdempotencyKey}
        data={data}
      />,
    );

    expect(
      screen.getByRole("list", { name: "Recent campaign-time changes" }),
    ).toBeVisible();
    expect(screen.getByText("Compensating event")).toBeVisible();
    expect(
      screen.getByText("The prior advance was recorded accidentally."),
    ).toBeVisible();
    expect(screen.getByText("Week 2 • Night Cycle • Nautical Twilight")).toBeVisible();
  });
});
