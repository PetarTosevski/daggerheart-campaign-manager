import { HitBoundary } from "../../sheet/incoming/boundary";
import { PendingHits } from "../../sheet/incoming/pending";

import type { CombatSlotProps } from "../contract";
import type { Id } from "../../../convex";

type OkView = Extract<CombatSlotProps["view"], { state: "ok" }>;

export function CombatIncoming({
  campaignId,
  view,
}: {
  campaignId: Id<"campaigns">;
  view: OkView;
}) {
  const mine = view.pcs.find((t) => t.mine);
  const name = mine?.name ?? "Your character";
  return (
    <HitBoundary>
      <PendingHits campaignId={campaignId} characterId={view.characterId} characterName={name} />
    </HitBoundary>
  );
}
