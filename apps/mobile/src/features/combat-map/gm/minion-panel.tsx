import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex";
import { Panel } from "../../dashboard/chrome";

import { MinionPicker } from "../play/result-card";
import { useCombatGm } from "./context";

type MineRow = FunctionReturnType<typeof api.combatRequestsReads.mine>[number];
type MinionRow = Extract<MineRow, { kind: "minionOffer" }>;

/**
 * The extra Minions waiting on a pick (Q6, CB p.201), from the GM's queue (`combatRequestsReads.mine`): the ones the
 * GM picks (rule switches D6 "GM picks the extra Minions", the player is told "The GM picks N more Minions") and any
 * player's still open (the GM may pick for them). Nothing shows while none waits.
 */
export function CombatGmMinions() {
  const { campaignId, requests } = useCombatGm();
  const offers = (requests ?? []).filter((r): r is MinionRow => r.kind === "minionOffer");
  if (offers.length === 0) return null;
  return (
    <Panel title="Minions to defeat">
      {offers.map((o) => (
        <MinionPicker
          campaignId={campaignId}
          entryId={o.entryId}
          key={o.requestId}
          offer={o}
          onDone={() => undefined}
          title={`${o.characterName}'s attack: defeat ${o.extra} more Minion${o.extra === 1 ? "" : "s"}`}
        />
      ))}
    </Panel>
  );
}
