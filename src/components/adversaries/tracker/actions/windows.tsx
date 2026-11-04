"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { AdversaryActions } from "./use-adversary-actions";

const TYPE = { physical: "physical", magic: "magic", both: "physical and magic" } as const;

/** A held attack's row (SD4 Q2): `windows` sets `preRoll` on it only. */
const isHeld = (w: object) => "preRoll" in w && w.preRoll === true;

/**
 * The open reaction windows of this encounter (Q13, Q17; AA2's `windows`): who hit whom for how much, who still has to
 * answer (the target's armor choice, allies with an eligible card) and the GM's "Resolve now", which settles it with no
 * armor and no card from whoever hasn't answered. No timer. Renders nothing while no window is open. A held attack
 * (SD4 Q2, `preRoll`) is a waiting line: "Bandit attacks Mira, before the roll", no damage; Resolve now rolls it.
 */
export function ReactionWindows({ campaignId, encounterId, acts }: { campaignId: Id<"campaigns">; encounterId: string; acts: AdversaryActions }) {
  const windows = useQuery(api.adversaryActions.windows, { campaignId });
  // Plan lanes-2 E7.4 (dcm-wiwi, dcm-0hlq): named tokens on the PCs (bramble) and the GM's "Escaped" button.
  const pcTokens = useQuery(api.adversaryActions.pcTokens, { campaignId });
  const [resolving, setResolving] = useState<string | null>(null);
  const open = (windows ?? []).filter((w) => w.encounterId === undefined || w.encounterId === encounterId);
  const held = pcTokens ?? [];
  if (open.length === 0 && held.length === 0) return null;

  async function resolve(requestId: Id<"combatRequests">) {
    setResolving(requestId);
    await acts.resolve(requestId);
    setResolving(null);
  }

  async function escape(characterId: Id<"characters">, name: string) {
    setResolving(`${characterId}:${name}`);
    await acts.escape(characterId, name);
    setResolving(null);
  }

  return (
    <section className="trk-windows" aria-label="Reaction windows">
      {held.length > 0 ? (
        <>
          <h3 className="trk-windows-h">Tokens on the PCs</h3>
          <ul>
            {held.map((t) => (
              <li key={`${t.characterId}:${t.name}`} className="trk-window" data-testid="tracker-pc-tokens">
                <div className="trk-window-what">
                  <b>{t.pcName}</b>: {t.count} {t.name}
                </div>
                <BrandButton
                  variant="neutral"
                  disabled={resolving === `${t.characterId}:${t.name}`}
                  aria-label={`${t.pcName} escaped the ${t.name} tokens`}
                  onClick={() => void escape(t.characterId, t.name)}
                >
                  Escaped
                </BrandButton>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {open.length > 0 ? <h3 className="trk-windows-h">Waiting on the players</h3> : null}
      <ul>
        {open.map((w) => (
          <li key={w.requestId} className="trk-window" data-testid="tracker-window">
            {isHeld(w) ? (
              // DA1 (SD4 follow-up): a held attack (Q2) has no roll and no damage yet.
              <div className="trk-window-what">
                <b>{w.attackerLabel}</b>
                {w.feature ? ` (${w.feature})` : ""} attacks <b>{w.targetName}</b>, before the roll
              </div>
            ) : (
              <div className="trk-window-what">
                <b>{w.attackerLabel}</b>
                {w.feature ? ` (${w.feature})` : ""} hit <b>{w.targetName}</b>: {w.damage} {w.direct ? "direct " : ""}
                {TYPE[w.damageType]} damage{w.critical ? ", critical" : ""}
              </div>
            )}
            <div className="trk-window-who">
              {w.awaiting.length === 0
                ? "Everyone answered."
                : `Waiting for ${w.awaiting.map((a) => `${a.name} (${isHeld(w) ? "before-roll answer" : a.role === "target" ? "armor choice" : "ally reaction"})`).join(", ")}`}
            </div>
            <BrandButton
              variant="confirm"
              disabled={resolving === w.requestId}
              aria-label={`Resolve now: ${w.attackerLabel} ${isHeld(w) ? "attacks" : "hit"} ${w.targetName}`}
              onClick={() => void resolve(w.requestId)}
            >
              Resolve now
            </BrandButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
