// Character domain rules for Task 010.
//
// These functions are pure and React-independent so they can be unit tested and
// shared between the server (validation, actions) and presentation layers. They
// hold the guided-builder template-suggestion rule and the small set of status
// and workspace-section constants the UI renders.

export const CHARACTER_STATUSES = ["active", "archived"] as const;

export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];

/**
 * The fixed set of character-workspace sections. Only `overview` and `notes`
 * are functional in Task 010; the rest are explicit placeholders whose real
 * behavior belongs to later tasks and must not be implemented here.
 */
export const CHARACTER_WORKSPACE_SECTIONS = [
  { key: "overview", label: "Overview", implemented: true },
  { key: "sheet", label: "Character Sheet", implemented: false },
  { key: "inventory", label: "Inventory", implemented: false },
  { key: "food", label: "Food", implemented: false },
  { key: "wither-tokens", label: "Wither Tokens", implemented: false },
  { key: "notes", label: "Notes", implemented: true },
  { key: "artwork", label: "Artwork", implemented: false },
  { key: "rolls", label: "Rolls", implemented: false },
] as const;

export type CharacterWorkspaceSectionKey =
  (typeof CHARACTER_WORKSPACE_SECTIONS)[number]["key"];

export const DEFAULT_WORKSPACE_SECTION: CharacterWorkspaceSectionKey = "overview";

export function isCharacterWorkspaceSection(
  value: string,
): value is CharacterWorkspaceSectionKey {
  return CHARACTER_WORKSPACE_SECTIONS.some((section) => section.key === value);
}

/**
 * Minimal shapes the suggestion rule needs. Kept structural so both database
 * rows and lighter view models satisfy them.
 */
export type ClassForSuggestion = {
  id: string;
  default_template_id: string | null;
};

export type TemplateForSuggestion = {
  id: string;
  status: string;
  is_blank_template: boolean;
};

/**
 * Suggests the sheet template to pre-select once a class has been chosen.
 *
 * Rule (Task 010): a class suggests its default template. If the class has no
 * usable default, fall back to the campaign's blank template. If neither exists,
 * return null so the builder can proceed without a template. Archived templates
 * are never suggested.
 *
 * This only computes the initial suggestion; the GM may still override it before
 * creation, and the choice is fixed on the character at creation time.
 */
export function suggestTemplateId(
  selectedClass: ClassForSuggestion | null | undefined,
  templates: readonly TemplateForSuggestion[],
): string | null {
  const active = templates.filter((template) => template.status === "active");

  if (selectedClass?.default_template_id) {
    const preferred = active.find(
      (template) => template.id === selectedClass.default_template_id,
    );
    if (preferred) {
      return preferred.id;
    }
  }

  const blank = active.find((template) => template.is_blank_template);
  return blank?.id ?? null;
}
