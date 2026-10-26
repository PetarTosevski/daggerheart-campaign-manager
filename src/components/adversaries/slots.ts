import type { ReactNode } from "react";

import type { FrameId } from "@/lib/frames";

import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Props of the four feature slots the Adversaries page mounts (D8). The page (A0, later A5) owns the layout and
 * tabs; each feature tracer owns only its folder under src/components/adversaries/ and fills its slot.
 */

/** The fields of a catalogue entry the page needs; an SRD `AdversaryDef` (src/lib/srd/types.ts) fits it. */
export type CatalogueEntryRef = { id: string; name: string };

/** Catalogue tab: browse and read stat blocks (A2). `renderActions` fills the stat block head (A3: "Add to encounter"). */
export type CatalogueProps = {
  campaignId: Id<"campaigns">;
  /** The campaign's Hope & Fear content switch: H&F entries are listed only when on. */
  hopeAndFear: boolean;
  frameId: FrameId;
  renderActions: (adversary: CatalogueEntryRef) => ReactNode;
};

/** Encounters tab: the encounter list and the Battle Points builder (A3). `onOpenEncounter` shows one in the tracker. */
export type BuilderProps = {
  campaignId: Id<"campaigns">;
  /** Active characters in the party: the default Battle Points party size (CB p.197). */
  activePcs: number;
  onOpenEncounter: (encounterId: string) => void;
  /** The encounter selected at first (a `?encounter=` deep link from the Sessions hub); none: the first active one. */
  initialEncounterId?: string | null;
};

/** Encounters tab: the live tracker of the open encounter (A4); `encounterId` null = none open. `fear` = GM Fear 0–12. */
export type TrackerProps = {
  campaignId: Id<"campaigns">;
  encounterId: string | null;
  fear: number;
};

/** Catalogue tab: the campaign's custom adversaries (A5). */
export type CustomProps = {
  campaignId: Id<"campaigns">;
};
