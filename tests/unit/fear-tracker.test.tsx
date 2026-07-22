import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FearTracker } from "@/components/fear/fear-tracker";

const { adjustFearActionMock } = vi.hoisted(() => ({
  adjustFearActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/dashboard/fear-actions", () => ({
  adjustFearAction: adjustFearActionMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const campaignId = "11111111-1111-4111-8111-111111111111";
const initialIdempotencyKey = "22222222-2222-4222-8222-222222222222";

describe("FearTracker", () => {
  beforeEach(() => {
    adjustFearActionMock.mockReset();
  });

  it("disables decrease at zero and leaves increase immediately available", () => {
    render(
      <FearTracker
        campaignId={campaignId}
        currentFear={0}
        initialIdempotencyKey={initialIdempotencyKey}
        history={[]}
      />,
    );

    expect(screen.getByLabelText("Current Fear: 0 out of 12")).toBeVisible();
    expect(screen.getByRole("button", { name: "Decrease Fear by 1" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Increase Fear by 1" }),
    ).toBeEnabled();
  });

  it("disables increase at twelve and leaves decrease immediately available", () => {
    render(
      <FearTracker
        campaignId={campaignId}
        currentFear={12}
        initialIdempotencyKey={initialIdempotencyKey}
        history={[]}
      />,
    );

    expect(screen.getByLabelText("Current Fear: 12 out of 12")).toBeVisible();
    expect(screen.getByRole("button", { name: "Increase Fear by 1" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Decrease Fear by 1" }),
    ).toBeEnabled();
  });

  it("renders exactly twelve visual capacity markers", () => {
    render(
      <FearTracker
        campaignId={campaignId}
        currentFear={5}
        initialIdempotencyKey={initialIdempotencyKey}
        history={[]}
      />,
    );
    expect(screen.getByTestId("fear-pips").children).toHaveLength(12);
  });

  it("uses a new idempotency key for each consecutive adjustment", async () => {
    const requestKeys: string[] = [];
    let total = 0;

    adjustFearActionMock.mockImplementation(
      async (_previousState: unknown, formData: FormData) => {
        const requestKey = String(formData.get("idempotencyKey"));
        const amount = formData.get("direction") === "increase" ? 1 : -1;
        const previousValue = total;
        total += amount;
        requestKeys.push(requestKey);

        return {
          status: "success",
          message: `Fear updated to ${total}.`,
          newValue: total,
          requestKey,
          event: {
            id: `event-${requestKeys.length}`,
            amount,
            event_type: "adjustment",
            previous_value: previousValue,
            new_value: total,
            created_at: new Date().toISOString(),
          },
        };
      },
    );

    const user = userEvent.setup();
    render(
      <FearTracker
        campaignId={campaignId}
        currentFear={0}
        initialIdempotencyKey={initialIdempotencyKey}
        history={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Increase Fear by 1" }));
    expect(await screen.findByLabelText("Current Fear: 1 out of 12")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Increase Fear by 1" }));
    expect(await screen.findByLabelText("Current Fear: 2 out of 12")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Decrease Fear by 1" }));
    expect(await screen.findByLabelText("Current Fear: 1 out of 12")).toBeVisible();

    expect(requestKeys).toHaveLength(3);
    expect(new Set(requestKeys).size).toBe(3);
  });
});
