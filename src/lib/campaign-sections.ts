/** The campaign navigation from the dashboard boards, with the phase that ports each board. */
export const CAMPAIGN_SECTIONS = [
  { slug: "", label: "Dashboard", phase: "D2" },
  { slug: "party", label: "Party", phase: "D4" },
  { slug: "world", label: "World", phase: "D6" },
  { slug: "codex", label: "Characters & Locations", phase: "D7" },
  { slug: "adversaries", label: "Adversaries", phase: "D8" },
  { slug: "sessions", label: "Sessions", phase: "D9" },
  { slug: "notes", label: "Notes", phase: "D10" },
] as const;

export type CampaignSection = (typeof CAMPAIGN_SECTIONS)[number];

export function findSection(slug: string): CampaignSection | undefined {
  return CAMPAIGN_SECTIONS.find((section) => section.slug === slug);
}
