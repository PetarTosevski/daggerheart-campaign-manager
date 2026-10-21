import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ClassStep,
  HeritageStep,
  InfoStep,
  TraitsStep,
} from "@/app/(gm)/campaigns/[campaignId]/party/new/steps-1-4";
import {
  BackgroundStep,
  ConnectionsStep,
  DomainCardsStep,
  EquipmentStep,
  ExperiencesStep,
} from "@/app/(gm)/campaigns/[campaignId]/party/new/steps-5-9";
import { emptyWizard, type WizardState } from "@/app/(gm)/campaigns/[campaignId]/party/new/wizard-logic";

// Radios are found by their label: getByRole computes the accessible name, and so getComputedStyle up the tree, of
// every class, subclass and gear radio for each lookup, which is slow in jsdom under the full parallel run (dcm-t30).
const RADIO = { selector: "input[type=radio]" };

const CORE = { hopeAndFear: false };
const ALL = { hopeAndFear: true };

const guardian: WizardState = {
  ...emptyWizard(),
  classId: "guardian",
  subclassId: "stalwart",
  ancestryMode: "single",
  ancestryId: "dwarf",
  communityId: "ridgeborne",
};

describe("wizard steps", () => {
  it("step 1 offers classes as radios and hides Hope & Fear classes when the option is off", () => {
    const update = vi.fn();
    const { unmount } = render(<ClassStep state={emptyWizard()} update={update} opts={CORE} />);
    expect(screen.queryByLabelText(/Witch/, RADIO)).toBeNull();
    fireEvent.click(screen.getByLabelText(/^Guardian/, RADIO));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ classId: "guardian", subclassId: null }));
    unmount();
    render(<ClassStep state={guardian} update={update} opts={ALL} />);
    expect(screen.getByLabelText(/Witch/, RADIO)).toBeInTheDocument();
    expect(screen.getByLabelText("Stalwart", RADIO)).toBeChecked();
    expect(screen.getByText("No Spellcast trait")).toBeInTheDocument();
  });

  it("step 2 shows Shapeshifter only with Hope & Fear", () => {
    const { unmount } = render(<HeritageStep state={guardian} update={vi.fn()} opts={CORE} />);
    expect(screen.queryByLabelText(/Shapeshifter/, RADIO)).toBeNull();
    expect(screen.getByLabelText("Dwarf", RADIO)).toBeChecked();
    unmount();
    render(<HeritageStep state={{ ...guardian, ancestryMode: "shapeshifter", shapeForm: "elf" }} update={vi.fn()} opts={ALL} />);
    expect(screen.getByLabelText(/Shapeshifter/, RADIO)).toBeChecked();
    expect(screen.getByRole("group", { name: /Only Skin Deep/ })).toBeInTheDocument();
  });

  it("step 3 assigns modifiers and applies the suggestion", () => {
    const update = vi.fn();
    render(<TraitsStep state={guardian} update={update} opts={CORE} />);
    const agility = screen.getByRole("radiogroup", { name: "Agility" });
    fireEvent.click(within(agility).getByLabelText("Agility +2", RADIO));
    expect(update).toHaveBeenLastCalledWith({ traits: { agility: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "Use suggested" }));
    expect(Object.keys(update.mock.lastCall?.[0].traits ?? {})).toHaveLength(6);
  });

  it("step 4 labels its inputs and offers matching portraits", () => {
    render(<InfoStep state={guardian} update={vi.fn()} opts={CORE} />);
    expect(screen.getByLabelText("Character name")).toBeInTheDocument();
    expect(screen.getByLabelText("Pronouns")).toBeInTheDocument();
    const portraits = screen.getByRole("group", { name: "Portrait" });
    expect(within(portraits).getByLabelText("Stalwart", RADIO)).toBeChecked();
    expect(within(portraits).getByLabelText("Dwarf", RADIO)).toBeInTheDocument();
  });

  it("step 5 hides magic weapons without a Spellcast trait and blocks a secondary with two hands", () => {
    render(<EquipmentStep state={{ ...guardian, primaryWeaponId: "greatsword" }} update={vi.fn()} opts={CORE} />);
    expect(screen.queryByLabelText(/Arcane Gauntlets/, RADIO)).toBeNull();
    expect(screen.getByLabelText(/Round Shield/, RADIO)).toBeDisabled();
    expect(screen.getByRole("group", { name: "Class item" })).toBeInTheDocument();
  });

  it("steps 6-9 render their prompts", () => {
    const update = vi.fn();
    render(
      <>
        <BackgroundStep state={guardian} update={update} opts={CORE} />
        <ExperiencesStep state={guardian} update={update} opts={CORE} />
        <DomainCardsStep state={{ ...guardian, domainCards: [] }} update={update} opts={CORE} />
        <ConnectionsStep state={guardian} update={update} opts={CORE} />
      </>,
    );
    expect(screen.getByLabelText("First Experience")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(2);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(update).toHaveBeenLastCalledWith({ domainCards: [expect.any(String)] });
  });
});
