"use client";

import "./drawer.css";

import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { usePlayFor } from "../play-for";
import { sheetCharacterId, type CombatPageState } from "../slots";
import { BeastformControl, FlyingToggle, StanceControls } from "./list/controls";
import { activeForm } from "./list/model";

/**
 * The sheet drawer's controls the HUD's sheet does not show yet (plan sheet-drawer SD6; kept by plan combat-hud H8.1,
 * which deleted the drawer itself: the HUD's sheet panel, `hud/sheet`, shows the trackers, conditions and features).
 * In the HUD's tools drawer, for a player's own PC on the map or the PC token the GM selected: the class counters and
 * held dice, the Flying toggle (Q16), the Beastform's "Drop out" (Q10) and the Martial Artist's stances (Q5). The GM's
 * controls are greyed until "Play for this character" is on. Renders nothing when the character has none of them.
 */
export function SheetExtras({ campaignId, role, map, selectedTokenId }: Pick<CombatPageState, "campaignId" | "role" | "map" | "selectedTokenId">) {
  const tokens = useQuery(api.combatTokens.party, map ? { campaignId, mapId: map._id } : "skip");
  const characterId = tokens ? sheetCharacterId(role, tokens, selectedTokenId) : null;
  if (characterId === null) return null;
  return <Extras campaignId={campaignId} role={role} characterId={characterId} />;
}

function Extras({ campaignId, role, characterId }: { campaignId: Id<"campaigns">; role: CombatPageState["role"]; characterId: Id<"characters"> }) {
  const drawer = useQuery(api.combatFeatures.drawer, { campaignId, characterId });
  // The one Play-for switch per PC (DA6; convex/playFor.ts): the HUD's hand and sheet show it.
  const playFor = usePlayFor(campaignId, characterId, role === "gm");
  if (drawer === undefined) return null;
  const form = activeForm(drawer.features);
  const chips = drawer.counters.length > 0 || drawer.heldDice.length > 0;
  if (!chips && !drawer.canFly && !form && !drawer.martial) return null;
  const here = { campaignId, characterId, canAct: role === "player" || playFor.on };
  return (
    <section className="cm-card sd-extras" aria-label={`${drawer.name}: class controls`} data-testid="sheet-extras">
      <h2 className="cm-h">{drawer.name}</h2>
      <div className="sd-grey" data-greyed={here.canAct ? "false" : "true"}>
        {chips ? (
          <ul className="sd-chips" aria-label="Class counters">
            {drawer.counters.map((c) => (
              <li key={c.key} className="sd-chip">
                {c.label}: {c.value}
              </li>
            ))}
            {drawer.heldDice.map((d) => (
              <li key={d.id} className="sd-chip">
                d{d.sides} {d.kind}
                {d.value !== null ? `: ${d.value}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {drawer.canFly ? <FlyingToggle {...here} flying={drawer.flying} /> : null}
        {form ? <BeastformControl {...here} form={form} /> : null}
        {drawer.martial ? <StanceControls {...here} martial={drawer.martial} features={drawer.features} /> : null}
      </div>
    </section>
  );
}
