import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CountdownCard } from "@/components/countdowns/countdown-card";
import type { CountdownSummary } from "@/lib/data/countdowns";

vi.mock("@/app/(app)/dashboard/countdown-actions", () => ({
  operateCountdownAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const initialIdempotencyKey = "11111111-1111-4111-8111-111111111111";

function makeCountdown(
  overrides: Partial<CountdownSummary> = {},
): CountdownSummary {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Encroaching blight",
    description: "The forest closes in.",
    category: "threat",
    current_value: 2,
    starting_value: 4,
    status: "active",
    consequence: "The refuge is surrounded.",
    completed_at: null,
    created_at: "2026-07-19T08:00:00.000Z",
    events: [],
    ...overrides,
  };
}

describe("CountdownCard", () => {
  it("renders an active countdown with accessible value and controls", () => {
    render(
      <CountdownCard
        countdown={makeCountdown()}
        initialIdempotencyKey={initialIdempotencyKey}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(
      screen.getByRole("button", { name: "Advance Encroaching blight by 1" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Reverse Encroaching blight by 1" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Pause Encroaching blight" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Cancel Encroaching blight" }),
    ).toBeEnabled();
  });

  it("allows a completed countdown to reopen but blocks other transitions", () => {
    render(
      <CountdownCard
        countdown={makeCountdown({
          current_value: 0,
          status: "completed",
          completed_at: "2026-07-19T09:00:00.000Z",
        })}
        initialIdempotencyKey={initialIdempotencyKey}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Advance Encroaching blight by 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reverse Encroaching blight by 1" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Pause Encroaching blight" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel Encroaching blight" }),
    ).toBeDisabled();
  });

  it("shows transition history and optional reasons", () => {
    render(
      <CountdownCard
        countdown={makeCountdown({
          current_value: 1,
          events: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              countdown_id: "22222222-2222-4222-8222-222222222222",
              change_amount: -1,
              event_type: "advance",
              reason: "The party lost time.",
              previous_value: 2,
              new_value: 1,
              previous_status: "active",
              new_status: "active",
              created_at: "2026-07-19T08:30:00.000Z",
            },
          ],
        })}
        initialIdempotencyKey={initialIdempotencyKey}
      />,
    );

    expect(screen.getByText("Event history (1)")).toBeVisible();
    expect(screen.getByText("2 → 1")).toBeInTheDocument();
    expect(screen.getByText("The party lost time.")).toBeInTheDocument();
  });
});
