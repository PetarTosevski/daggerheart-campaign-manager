import {
  CAMPAIGN_SECTIONS,
  visibleToPlayers,
  type CampaignSection,
} from "../../../../src/lib/campaign-sections";

export type PhonePlacement = "tab" | "more";

/**
 * Every campaign section has a phone placement. Adding a slug to
 * `CAMPAIGN_SECTIONS` without a row here fails typecheck.
 */
const PHONE_PLACEMENT = {
  "": "tab",
  party: "tab",
  world: "more",
  codex: "more",
  "combat-map": "tab",
  adversaries: "more",
  journal: "tab",
  lorekeeper: "more",
} as const satisfies Record<CampaignSection["slug"], PhonePlacement>;

type TabSlug = {
  [Slug in CampaignSection["slug"]]: (typeof PHONE_PLACEMENT)[Slug] extends "tab" ? Slug : never;
}[CampaignSection["slug"]];

/**
 * Dashboard, Party, Combat Map, Journal (Journal sits where Sessions was; it replaced Sessions and Notes). A tab slug
 * left out of this list fails typecheck.
 */
const TAB_ORDER = ["", "party", "combat-map", "journal"] as const satisfies readonly TabSlug[];

type MissingTab = Exclude<TabSlug, (typeof TAB_ORDER)[number]>;
type AssertNever<T extends never> = T;
type TabsCovered = AssertNever<MissingTab>;

const MORE_EXTRAS = [
  { slug: "players", label: "Players" },
  { slug: "tome", label: "Tome" },
  { slug: "settings", label: "Settings" },
  { slug: "switch-campaign", label: "Switch campaign" },
] as const;

export type PhoneDestination = {
  slug: string;
  label: string;
};

export function tabItems(): PhoneDestination[] {
  return TAB_ORDER.map((slug) => ({ slug, label: sectionLabel(slug) }));
}

/** More destinations. Adversaries is included only when `isGm` is true (`visibleToPlayers`). */
export function moreItems(isGm: boolean): PhoneDestination[] {
  const sections = CAMPAIGN_SECTIONS.filter((section) => PHONE_PLACEMENT[section.slug] === "more")
    .filter((section) => isGm || visibleToPlayers(section))
    .map((section) => ({ slug: section.slug, label: section.label }));
  return [...sections, ...MORE_EXTRAS];
}

export function sectionLabel(slug: string): string {
  const section = CAMPAIGN_SECTIONS.find((item) => item.slug === slug);
  if (section) return section.label;
  const extra = MORE_EXTRAS.find((item) => item.slug === slug);
  if (extra) return extra.label;
  throw new Error(`No phone label for ${slug}`);
}

/** Stack screen name for a campaign section. The dashboard file is `index`. */
export function stackName(slug: string): string {
  return slug.length === 0 ? "index" : slug;
}

export function dashboardHref(campaignId: string): string {
  return `/campaign/${campaignId}`;
}

/** The campaign list (`app/campaigns/index.tsx`): where Switch campaign goes. */
export const CAMPAIGNS_HREF = "/campaigns";

export function sectionHref(campaignId: string, slug: string): string {
  if (slug === "switch-campaign") return CAMPAIGNS_HREF;
  if (slug.length === 0) return dashboardHref(campaignId);
  return `/campaign/${campaignId}/${slug}`;
}

/** Old Sessions and Notes paths (the detail screens, and the lists that redirect) belong to the Journal tab. */
const JOURNAL_PATHS = ["sessions", "notes"] as const;

/** The tab slug when `pathname` is one of the four tabs, otherwise null (a More destination). */
export function activeTab(pathname: string, campaignId: string): string | null {
  const base = dashboardHref(campaignId);
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === base) return "";
  for (const old of JOURNAL_PATHS) {
    if (path === `${base}/${old}` || path.startsWith(`${base}/${old}/`)) return "journal";
  }
  for (const tab of tabItems()) {
    if (tab.slug.length > 0 && path === `${base}/${tab.slug}`) return tab.slug;
  }
  return null;
}

/** Referenced so the tab-coverage check is part of the module type. */
export type PhoneTabsCovered = TabsCovered;
