"use client";

import "@/components/config/config.css";

import { Settings } from "lucide-react";
import { Suspense, useId, useRef, useState } from "react";

import { BrandButton, brandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";
import { AvatarFace } from "@/components/config/shell/avatar";
import { PreferencesBody } from "@/components/config/shell/preferences";
import { closeSettings, openSettings, useSettingsSection } from "@/components/config/shell/url";
import { SETTINGS_TITLE } from "@/components/config/slots";

import type { Id } from "../../../convex/_generated/dataModel";

/*
 * The end of every campaign header (plan config S1; design reference/designs/config/Settings.dc.html `.acct`): the
 * GM's gear opens Campaign settings, the avatar opens Preferences. The Combat Map's app bar (index.tsx, HUD H9.A) and
 * the tall art header (campaign-shell.tsx) render these same two components. They are glass tools (role `tool`,
 * icon); the art header draws them 40 px on the art (config.css `.cfg-acct`), the bar keeps 44 px touch targets.
 */

export const SETTINGS_LABEL = SETTINGS_TITLE;
export const PREFERENCES_LABEL = "Your preferences";

function GearButton({ expanded, onClick }: { expanded: boolean; onClick?: () => void }) {
  return (
    <BrandButton
      variant="tool"
      icon
      round
      className="cfg-acct-btn"
      aria-label={SETTINGS_LABEL}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
      data-testid="app-bar-settings"
    >
      <Settings strokeWidth={2} aria-hidden="true" />
    </BrandButton>
  );
}

function LiveGear() {
  const open = useSettingsSection() !== null;
  return <GearButton expanded={open} onClick={() => (open ? closeSettings() : openSettings("table"))} />;
}

/**
 * GM and co-GM (`campaign.role === "gm"`; the caller decides): the gear. Opens Campaign settings (`?settings=table`;
 * the panel is mounted once by the shell). `onPlayers` is what the Combat Map's bar still passes (H9.A's interim
 * Players menu is gone; the header's Players button stays until SX); it is ignored.
 */
export function CampaignSettingsButton(props: { onPlayers?: () => void }) {
  void props;
  return (
    <Suspense fallback={<GearButton expanded={false} />}>
      <LiveGear />
    </Suspense>
  );
}

/** The popover's width (config.css `.cfg-pop`: 360 px, at most the viewport less 16 px). */
const popoverWidth = () => Math.min(360, window.innerWidth - 16);

/**
 * Puts the popover under the avatar, right edges aligned, kept 8 px inside the viewport on both sides (it is in the top
 * layer, `position: fixed`; on a phone the avatar sits mid-row). Called on the avatar's click, before the browser opens
 * the popover.
 */
function placeUnder(popover: HTMLElement | null, button: HTMLElement | null) {
  if (!popover || !button) return;
  const rect = button.getBoundingClientRect();
  const right = Math.round(window.innerWidth - rect.right);
  const maxRight = Math.round(window.innerWidth - popoverWidth() - 8);
  popover.style.top = `${Math.round(rect.bottom + 10)}px`;
  popover.style.right = `${Math.max(8, Math.min(right, maxRight))}px`;
}

/**
 * Everyone: the avatar ('GM' for the GM, a player's own character portrait). Opens the Preferences popover: a native
 * `popover="auto"` (light dismiss, Escape, top layer, focus back to the avatar) whose body renders only while open.
 */
export function PreferencesButton({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const popId = `cfg-prefs-${useId()}`;
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const hide = () => {
    const element = popover.current;
    if (element && typeof element.hidePopover === "function" && element.matches(":popover-open")) element.hidePopover();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${brandButton({ variant: "tool", icon: true, round: true })} cfg-acct-btn cfg-ava`}
        aria-label={PREFERENCES_LABEL}
        aria-haspopup="dialog"
        aria-expanded={open}
        popoverTarget={popId}
        onClick={() => placeUnder(popover.current, button.current)}
        data-testid="app-bar-avatar"
      >
        <AvatarFace campaignId={campaignId} isGm={isGm} />
      </button>
      <div
        ref={popover}
        id={popId}
        popover="auto"
        role="dialog"
        aria-label={PREFERENCES_LABEL}
        className="cfg-pop"
        data-testid="preferences"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        {open ? (
          <SlotBoundary fallback={<p role="alert" className="cfg-muted">Preferences could not load.</p>}>
            <PreferencesBody campaignId={campaignId} isGm={isGm} onDone={hide} />
          </SlotBoundary>
        ) : null}
      </div>
    </>
  );
}
