"use client";

import "./plan.css";

import { useQuery } from "convex/react";

import { asideScene, PENDING } from "@/lib/journal/plan";

import { api } from "../../../../convex/_generated/api";
import { useSessionList } from "../session-list";
import type { PlanAsideProps, PlanViewProps } from "../slots";
import { Card } from "../ui";
import { BattlePointsPanel } from "./battle-points";
import { GmPrep } from "./gm-prep";
import { AddSceneButton, SceneList } from "./scenes";

/**
 * Plan view slot (JP1, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, Plan). GM only (the
 * page mounts it for the GM; `sessionPrep.get` is a GM query). The right column shows `asideScene`'s Combat scene
 * (src/lib/journal/plan.ts).
 */

/** Centre: the 'Planned scenes' card (scenes, '+ Add scene') with the 'GM prep' parchment at its foot. */
export function PlanView({ campaignId, sessionId }: PlanViewProps) {
  const prep = useQuery(api.sessionPrep.get, { campaignId, sessionId });
  const status = useSessionList(campaignId)?.find((s) => s._id === sessionId)?.status;
  const ids = { campaignId, sessionId };
  if (prep === undefined) {
    return (
      <p role="status" className="jr-muted">
        Loading the plan…
      </p>
    );
  }
  return (
    <Card heading="Planned scenes" className="jp-card" actions={<AddSceneButton ids={ids} count={prep.scenes.length} />}>
      <SceneList ids={ids} scenes={prep.scenes} sessionStatus={status} />
      <GmPrep ids={ids} hooks={prep.hooks} />
    </Card>
  );
}

/** Right: `BattlePointsPanel` (JP2) for the playing Combat scene, else the first one; nothing without a Combat scene. */
export function PlanAside({ campaignId, isGm, sessionId }: PlanAsideProps) {
  const prep = useQuery(api.sessionPrep.get, { campaignId, sessionId });
  if (prep === undefined) {
    return (
      <p role="status" className="jr-muted">
        Loading the Battle Points…
      </p>
    );
  }
  const scene = asideScene(prep.scenes.filter((s) => !s.id.startsWith(PENDING)));
  if (scene === null) return null;
  return <BattlePointsPanel campaignId={campaignId} isGm={isGm} sessionId={sessionId} sceneId={scene.sceneId} sceneNumber={scene.number} />;
}
