/** The campaign navigation from the dashboard boards, with the phase that ports each board. `gmOnly` items are hidden from players. */
export const CAMPAIGN_SECTIONS = [
  { slug: "", label: "Dashboard", phase: "D2" },
  { slug: "party", label: "Party", phase: "D4" },
  { slug: "world", label: "World", phase: "D6" },
  { slug: "codex", label: "Characters & Locations", phase: "D7" },
  // Sessions is the hub (user 2026-10-21): it comes first, then the two tabs its Play stage pulls in.
  { slug: "sessions", label: "Sessions", phase: "D10" },
  { slug: "combat-map", label: "Combat Map", phase: "D9" },
  { slug: "adversaries", label: "Adversaries", phase: "D8", gmOnly: true },
  { slug: "notes", label: "Notes", phase: "D11" },
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
