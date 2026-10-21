"use client";

import dynamic from "next/dynamic";

import { Small } from "@/components/party/sheet-ui";

import type { CampaignSlot, CharacterSlot } from "../slots";
import { DiceBoundary } from "./boundary";
import { RollFeedPanel } from "./roll-feed";

// D5 dice (T1). Contract: ../slots.ts.

function DiceLoading() {
  return (
    <Small as="p" role="status">
      Loading the dice box…
    </Small>
  );
}

// CL8: the dice box carries the class-feature registry, its SRD lists and the sheet schema (zod); the dashboard's
// roll feed needs none of them, so the box loads only where the sheet shows it.
const DiceBox = dynamic(() => import("./dice-box").then((m) => m.DiceBox), { loading: DiceLoading });

/** The dice box on the character sheet (page one), for the owner and the GM. */
export const SheetDiceBox: CharacterSlot = ({ campaignId, character, canEdit, hopeAndFear }) =>
  canEdit && !character.corrupt ? (
    <DiceBoundary label="The dice box">
      <DiceBox campaignId={campaignId} character={character} hopeAndFear={hopeAndFear} />
    </DiceBoundary>
  ) : null;

/** The roll feed on the dashboard. */
export const RollFeed: CampaignSlot = ({ campaignId, isGm }) => (
  <DiceBoundary label="The roll feed">
    <RollFeedPanel campaignId={campaignId} isGm={isGm} />
  </DiceBoundary>
);
