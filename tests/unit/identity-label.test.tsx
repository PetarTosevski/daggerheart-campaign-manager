import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PronounsField } from "@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sections/identity";
import { InfoStep } from "@/app/(gm)/campaigns/[campaignId]/party/new/steps-1-4";
import { emptyWizard, restoreWizard, toCharacterDraft, type WizardState } from "@/app/(gm)/campaigns/[campaignId]/party/new/wizard-logic";
import { ReviewForm } from "@/components/party/import/review";
import { characterSheetSchema, pronounsFieldLabel, sheetPatchSchema, type PronounsLabel } from "@/lib/validation/characters";

import type { Id } from "../../convex/_generated/dataModel";
import { validDraft } from "../fixtures/photo-import";

// dcm-bxp.35 (F9): the pronouns field reads "Gender" by default; a per-character switch labels it "Pronouns".

const sheetState = vi.hoisted(() => ({
  sheet: { pronouns: "she/her", pronounsLabel: undefined as PronounsLabel | undefined },
  canEdit: true,
  update: vi.fn(),
}));

vi.mock("@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet-context", () => ({
  useSheet: () => sheetState,
}));

const guardian: WizardState = {
  ...emptyWizard(),
  classId: "guardian",
  subclassId: "stalwart",
  ancestryMode: "single",
  ancestryId: "dwarf",
  communityId: "ridgeborne",
};

const labelSwitch = () => screen.getByRole("switch", { name: "Label as Pronouns" });

describe("pronounsFieldLabel and the sheet flag", () => {
  it("defaults to Gender and widens the sheet without a version bump", () => {
    expect(pronounsFieldLabel(undefined)).toBe("Gender");
    expect(pronounsFieldLabel("gender")).toBe("Gender");
    expect(pronounsFieldLabel("pronouns")).toBe("Pronouns");
    expect(characterSheetSchema.shape.pronounsLabel.safeParse(undefined).success).toBe(true);
    expect(characterSheetSchema.shape.pronounsLabel.safeParse("they").success).toBe(false);
    expect(sheetPatchSchema.parse({ pronounsLabel: "pronouns" })).toEqual({ pronounsLabel: "pronouns" });
  });
});

describe("character sheet identity field", () => {
  beforeEach(() => {
    sheetState.sheet = { pronouns: "she/her", pronounsLabel: undefined };
    sheetState.canEdit = true;
    sheetState.update = vi.fn().mockResolvedValue(true);
  });

  it("reads Gender by default and the switch sends only the label", async () => {
    render(<PronounsField />);
    expect(screen.getByLabelText("Gender")).toHaveValue("she/her");
    expect(labelSwitch()).toHaveAttribute("aria-checked", "false");
    await act(async () => {
      fireEvent.click(labelSwitch());
    });
    expect(sheetState.update).toHaveBeenCalledExactlyOnceWith({ pronounsLabel: "pronouns" });
  });

  it("shows the new label while the switch saves", () => {
    sheetState.update = vi.fn(() => new Promise<boolean>(() => {}));
    render(<PronounsField />);
    fireEvent.click(labelSwitch());
    expect(screen.getByLabelText("Pronouns")).toHaveValue("she/her");
    expect(labelSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("reads Pronouns when the character chose it, and switches back to Gender", async () => {
    sheetState.sheet = { pronouns: "they/them", pronounsLabel: "pronouns" };
    render(<PronounsField />);
    expect(screen.getByLabelText("Pronouns")).toHaveValue("they/them");
    expect(labelSwitch()).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      fireEvent.click(labelSwitch());
    });
    expect(sheetState.update).toHaveBeenCalledExactlyOnceWith({ pronounsLabel: "gender" });
  });

  it("shows read-only viewers the stored label without a switch", () => {
    sheetState.canEdit = false;
    sheetState.sheet = { pronouns: "they/them", pronounsLabel: "pronouns" };
    const { unmount } = render(<PronounsField />);
    expect(screen.getByText("Pronouns")).toBeInTheDocument();
    expect(screen.getByText("they/them")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    unmount();
    sheetState.sheet = { pronouns: "they/them", pronounsLabel: undefined };
    render(<PronounsField />);
    expect(screen.getByText("Gender")).toBeInTheDocument();
    expect(screen.queryByText("Pronouns")).toBeNull();
  });
});

describe("creation wizard step 4", () => {
  it("labels the field Gender by default and the switch relabels it", () => {
    const update = vi.fn();
    const { rerender } = render(<InfoStep state={guardian} update={update} opts={{ hopeAndFear: false }} />);
    expect(screen.getByLabelText("Gender")).toBeInTheDocument();
    expect(labelSwitch()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(labelSwitch());
    expect(update).toHaveBeenLastCalledWith({ pronounsLabel: "pronouns" });
    rerender(<InfoStep state={{ ...guardian, pronounsLabel: "pronouns" }} update={update} opts={{ hopeAndFear: false }} />);
    expect(screen.getByLabelText("Pronouns")).toBeInTheDocument();
    expect(labelSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("restores the choice and sends it with the draft only when it is Pronouns", () => {
    expect(emptyWizard().pronounsLabel).toBe("gender");
    expect(restoreWizard({ pronounsLabel: "pronouns" }).pronounsLabel).toBe("pronouns");
    expect(restoreWizard({ pronounsLabel: "bogus" }).pronounsLabel).toBe("gender");
    expect(toCharacterDraft(guardian, null)).not.toHaveProperty("pronounsLabel");
    expect(toCharacterDraft({ ...guardian, pronounsLabel: "pronouns" }, null)).toMatchObject({ pronounsLabel: "pronouns" });
  });
});

describe("photo import review", () => {
  it("labels the field Gender", () => {
    render(
      <ReviewForm
        initial={validDraft()}
        unreadable={[]}
        unmatched={[]}
        hopeAndFear={false}
        owners={[{ userId: "gm" as Id<"users">, name: "GM" }]}
        saving={false}
        error={null}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Gender")).toHaveValue(validDraft().pronouns);
    expect(screen.queryByLabelText("Pronouns")).toBeNull();
  });
});
