"use client";

import { useQuery } from "convex/react";
import Image from "next/image";
import { useId, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { portraitSource } from "@/components/party/party-display";
import { SlotBoundary } from "@/components/party/session/boundary";
import { designAsset } from "@/lib/design-assets";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/*
 * The app bar's right end (board GMDesktop `.ab-ic` gear, `.ab-ava` avatar; user answer Q3 (c), 2026-11-04): the
 * slots config plan S1 fills. Until S1 lands both are placeholder buttons that open a small note of what is coming;
 * the GM's gear also keeps today's Players dialog one click away (the art header's Players button is not on the
 * Combat Map). S1 replaces `CampaignSettingsButton` and `PreferencesButton` here; the bar imports nothing else.
 */

export const SETTINGS_LABEL = "Campaign settings";
export const PREFERENCES_LABEL = "Your preferences";

/** A native popover (`popover="auto"`: light dismiss, Escape, top layer) under the bar's right end. */
function Popover({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const titleId = `${id}-title`;
  return (
    <div id={id} popover="auto" role="dialog" aria-labelledby={titleId} className="ab-pop">
      <p id={titleId} className="ab-pop-title">
        {title}
      </p>
      {children}
    </div>
  );
}

function hidePopover(id: string) {
  const element = document.getElementById(id);
  if (element && typeof element.hidePopover === "function" && element.matches(":popover-open")) element.hidePopover();
}

/** GM: the settings gear. Opens Players (today's dialog) and says Campaign settings are coming. */
export function CampaignSettingsButton({ onPlayers }: { onPlayers: () => void }) {
  const popId = `ab-settings-${useId()}`;
  return (
    <>
      <BrandButton variant="tool" icon aria-label={SETTINGS_LABEL} popoverTarget={popId} data-testid="app-bar-settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
        </svg>
      </BrandButton>
      <Popover id={popId} title={SETTINGS_LABEL}>
        <BrandButton
          variant="neutral"
          className="w-full"
          aria-haspopup="dialog"
          onClick={() => {
            hidePopover(popId);
            onPlayers();
          }}
        >
          Players
        </BrandButton>
        <p className="ab-pop-note">More campaign settings are on the way.</p>
      </Popover>
    </>
  );
}

/** The player's own character (the first one they can edit), for the avatar. */
function useOwnCharacter(campaignId: Id<"campaigns">) {
  const party = useQuery(api.charactersReads.partySummary, { campaignId });
  return party?.find((member) => member.canEdit && member.corrupt !== true) ?? null;
}

function OwnPortrait({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const character = useOwnCharacter(campaignId);
  if (!character) return <span aria-hidden="true">You</span>;
  const source = portraitSource(character.sheet);
  const src = source.kind === "upload" ? character.portraitUrl : source.kind === "asset" ? designAsset(source.asset) : undefined;
  if (!src) return <span aria-hidden="true">{(character.sheet.name || "?").charAt(0).toUpperCase()}</span>;
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes="44px"
      // Uploads are served by Convex storage (another host); design art is local and optimised.
      unoptimized={source.kind === "upload"}
      style={{ objectFit: "cover", objectPosition: source.kind === "asset" ? source.position : "center 30%" }}
    />
  );
}

/** The avatar: "GM" for the GM; a player's character portrait. Opens a note that preferences are coming. */
export function PreferencesButton({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const popId = `ab-prefs-${useId()}`;
  return (
    <>
      <button
        type="button"
        className={isGm ? "ab-ava" : "ab-ava ab-pc"}
        aria-label={PREFERENCES_LABEL}
        popoverTarget={popId}
        data-testid="app-bar-avatar"
      >
        {isGm ? (
          <span aria-hidden="true">GM</span>
        ) : (
          <SlotBoundary fallback={<span aria-hidden="true">You</span>}>
            <OwnPortrait campaignId={campaignId} />
          </SlotBoundary>
        )}
      </button>
      <Popover id={popId} title={PREFERENCES_LABEL}>
        <p className="ab-pop-note">Your preferences are on the way.</p>
      </Popover>
    </>
  );
}
