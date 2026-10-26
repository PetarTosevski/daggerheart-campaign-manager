"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { AdversaryActions } from "./use-adversary-actions";

const TYPE = { physical: "physical", magic: "magic", both: "physical and magic" } as const;

/**
 * The open reaction windows of this encounter (Q13, Q17; AA2's `windows`): who hit whom for how much, who still has to
 * answer (the target's armor choice, allies with an eligible card) and the GM's "Resolve now", which settles it with no
 * armor and no card from whoever hasn't answered. No timer. Renders nothing while no window is open.
 */
export function ReactionWindows({ campaignId, encounterId, acts }: { campaignId: Id<"campaigns">; encounterId: string; acts: AdversaryActions }) {
  const windows = useQuery(api.adversaryActions.windows, { campaignId });
  const [resolving, setResolving] = useState<string | null>(null);
  const open = (windows ?? []).filter((w) => w.encounterId === undefined || w.encounterId === encounterId);
  if (open.length === 0) return null;

  async function resolve(requestId: Id<"combatRequests">) {
    setResolving(requestId);
    await acts.resolve(requestId);
    setResolving(null);
  }

  return (
    <section className="trk-windows" aria-label="Reaction windows">
      <h3 className="trk-windows-h">Waiting on the players</h3>
      <ul>
        {open.map((w) => (
          <li key={w.requestId} className="trk-window" data-testid="tracker-window">
            <div className="trk-window-what">
              <b>{w.attackerLabel}</b>
              {w.feature ? ` (${w.feature})` : ""} hit <b>{w.targetName}</b>: {w.damage} {w.direct ? "direct " : ""}
              {TYPE[w.damageType]} damage{w.critical ? ", critical" : ""}
            </div>
            <div className="trk-window-who">
              {w.awaiting.length === 0
                ? "Everyone answered."
                : `Waiting for ${w.awaiting.map((a) => `${a.name} (${a.role === "target" ? "armor choice" : "ally reaction"})`).join(", ")}`}
            </div>
            <button
              type="button"
              className="trk-btn"
              disabled={resolving === w.requestId}
              aria-label={`Resolve now: ${w.attackerLabel} hit ${w.targetName}`}
              onClick={() => void resolve(w.requestId)}
            >
              Resolve now
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
