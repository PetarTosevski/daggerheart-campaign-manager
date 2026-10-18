"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { Launcher } from "@/components/party/sheet-ui";

import { api } from "../../../../convex/_generated/api";
import type { CharacterSlot } from "../slots";
import { BeastFeastPanel } from "./beast-feast-panel";
import { BeastformPanel } from "./beastform-panel";
import { CastleHighPanel } from "./castle-high-panel";
import { CompanionPanel } from "./companion-panel";
import { CorruptionBox } from "./corruption-box";
import { MotherboardPanel } from "./motherboard-panel";
import { ExtraSheet, PawIcon } from "./ui";

// Class and frame extras for a character sheet (D4). Each renders only the extras that apply; everyone in the
// campaign sees them, the owner and the GM edit them (the view's own `canEdit`). Both read `characterExtras.get`;
// the Convex client shares the one subscription.

const keyOf = (state: unknown) => JSON.stringify(state);

/**
 * Class extras inside the Class Features box: launcher rows (the board's cs-launch) for Druid Beastform and the
 * Beastbound companion, each opening its parchment overlay sheet.
 */
export const ClassExtras: CharacterSlot = ({ character }) => {
  const view = useQuery(api.characterExtras.get, { characterId: character._id });
  const [open, setOpen] = useState<"beast" | "comp" | null>(null);
  if (!view || (!view.beastform && !view.companion)) return null;
  const { canEdit } = view;
  const characterId = character._id;
  const close = () => setOpen(null);
  return (
    <div data-testid="class-extras" className="flex flex-col gap-2.5">
      {view.beastform ? (
        <>
          <Launcher action="Beastform" icon={<PawIcon />} onOpen={() => setOpen("beast")}>
            <strong>Beastform:</strong> mark a Stress to transform into a creature of your tier or lower.
          </Launcher>
          <ExtraSheet open={open === "beast"} onClose={close} title="Druid Beastform" banner="beast" subtitle={`Your tier ${view.tier}`}>
            <BeastformPanel key={keyOf(view.beastform)} characterId={characterId} state={view.beastform} tier={view.tier} canEdit={canEdit} />
          </ExtraSheet>
        </>
      ) : null}
      {view.companion ? (
        <>
          <Launcher action="Companion" icon={<PawIcon />} onOpen={() => setOpen("comp")}>
            <strong>Companion:</strong> your Beastbound animal companion and their training.
          </Launcher>
          <ExtraSheet open={open === "comp"} onClose={close} title="Ranger Companion" banner="comp" subtitle={view.companion.name ? `Name: ${view.companion.name}` : undefined}>
            <CompanionPanel key={keyOf(view.companion)} characterId={characterId} state={view.companion} level={view.level} canEdit={canEdit} />
            <CorruptionBox characterId={characterId} />
          </ExtraSheet>
        </>
      ) : null}
    </div>
  );
};

/** Frame extras in the sheet's frame extras region: Motherboard module, Beast Feast ingredients and cookbook, Castle High skyshard. */
export const FrameExtras: CharacterSlot = ({ campaignId, character }) => {
  const view = useQuery(api.characterExtras.get, { characterId: character._id });
  if (!view) return null;
  const { canEdit } = view;
  const characterId = character._id;
  return (
    <div data-testid="character-extras" className="xs-region">
      {view.motherboard ? <MotherboardPanel characterId={characterId} state={view.motherboard} level={view.level} tier={view.tier} canEdit={canEdit} /> : null}
      {view.beastFeast && view.cookbook ? (
        <BeastFeastPanel campaignId={campaignId} characterId={characterId} state={view.beastFeast} cookbook={view.cookbook} capacity={view.ingredientCapacity} canEdit={canEdit} />
      ) : null}
      {view.castleHigh ? <CastleHighPanel key={keyOf(view.castleHigh)} characterId={characterId} state={view.castleHigh} canEdit={canEdit} /> : null}
    </div>
  );
};
