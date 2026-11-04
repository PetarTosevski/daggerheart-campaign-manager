"use client";

import "../responsive/phone.css";

import type { ReactNode } from "react";

import { HudToasts } from "../toasts";
import type { HudPartProps } from "../state";
import { PartBoundary } from "../ui";
import { PhoneEdges } from "./edges";
import { PhoneSheet } from "./sheet";
import { PhoneStrip } from "./strip";

/**
 * The phone shell (plan combat-hud H7.2; board PlayerPhone; HANDOFF "Phone (390)"). At 760 px and below the shell
 * (`usePhoneHud`) mounts this for a player in place of the desktop banners, title, Fear, feed and hand regions:
 *
 *   strip   the mini banner strip with Fear across the top (`./strip`)
 *   tools   the shell's toolbar (Map tools, the classic switch) under the strip, right
 *   sheet   the bottom sheet: resource line + Sheet, tabs Hand / Attack / Dice / Feed (`./sheet`); it steps aside while
 *           a pick session, the hit window, a result or the death move holds the bottom (phone.css)
 *   edges   chips for off-screen targets during a pick session (`./edges`)
 *   toasts  the HUD's notices, above the sheet
 *
 * The map, the target rings, the action ring and the pop region (picking panel, result, hit window, death move: H7.3
 * turns them into bottom sheets) stay the shell's. The PC sheet panel goes full screen (phone.css). The GM keeps the
 * tablet layout with the queue as a bottom sheet (`PhoneQueueSheet`, answer 13a).
 */
export function HudPhone({ state, toolbar }: HudPartProps & { toolbar: ReactNode }) {
  const map = state.map;
  return (
    <div className="hud-ph" data-testid="hud-phone">
      {map ? (
        <PartBoundary label="The party">
          <PhoneStrip campaignId={state.campaignId} mapId={map._id} />
        </PartBoundary>
      ) : null}
      <div className="hud-ph-tools" role="group" aria-label="Your tools">
        {toolbar}
      </div>
      <PartBoundary label="Targets off the screen">
        <PhoneEdges state={state} />
      </PartBoundary>
      <div className="hud-ph-notices">
        <PartBoundary label="Notices">
          <HudToasts state={state} />
        </PartBoundary>
      </div>
      {map && state.mode === "play" ? (
        <PartBoundary label="Your actions">
          <PhoneSheet state={state} mapId={map._id} />
        </PartBoundary>
      ) : null}
    </div>
  );
}

export { PhoneQueueSheet } from "./queue";
export { usePhoneHud } from "./media";
export { PHONE_QUERY, PHONE_TABS, edgePlace, edgeText, edgeTone, miniBars, resourceItems, type PhoneTab } from "./model";
