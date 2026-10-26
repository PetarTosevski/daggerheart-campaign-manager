// Optional rules a GM can switch per campaign. Defaults follow the user's
// decisions (docs/decisions-d3-d11.md): each frame's optional rules start on in
// that frame; Hope & Fear content starts on for the four Hope & Fear frames.
// Pure module: bundled into Convex.

import { getPublishedFrame, type FrameId } from "./index";

export type CampaignOptionId =
  | "hopeAndFear"
  | "lessLethal"
  | "transformations"
  | "enduranceCountdowns"
  | "remnantCorruption"
  | "witherPersists";

export type CampaignOption = {
  id: CampaignOptionId;
  label: string;
  description: string;
  /** Frames that offer the option; undefined = every frame. */
  frames?: FrameId[];
  defaultFor: (frameId: FrameId) => boolean;
};

export const CAMPAIGN_OPTIONS: CampaignOption[] = [
  {
    id: "hopeAndFear",
    label: "Hope & Fear content",
    description: "Expansion classes, ancestries, communities, transformations, equipment and adversaries.",
    defaultFor: (frameId) => frameId !== "custom" && getPublishedFrame(frameId)!.expansion,
  },
  {
    id: "lessLethal",
    label: "Less lethal (Castle High)",
    description: "A character who would die is sent to the infirmary or home instead.",
    frames: ["castle-high"],
    defaultFor: (frameId) => frameId === "castle-high",
  },
  {
    id: "transformations",
    label: "Transformations (Andaluria)",
    description: "Monster hunts can transform characters; each player must consent.",
    frames: ["dark-heart-of-andaluria"],
    defaultFor: (frameId) => frameId === "dark-heart-of-andaluria",
  },
  {
    id: "enduranceCountdowns",
    label: "Endurance Countdowns (Horizon)",
    description: "Wilderness travel wears characters down between rests.",
    frames: ["journey-to-horizon"],
    defaultFor: (frameId) => frameId === "journey-to-horizon",
  },
  {
    id: "remnantCorruption",
    label: "Remnant Corruption (Motherboard)",
    description: "A Beastbound ranger's remnant companion can be corrupted.",
    frames: ["motherboard"],
    defaultFor: (frameId) => frameId === "motherboard",
  },
  {
    // A house rule against the book (CB p.261: session end turns every Wither token into Fear), user 2026-10-20.
    id: "witherPersists",
    label: "Wither stays across sessions (house rule)",
    description: "Ending a session keeps Wither tokens on the sheets instead of turning them into Fear. You can still convert them in the End dialog.",
    frames: ["witherwild"],
    defaultFor: () => false,
  },
];

export function optionsFor(frameId: FrameId): CampaignOption[] {
  return CAMPAIGN_OPTIONS.filter((o) => !o.frames || o.frames.includes(frameId));
}

export function resolveOptions(
  frameId: FrameId,
  stored: Record<string, boolean> | undefined,
): Record<CampaignOptionId, boolean> {
  return Object.fromEntries(
    CAMPAIGN_OPTIONS.map((o) => [
      o.id,
      (!o.frames || o.frames.includes(frameId)) && (stored?.[o.id] ?? o.defaultFor(frameId)),
    ]),
  ) as Record<CampaignOptionId, boolean>;
}

export function isCampaignOptionId(id: string): id is CampaignOptionId {
  return CAMPAIGN_OPTIONS.some((o) => o.id === id);
}
