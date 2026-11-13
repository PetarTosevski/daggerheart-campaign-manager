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
    expect(screen.getByText("Couldn't read this: fill it in.")).toBeInTheDocument();
    expect(screen.getByText("Read as “Sword Dance”, which matched nothing: choose it.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Brenna" } });
    expect(save()).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: PLAYER } });
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Brenna", level: 5 }), PLAYER);
  });

  it("flags each kind in red with aria-invalid and its own note; an uncertain guess stays prefilled, an unreadable number is emptied", () => {
    renderForm({
      initial: validDraft(),
      unreadable: ["level", "inventory"],
      uncertain: ["name", "traits.agility", "experiences"],
      unmatched: [{ field: "classId", text: "Warlok" }],
    });
    const described = (label: string) => {
      const control = screen.getByLabelText(label);
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control.className).toMatch(/border-danger/);
      return document.getElementById(control.getAttribute("aria-describedby")!)?.textContent;
    };

    // Uncertain: Claude's guess kept.
    expect(screen.getByLabelText("Name")).toHaveValue("Brenna Ashfall");
    expect(described("Name")).toBe("Not sure this is right: check it against the sheet.");
    expect(screen.getByLabelText("Agility")).toHaveValue("2");
    expect(described("Agility")).toBe("Not sure this is right: check it against the sheet.");
    // Unreadable: empty, to fill in (Save waits for it).
    expect(screen.getByLabelText("Level")).toHaveValue("");
    expect(described("Level")).toBe("Couldn't read this: fill it in.");
    expect(described("Inventory (one item per line)")).toBe("Couldn't read this: fill it in.");
    // Unmatched: what was read, to choose.
    expect(described("Class")).toBe("Read as “Warlok”, which matched nothing: choose it.");
    // A list flag shows on its fieldset.
    expect(screen.getByRole("group", { name: "Experiences" })).toHaveAccessibleDescription("Not sure this is right: check it against the sheet.");
    // Unflagged fields stay plain.
    expect(screen.getByLabelText("Strength")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Check every field against the paper sheet. Fields in red need your input.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save character" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "5" } });
    expect(screen.getByRole("button", { name: "Save character" })).toBeEnabled();
  });

  it("opens a blank reading with the top note and every field red", () => {
    renderForm({
      initial: validDraft({ name: "", classId: "", subclassId: "", primaryWeaponId: "", experiences: [], domainCards: [], inventory: [] }),
      unreadable: ["name", "level", "classId", "gold.chest", "domainCards", "experiences", "inventory"],
      unmatched: [],
      blank: true,
    });
    expect(screen.getByText("Claude couldn't read anything from these photos. Fill in the sheet by hand.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Chest of gold")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: "Domain cards" })).toHaveAccessibleDescription("Couldn't read this: fill it in.");
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
    renderForm({ initial: validDraft(), saving: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    // queryByRole, not a throwing getByRole: the miss error prints the whole form and its role list, which took seconds.
    expect(screen.queryByRole("button", { name: "Save character" })).toBeNull();
  });
});
