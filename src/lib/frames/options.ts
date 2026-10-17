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
  | "remnantCorruption";

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
