import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CharacterWorkspace } from "@/components/characters/character-workspace";
import type { CharacterWorkspaceData } from "@/lib/data/characters";

vi.mock("@/app/(app)/characters/actions", () => ({
  updateCharacterAction: vi.fn(),
}));

function makeData(
  overrides: Partial<CharacterWorkspaceData> = {},
): CharacterWorkspaceData {
  return {
    campaign: { id: "11111111-1111-4111-8111-111111111111", name: "Demo" },
    character: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Kodak",
      status: "active",
      notes: "loyal to the refuge",
      created_at: "2026-07-19T08:00:00.000Z",
      updated_at: "2026-07-19T08:00:00.000Z",
    },
    class: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Guardian",
      description: null,
    },
    template: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Guardian sheet",
      is_blank_template: false,
      status: "active",
    },
    ...overrides,
  };
}

describe("CharacterWorkspace", () => {
  it("shows the overview with class and template metadata by default", () => {
    render(<CharacterWorkspace data={makeData()} />);

    expect(
      screen.getByRole("button", { name: "Save overview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Guardian")).toBeInTheDocument();
    expect(screen.getByText("Guardian sheet")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kodak")).toBeInTheDocument();
  });

  it("switches to the notes section and shows persisted notes", async () => {
    const user = userEvent.setup();
    render(<CharacterWorkspace data={makeData()} />);

    await user.click(screen.getByRole("button", { name: "Notes" }));

    expect(
      screen.getByRole("button", { name: "Save notes" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("loyal to the refuge")).toBeInTheDocument();
  });

  it("renders a coming-soon placeholder for unimplemented sections", async () => {
    const user = userEvent.setup();
    render(<CharacterWorkspace data={makeData()} />);

    await user.click(screen.getByRole("button", { name: /Inventory/ }));

    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByText(/is planned for a future task/i)).toBeInTheDocument();
  });
});
