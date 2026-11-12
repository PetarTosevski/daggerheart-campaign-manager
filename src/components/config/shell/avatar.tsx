"use client";

import { useQuery } from "convex/react";
import Image from "next/image";

import { portraitSource } from "@/components/party/portrait-source";
import { SlotBoundary } from "@/components/party/session/boundary";
import { designAsset } from "@/lib/design-assets";
import { portraitFrameStyle } from "@/lib/party/portrait-frame";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** The player's own character (the first one they can edit), for the avatar. */
function useOwnCharacter(campaignId: Id<"campaigns">) {
  const party = useQuery(api.charactersReads.partySummary, { campaignId });
  return party?.find((member) => member.canEdit && member.corrupt !== true) ?? null;
}

function OwnPortrait({ campaignId, size }: { campaignId: Id<"campaigns">; size: number }) {
  const character = useOwnCharacter(campaignId);
  if (!character) return <span aria-hidden="true">You</span>;
  const source = portraitSource(character.sheet);
  const src = source.kind === "upload" ? character.portraitUrl : source.kind === "asset" ? designAsset(source.asset) : undefined;
  if (!src) return <span aria-hidden="true">{(character.sheet.name || "?").charAt(0).toUpperCase()}</span>;
  // The saved close-up (plan portrait-frame, PZ2) as object-position and a scale; `.cfg-face` clips it. No frame: only
  // the position, as before (undefined style values are not written).
  const framed = portraitFrameStyle(character.sheet.portraitFrame, source.kind === "asset" ? source.position : "center 30%");
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes={`${size}px`}
      // Uploads are served by Convex storage (another host); design art is local and optimised.
      unoptimized={source.kind === "upload"}
      style={{ objectFit: "cover", objectPosition: framed.backgroundPosition, transform: framed.transform, transformOrigin: framed.transformOrigin }}
    />
  );
}

/**
 * The face on the avatar button and in the Preferences popover's head (HUD H9.A's look, design `.pf`): 'GM' for the
 * GM; a player's own character portrait (uploaded image or design art), else its initial, else 'You'. Decorative: the
 * button carries the name.
 */
export function AvatarFace({ campaignId, isGm, big = false }: { campaignId: Id<"campaigns">; isGm: boolean; big?: boolean }) {
  const size = big ? 40 : 36;
  return (
    <span className={cn("cfg-face", isGm ? "cfg-face-gm" : "cfg-face-pc", big && "cfg-face-big")}>
      {isGm ? (
        <span aria-hidden="true">GM</span>
      ) : (
        <SlotBoundary fallback={<span aria-hidden="true">You</span>}>
          <OwnPortrait campaignId={campaignId} size={size} />
        </SlotBoundary>
      )}
    </span>
  );
}
