"use client";

import "./death.css";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { PartBoundary } from "../ui";
import { GmDeathConfirm } from "./confirm";
import { OwnDeath } from "./own";

/**
 * The death move at your last Hit Point (plan combat-hud H4.3; Main 'Last Hit Point'), waiting for the GM's confirm
 * (HD4, answer 15b). Every character the viewer plays gets `OwnDeath` (the modal, the wait, the outcome); on the GM view
 * every PC also gets `GmDeathConfirm` (the confirm popup, until H5.1's queue takes it). The greyed banner and token
 * are H1.1's and H1.3's own `down` state (every Hit Point marked). Each character sits in its own boundary.
 */
export const HudDeath = ({ state }: HudPartProps): ReactNode => <DeathParts campaignId={state.campaignId} gm={state.role === "gm"} />;

function DeathParts({ campaignId, gm }: { campaignId: Id<"campaigns">; gm: boolean }) {
  const characters = useQuery(api.characters.listByCampaign, { campaignId });
  if (characters === undefined) return null;
  const live = characters.filter((c) => !c.corrupt);
  const mine = live.filter((c) => c.mine && c.canEdit);
  return (
    <div className="hud-death-stack" data-testid="hud-death">
      {mine.map((c) => (
        <PartBoundary key={`own-${c._id}`} label={`${c.sheet.name}'s death move`}>
          <OwnDeath campaignId={campaignId} character={c} gm={gm} />
        </PartBoundary>
      ))}
      {gm
        ? live.map((c) => (
            <PartBoundary key={`gm-${c._id}`} label={`${c.sheet.name}'s death move`}>
              <GmDeathConfirm character={c} />
            </PartBoundary>
          ))
        : null}
    </div>
  );
}
