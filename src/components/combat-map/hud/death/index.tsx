"use client";

import "./death.css";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { PartBoundary } from "../ui";
import { OwnDeath } from "./own";
import { TableDeath } from "./table";

/**
 * The death move at your last Hit Point (plan combat-hud H4.3; Main 'Last Hit Point'), waiting for the GM's confirm
 * (HD4, answer 15b). Every character the viewer plays gets `OwnDeath` (the modal, the wait, the outcome); every other
 * player sees the outcome too (`TableDeath`, user answer 2026-11-02; the GM has it from the confirm); the GM's
 * confirm (`GmDeathConfirm`) lives in H5.1's request queue (hud/queue). The greyed banner and token
 * are H1.1's and H1.3's own `down` state (every Hit Point marked). Each character sits in its own boundary.
 */
export const HudDeath = ({ state }: HudPartProps): ReactNode => <DeathParts campaignId={state.campaignId} gm={state.role === "gm"} />;

function DeathParts({ campaignId, gm }: { campaignId: Id<"campaigns">; gm: boolean }) {
  const characters = useQuery(api.charactersReads.listByCampaign, { campaignId });
  if (characters === undefined) return null;
  const live = characters.filter((c) => !c.corrupt);
  const mine = live.filter((c) => c.mine && c.canEdit);
  const names = new Map<string, string>(live.map((c) => [c._id, c.sheet.name]));
  const own = new Set<string>(mine.map((c) => c._id));
  return (
    <div className="hud-death-stack" data-testid="hud-death">
      {mine.map((c) => (
        <PartBoundary key={`own-${c._id}`} label={`${c.sheet.name}'s death move`}>
          <OwnDeath campaignId={campaignId} character={c} gm={gm} />
        </PartBoundary>
      ))}
      {gm ? null : (
        <PartBoundary label="The table's death moves">
          <TableDeath campaignId={campaignId} names={names} own={own} />
        </PartBoundary>
      )}
    </div>
  );
}
