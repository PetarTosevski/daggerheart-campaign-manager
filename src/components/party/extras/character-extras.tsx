"use client";

import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../convex/campaigns";
import type { CharacterView } from "../../../../convex/characters";
import { BeastFeastPanel } from "./beast-feast-panel";
import { BeastformPanel } from "./beastform-panel";
import { CastleHighPanel } from "./castle-high-panel";
import { CompanionPanel } from "./companion-panel";
import { MotherboardPanel } from "./motherboard-panel";

/**
 * Class and frame extras for a character sheet (D4): Druid Beastform,
 * Beastbound companion, Motherboard module, Beast Feast ingredients and
 * cookbook, Castle High skyshard. Renders only those that apply; everyone in
 * the campaign sees them, the owner and the GM edit them.
 */
export function CharacterExtras({ campaign, character }: { campaign: Pick<CampaignSummary, "_id">; character: Pick<CharacterView, "_id"> }) {
  const view = useQuery(api.characterExtras.get, { characterId: character._id });
  if (!view) return null;
  const { canEdit } = view;
  const characterId = character._id;
  const keyOf = (state: unknown) => JSON.stringify(state);

  return (
    <div data-testid="character-extras" className="flex flex-col gap-4">
      {view.beastform ? <BeastformPanel key={keyOf(view.beastform)} characterId={characterId} state={view.beastform} tier={view.tier} canEdit={canEdit} /> : null}
      {view.companion ? <CompanionPanel key={keyOf(view.companion)} characterId={characterId} state={view.companion} level={view.level} canEdit={canEdit} /> : null}
      {view.motherboard ? <MotherboardPanel characterId={characterId} state={view.motherboard} level={view.level} tier={view.tier} canEdit={canEdit} /> : null}
      {view.beastFeast && view.cookbook ? (
        <BeastFeastPanel
          campaignId={campaign._id}
          characterId={characterId}
          state={view.beastFeast}
          cookbook={view.cookbook}
          capacity={view.ingredientCapacity}
          canEdit={canEdit}
        />
      ) : null}
      {view.castleHigh ? <CastleHighPanel key={keyOf(view.castleHigh)} characterId={characterId} state={view.castleHigh} canEdit={canEdit} /> : null}
    </div>
  );
}
