"use client";

import "./fear.css";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import { SceneDisc } from "../scene/disc";
import type { HudPartProps } from "../state";
import { FearBanner } from "./banner";

export { FearConfirm, fearAfterSpend, fearReasonsText, type FearConfirmProps } from "./confirm";

/**
 * The top-right of the HUD (plan combat-hud H1.2; Main / GMDesktop, CmpTokens 'GM Fear · players' / 'GM Fear · GM'):
 * the purple rod, the Fear banner (− / + on the GM view only, no confirm: answer 6a) and the day / time disc hanging
 * left of it (answer 9b). One small read, `combatHud.scene`, feeds both. While a sheet is open the banner moves left of
 * the panel and the disc hides (HANDOFF "Layout"; `.sh-open` on the HUD root).
 */
export function HudFear({ state }: HudPartProps): ReactNode {
  const scene = useQuery(api.combatHud.scene, { campaignId: state.campaignId });
  if (scene === undefined) {
    return (
      <p role="status" className="hud-fear-loading">
        Loading Fear…
      </p>
    );
  }
  return (
    <div className="hud-fear">
      <span className="hud-fear-rod" aria-hidden="true" />
      <FearBanner campaignId={state.campaignId} fear={scene.fear} gm={state.role === "gm"} />
      <SceneDisc campaignId={state.campaignId} scene={scene} />
    </div>
  );
}
