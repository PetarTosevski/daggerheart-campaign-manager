"use client";

import "./prep.css";

import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { useSessionList } from "../list";
import type { PrepStageProps } from "../slots";
import { SessionEncounter } from "./encounter";
import { Hooks, Scenes } from "./scenes";

/**
 * Prep slot (D10 S4, board Sessions.dc.html l.99-142): 'Planned scenes' and 'Hooks & loose threads' on the left, the
 * 'Encounter builder' on the right. The builder is the session's one D8 encounter (Q1) shown with D8's own Battle
 * Points panel and add dialog (src/components/adversaries/builder), so there is one Battle Points source (K6).
 * GM-only: the page mounts it for the GM, and `sessionPrep.get` refuses players on the server (K10).
 */
export function PrepStage({ campaignId, sessionId }: PrepStageProps) {
  // The session comes from S2's shared list first, so a bad or deleted id from the URL shows a line instead of
  // throwing SESSION_NOT_FOUND into the boundary (as S2's header card does).
  const sessions = useSessionList(campaignId);
  if (sessions === undefined) return <Note status text="Loading the prep…" />;
  if (!sessions.some((s) => s._id === sessionId)) return <Note text="That session isn't in this campaign anymore. Pick another one on the left." />;
  // Keyed on the session's identity so the uncontrolled text fields start from the new session's values (CL7).
  return <PrepBody key={sessionId} campaignId={campaignId} sessionId={sessionId} />;
}

function Note({ text, status = false }: { text: string; status?: boolean }) {
  return (
    <section className="ss-card ss-start" aria-label="Prep stage">
      <p role={status ? "status" : undefined} className="ss-muted ss-m0">
        {text}
      </p>
    </section>
  );
}

function PrepBody({ campaignId, sessionId }: Pick<PrepStageProps, "campaignId" | "sessionId">) {
  const prep = useQuery(api.sessionPrep.get, { campaignId, sessionId });
  if (prep === undefined) return <Note status text="Loading the prep…" />;
  return (
    <section className="ssp-grid" aria-label="Prep stage">
      <div className="ssp-col">
        <Scenes campaignId={campaignId} sessionId={sessionId} scenes={prep.scenes} />
        <Hooks campaignId={campaignId} sessionId={sessionId} hooks={prep.hooks} />
      </div>
      <div className="ssp-col">
        <SessionEncounter campaignId={campaignId} sessionId={sessionId} encounter={prep.encounter} />
      </div>
    </section>
  );
}
