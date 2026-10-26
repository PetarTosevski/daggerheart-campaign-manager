"use client";

import "./downtime.css";

import { useQuery } from "convex/react";
import { Component, type ReactNode } from "react";

import { RestPicker } from "@/components/party/rest";
import { SheetBox } from "@/components/party/sheet-ui";
import type { RestKind, RestMove } from "@/lib/domain/rest/moves";

import { api } from "../../../../../../../../convex/_generated/api";
import { useSheet } from "../sheet-context";

// Downtime box of page 1 (board: Party.dc.html "Downtime"): the rest picker on top while the GM has a rest open,
// then the board's SHORT REST / LONG REST reference text, with the moves this character picked highlighted.

type Entry = { name: string; text: string; moves: readonly RestMove[] };

const REFERENCE: Record<RestKind, { head: string; intro: string; entries: readonly Entry[] }> = {
  short: {
    head: "SHORT REST",
    intro:
      "Each player may swap any number of domain cards in their Loadout for domain cards in their Vault, then choose two options below (or choose the same move twice). The GM gains 1d4 Fear and may tick a long-term countdown.",
    entries: [
      {
        name: "Tend to Wounds",
        text: "Describe how you hastily patch yourself up, then clear a number of Hit Points equal to 1d4 + your tier. You can do this to an ally instead.",
        moves: ["tendToWounds"],
      },
      {
        name: "Clear Stress",
        text: "Describe how you blow off steam or pull yourself together, then clear a number of Stress equal to 1d4 + your tier.",
        moves: ["clearStress"],
      },
      {
        name: "Repair Armor",
        text: "Describe how you quickly repair your armor, then clear a number of Armor Slots equal to 1d4 + your tier. You can do this to an ally’s armor instead.",
        moves: ["repairArmor"],
      },
      {
        name: "Prepare",
        text: "Describe how you prepare yourself for the path ahead, then gain a Hope. If you choose to Prepare with one or more members of your party, you each gain 2 Hope.",
        moves: ["prepare", "prepareTogether"],
      },
    ],
  },
  long: {
    head: "LONG REST",
    intro:
      "Each player can swap any domain cards in their loadout for cards in their vault, then can choose two of the following moves (or choose the same move twice). The GM gains 1d4 + the number of players Fear and may tick a long-term countdown.",
    entries: [
      { name: "Tend to All Wounds", text: "Describe how you patch yourself up, then clear all Hit Points. You can do this to an ally instead.", moves: ["tendToAllWounds"] },
      { name: "Clear All Stress", text: "Describe how you blow off steam or pull yourself together, then clear all Stress.", moves: ["clearAllStress"] },
      {
        name: "Repair All Armor",
        text: "Describe how you spend time repairing your armor, then clear all Armor Slots. You can do this to an ally’s armor instead.",
        moves: ["repairAllArmor"],
      },
      {
        name: "Prepare",
        text: "Describe how you prepare for the next day’s adventure, then gain a Hope. If you choose to Prepare with one or more members of your party, you each gain 2 Hope.",
        moves: ["prepare", "prepareTogether"],
      },
      { name: "Work on a Project", text: "Establish or continue work on a project.", moves: ["workOnProject"] },
    ],
  },
};

/** The board's reference text; `picked` (the open rest's kind and this character's saved moves) highlights entries. */
function RestReference({ picked }: { picked?: { kind: RestKind; moves: readonly RestMove[] } }) {
  return (
    <div className="sh-small dt-ref">
      {(["short", "long"] as const).map((kind) => (
        <div key={kind} className="dt-block">
          <strong className="dt-head">{REFERENCE[kind].head}</strong>
          <span>{REFERENCE[kind].intro}</span>
          {REFERENCE[kind].entries.map((entry) => {
            const times = picked?.kind === kind ? picked.moves.filter((m) => entry.moves.includes(m)).length : 0;
            return (
              <span key={entry.name} className={times > 0 ? "dt-entry dt-picked" : "dt-entry"}>
                <strong>{entry.name}:</strong> {entry.text}
                {times > 0 ? <span className="dt-tag">{times > 1 ? `Picked ×${times}` : "Picked"}</span> : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The reference text with this character's picks from the open rest. */
function LiveRestReference() {
  const { slot } = useSheet();
  const state = useQuery(api.rests.current, { campaignId: slot.campaignId });
  const open = state?.open ?? null;
  const choice = open?.choices.find((c) => c.characterId === slot.character._id);
  return <RestReference picked={open && choice ? { kind: open.kind, moves: choice.moves.map((m) => m.move) } : undefined} />;
}

/** If the rest query fails, the reference text still shows, without highlights (CL1). */
class ReferenceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <RestReference /> : this.props.children;
  }
}

export function DowntimeBox() {
  const { slot } = useSheet();
  return (
    <SheetBox title="Downtime">
      <RestPicker {...slot} />
      <ReferenceBoundary>
        <LiveRestReference />
      </ReferenceBoundary>
    </SheetBox>
  );
}
