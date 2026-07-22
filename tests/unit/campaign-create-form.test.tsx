import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CampaignCreateForm } from "@/components/campaign/campaign-create-form";

vi.mock("@/app/(app)/dashboard/campaign-actions", () => ({
  createCampaignAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("CampaignCreateForm (empty-state)", () => {
  it("renders an onboarding empty state with a create-campaign control", () => {
    render(<CampaignCreateForm />);

    expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument();
    expect(screen.getByText(/create your first campaign/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/campaign name/i)).toBeRequired();
    expect(
      screen.getByRole("button", { name: /create campaign/i }),
    ).toBeInTheDocument();
  });

  it("does not use the misleading 'No active campaign' copy", () => {
    render(<CampaignCreateForm />);
    expect(screen.queryByText(/no active campaign/i)).not.toBeInTheDocument();
  });

  it("communicates the canonical starting state to the GM", () => {
    render(<CampaignCreateForm />);
    expect(screen.getByText(/week 1/i)).toBeInTheDocument();
    expect(screen.getByText(/fear 0/i)).toBeInTheDocument();
  });
});
