"use client";

import { useQuery } from "convex/react";

import { BudgetPanel } from "@/components/adversaries/builder/budget-panel";

import { api } from "../../../../convex/_generated/api";
import type { BattlePointsPanelProps } from "../slots";
import { Card } from "../ui";

/**
 * 'Battle points · Scene N' (JP2, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, Plan,
 * right column): the scene's encounter in the Adversaries builder's own `BudgetPanel` (journal variant), on the same
 * `encounters.get` read and `encounters.setBudget` intent, so the Adversaries tab shows the same numbers. A Combat
 * scene without an encounter shows a hint; a player never sees it (Q5: no Battle Points for players).
 */
export function BattlePointsPanel({ campaignId, isGm, sessionId, sceneId, sceneNumber }: BattlePointsPanelProps) {
  const prep = useQuery(api.sessionPrep.get, isGm ? { campaignId, sessionId } : "skip");
  const title = `Battle points · Scene ${sceneNumber}`;
  if (!isGm) return null;
  if (prep === undefined) {
    return (
      <p role="status" className="jr-muted">
        Loading the Battle Points…
      </p>
    );
  }
  const encounter = prep.scenes.find((s) => s.id === sceneId)?.encounter ?? null;
  if (encounter === null) {
    return (
      <Card heading={title} kind="label">
        <p className="jr-muted jr-m0">No encounter yet. Create or link one on the scene to see its Battle Points.</p>
      </Card>
    );
  }
  return <EncounterBudget campaignId={campaignId} encounterId={encounter._id} title={title} />;
}

function EncounterBudget({ campaignId, encounterId, title }: { campaignId: BattlePointsPanelProps["campaignId"]; encounterId: string; title: string }) {
  const view = useQuery(api.encounters.get, { campaignId, encounterId });
  const campaign = useQuery(api.campaigns.get, { campaignId });
  if (view === undefined || campaign === undefined) {
    return (
      <p role="status" className="jr-muted">
        Loading the Battle Points…
      </p>
    );
  }
  if (view === null || campaign === null) {
    return (
      <Card heading={title} kind="label">
        <p className="jr-muted jr-m0">This encounter no longer exists.</p>
      </Card>
    );
  }
  return <BudgetPanel campaignId={campaignId} view={view} partyTier={campaign.tier} variant="journal" title={title} />;
}
