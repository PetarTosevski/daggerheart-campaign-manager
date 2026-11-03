import type { CombatMapLayout, CombatPlayerView, CombatSlotProps } from "../../../src/features/combat-map/contract";
import type { Id } from "../../../src/convex";
import { liveLayout, playerViewOk } from "../combat-view/fixtures";
import { characterRecord } from "../party/fixture";

export const campaignId = "campaign-1" as Id<"campaigns">;

export function slotProps(overrides?: {
  layout?: Partial<CombatMapLayout>;
  view?: Partial<Extract<CombatPlayerView, { state: "ok" }>>;
}): CombatSlotProps {
  const layout = liveLayout(overrides?.layout);
  const view = playerViewOk({
    others: [
      {
        _id: "tok-bandit" as Id<"combatTokens">,
        name: "Bandit",
        side: "enemy" as const,
        x: 2,
        y: 1,
        size: 1,
        face: 0,
        revealed: true,
      },
    ],
    ...overrides?.view,
  });
  return {
    campaignId,
    isGm: false,
    layout,
    view,
  };
}

export function okCharacterId(props: CombatSlotProps): Id<"characters"> {
  if (props.view.state !== "ok") throw new Error("view not ok");
  return props.view.characterId;
}

export function handCard(cardId: string, name: string) {
  return {
    cardId,
    name,
    domain: "splendor",
    level: 1,
    type: "spell" as const,
    recallCost: 1,
    place: "loadout" as const,
    usage: "combat" as const,
    state: "ready" as const,
    resetLabel: null,
    tokens: 0,
    uses: [
      {
        useId: "main",
        name,
        activation: "action" as const,
        ready: true,
        resetLabel: null,
        usesLeft: null,
        rolls: true,
        targets: { side: "enemy" as const, range: "far" as const, count: "one" as const },
        choices: [],
      },
    ],
  };
}

export function characterForAttack() {
  return characterRecord({ canEdit: true });
}
