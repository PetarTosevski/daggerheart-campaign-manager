/** The campaign navigation from the dashboard boards, with the phase that ports each board. `gmOnly` items are hidden from players. */
export const CAMPAIGN_SECTIONS = [
  { slug: "", label: "Dashboard", phase: "D2" },
  { slug: "party", label: "Party", phase: "D4" },
  // User 2026-11-03: Codex, World Map, Combat Map, Adversaries (GM only), Journal (where Sessions was: it replaces Sessions
  // and Notes, whose old routes redirect to its sub-tabs), Lorekeeper.
  { slug: "codex", label: "Codex", phase: "D7" },
  { slug: "world", label: "World Map", phase: "D6" },
  { slug: "combat-map", label: "Combat Map", phase: "D9" },
  { slug: "adversaries", label: "Adversaries", phase: "D8", gmOnly: true },
  { slug: "journal", label: "Journal", phase: "JX1" },
  { slug: "lorekeeper", label: "Lorekeeper", phase: "D13" },
] as const;

export type CampaignSection = (typeof CAMPAIGN_SECTIONS)[number];

/** Whether a player may see the section in the navigation (the server still decides what they can read). */
export function visibleToPlayers(section: CampaignSection): boolean {
  return !("gmOnly" in section && section.gmOnly);
}

export function findSection(slug: string): CampaignSection | undefined {
  return CAMPAIGN_SECTIONS.find((section) => section.slug === slug);
}
