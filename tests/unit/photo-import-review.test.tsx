import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewForm, type Owner } from "@/components/party/import/review";

import type { Id } from "../../convex/_generated/dataModel";
import { validDraft } from "../fixtures/photo-import";

const GM = "gm-id" as Id<"users">;
const PLAYER = "player-id" as Id<"users">;
const OWNERS: Owner[] = [
  { userId: GM, name: "Gail (GM)" },
  { userId: PLAYER, name: "Pip" },
];

function renderForm(props: Partial<Parameters<typeof ReviewForm>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <ReviewForm
      initial={validDraft({ name: "" })}
      unreadable={["name"]}
      unmatched={[{ field: "domainCards.3", text: "Sword Dance" }]}
      hopeAndFear={false}
      owners={OWNERS}
      defaultOwner={GM}
      saving={false}
      error={null}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave, save: () => screen.getByRole("button", { name: "Save character" }) };
}

describe("photo import review", () => {
  it("keeps Save disabled until the sheet validates, then saves the edited draft for the chosen owner", () => {
    const { onSave, save } = renderForm();
    expect(save()).toBeDisabled();
    expect(screen.getByText("Couldn't be read. Check it.")).toBeInTheDocument();
    expect(screen.getByText(/Couldn't match: “Sword Dance”/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Brenna" } });
    expect(save()).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: PLAYER } });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Brenna", level: 5 }), PLAYER);
  });

  it("disables Save again for a rules problem and shows why", () => {
    const { save } = renderForm({ initial: validDraft() });
    expect(save()).toBeEnabled();
    // Level 4 is Tier 2: the Tier 3 Advanced Broadsword no longer fits.
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "4" } });
    expect(save()).toBeDisabled();
    expect(screen.getByText(/Tier 3/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "x" } });
    expect(save()).toBeDisabled();
  });

  it("needs an owner and is disabled while saving", () => {
    renderForm({ initial: validDraft(), defaultOwner: undefined });
    expect(screen.getByRole("button", { name: "Save character" })).toBeDisabled();
    expect(screen.getByText("Choose who owns the character.")).toBeInTheDocument();
  });

  it("is disabled while saving", () => {
    const { save } = renderForm({ initial: validDraft(), saving: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(() => save()).toThrow();
  });
});
