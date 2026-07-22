import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CampaignTimeline,
  CampaignTimelineEmpty,
  CampaignTimelineFallback,
} from "@/components/campaign-timeline/campaign-timeline";

describe("CampaignTimeline", () => {
  it("shows the week, cycle, and current phase summary", () => {
    render(
      <CampaignTimeline
        current={{ currentWeek: 3, currentCycle: "DAY", currentCycleDay: 4 }}
      />,
    );

    const region = screen.getByRole("region", { name: "Campaign timeline" });
    expect(region).toHaveTextContent("Week 3");
    expect(region).toHaveTextContent("Day Cycle");
    expect(region).toHaveTextContent("Forenoon");
  });

  it("renders all seven Day cycle phases with completed/current/upcoming status", () => {
    render(
      <CampaignTimeline
        current={{ currentWeek: 3, currentCycle: "DAY", currentCycleDay: 4 }}
      />,
    );

    const list = screen.getByRole("list", { name: "Day Cycle phases" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(7);

    // Status is conveyed in the accessible name (not by color alone).
    expect(
      within(list).getByRole("listitem", { name: "Day 1, Dawn, completed" }),
    ).toBeInTheDocument();
    const current = within(list).getByRole("listitem", {
      name: "Day 4, Forenoon, current phase",
    });
    expect(current).toHaveAttribute("aria-current", "step");
    expect(
      within(list).getByRole("listitem", {
        name: "Day 7, Civil Twilight, upcoming",
      }),
    ).toBeInTheDocument();
  });

  it("marks exactly one phase as current", () => {
    render(
      <CampaignTimeline
        current={{ currentWeek: 1, currentCycle: "DAY", currentCycleDay: 1 }}
      />,
    );
    const list = screen.getByRole("list", { name: "Day Cycle phases" });
    const currents = within(list)
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-current") === "step");
    expect(currents).toHaveLength(1);
    expect(currents[0]).toHaveAccessibleName("Day 1, Dawn, current phase");
  });

  it("renders the Night cycle phases when the cycle is NIGHT", () => {
    render(
      <CampaignTimeline
        current={{ currentWeek: 5, currentCycle: "NIGHT", currentCycleDay: 1 }}
      />,
    );

    const region = screen.getByRole("region", { name: "Campaign timeline" });
    expect(region).toHaveTextContent("Night Cycle");
    expect(region).toHaveTextContent("Nautical Twilight");

    const list = screen.getByRole("list", { name: "Night Cycle phases" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(
      within(list).getByRole("listitem", {
        name: "Day 7, Pre-Dawn, upcoming",
      }),
    ).toBeInTheDocument();
  });

  it("contains no interactive controls (display-only, no advancement)", () => {
    render(
      <CampaignTimeline
        current={{ currentWeek: 2, currentCycle: "NIGHT", currentCycleDay: 3 }}
      />,
    );
    const region = screen.getByRole("region", { name: "Campaign timeline" });
    expect(within(region).queryByRole("button")).toBeNull();
    expect(within(region).queryByRole("link")).toBeNull();
  });
});

describe("CampaignTimelineFallback", () => {
  it("shows a neutral loading state with no fabricated Week 1 value", () => {
    render(<CampaignTimelineFallback />);
    const region = screen.getByRole("region", { name: "Campaign timeline" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Loading campaign time");
    expect(region).not.toHaveTextContent(/Week \d/);
  });
});

describe("CampaignTimelineEmpty", () => {
  it("shows a neutral no-campaign state without the misleading wording", () => {
    render(<CampaignTimelineEmpty />);
    const region = screen.getByRole("region", { name: "Campaign timeline" });
    expect(region).toHaveTextContent("No campaign yet");
    expect(region).not.toHaveTextContent("No active campaign");
  });
});
