import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/app/(app)/dashboard/actions", () => ({
  signOutAction: vi.fn(),
}));

import { PrimaryNavigation } from "@/components/layout/primary-navigation";

describe("PrimaryNavigation", () => {
  it("marks the active route with aria-current and exposes a primary nav landmark", () => {
    render(<PrimaryNavigation userEmail="gm@example.com" />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const link = within(nav).getByRole("link", { name: "Campaign" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("exposes a Characters link that is not marked active on the dashboard", () => {
    render(<PrimaryNavigation userEmail="gm@example.com" />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const link = within(nav).getByRole("link", { name: "Characters" });
    expect(link).toHaveAttribute("href", "/characters");
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("shows the signed-in identity and a sign-out control", () => {
    render(<PrimaryNavigation userEmail="gm@example.com" />);
    expect(screen.getByText("Signed in as gm@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });
});
