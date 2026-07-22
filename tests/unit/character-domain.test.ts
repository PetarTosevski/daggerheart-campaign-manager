import { describe, expect, it } from "vitest";

import {
  CHARACTER_WORKSPACE_SECTIONS,
  DEFAULT_WORKSPACE_SECTION,
  isCharacterWorkspaceSection,
  suggestTemplateId,
  type TemplateForSuggestion,
} from "@/lib/domain/characters";

const blank: TemplateForSuggestion = {
  id: "blank",
  status: "active",
  is_blank_template: true,
};
const guardianTemplate: TemplateForSuggestion = {
  id: "guardian",
  status: "active",
  is_blank_template: false,
};
const archivedGuardian: TemplateForSuggestion = {
  id: "guardian",
  status: "archived",
  is_blank_template: false,
};

describe("suggestTemplateId", () => {
  it("suggests the class default template when it is active", () => {
    const result = suggestTemplateId(
      { id: "c1", default_template_id: "guardian" },
      [blank, guardianTemplate],
    );
    expect(result).toBe("guardian");
  });

  it("falls back to the blank template when the class has no default", () => {
    const result = suggestTemplateId(
      { id: "c1", default_template_id: null },
      [blank, guardianTemplate],
    );
    expect(result).toBe("blank");
  });

  it("falls back to the blank template when the default is archived", () => {
    const result = suggestTemplateId(
      { id: "c1", default_template_id: "guardian" },
      [blank, archivedGuardian],
    );
    expect(result).toBe("blank");
  });

  it("returns null when no active template exists", () => {
    const result = suggestTemplateId(
      { id: "c1", default_template_id: "guardian" },
      [archivedGuardian],
    );
    expect(result).toBeNull();
  });

  it("returns the blank template when no class is selected", () => {
    expect(suggestTemplateId(null, [blank, guardianTemplate])).toBe("blank");
  });

  it("returns null when there are no templates at all", () => {
    expect(suggestTemplateId({ id: "c1", default_template_id: null }, [])).toBeNull();
  });
});

describe("workspace sections", () => {
  it("defines the eight sections with only overview and notes functional", () => {
    const keys = CHARACTER_WORKSPACE_SECTIONS.map((section) => section.key);
    expect(keys).toEqual([
      "overview",
      "sheet",
      "inventory",
      "food",
      "wither-tokens",
      "notes",
      "artwork",
      "rolls",
    ]);

    const implemented = CHARACTER_WORKSPACE_SECTIONS.filter(
      (section) => section.implemented,
    ).map((section) => section.key);
    expect(implemented).toEqual(["overview", "notes"]);
  });

  it("defaults to the overview section", () => {
    expect(DEFAULT_WORKSPACE_SECTION).toBe("overview");
  });

  it("recognizes valid section keys", () => {
    expect(isCharacterWorkspaceSection("overview")).toBe(true);
    expect(isCharacterWorkspaceSection("notes")).toBe(true);
    expect(isCharacterWorkspaceSection("nonsense")).toBe(false);
  });
});
