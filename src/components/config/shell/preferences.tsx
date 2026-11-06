"use client";

import "../config.css";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";

import { BrandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AppAdminLink } from "../prefs/admin-link";
import { PreferenceRows } from "../prefs";
import { PREFERENCES_SAVED_LABEL } from "../slots";
import { AvatarFace } from "./avatar";
import { openSettings } from "./url";

type Props = {
  campaignId: Id<"campaigns">;
  isGm: boolean;
  /** Closes the popover (before Campaign settings opens over it). */
  onDone: () => void;
};

/** The account line: the user's name (else 'You') and 'Game Master' / 'Player' · the campaign's name. */
function Who({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const viewer = useQuery(api.users.viewer);
  // The shell's own subscription (same query and args), so this costs nothing extra.
  const campaign = useQuery(api.campaigns.get, { campaignId });
  return (
    <div className="cfg-row-t">
      <b>{viewer?.name?.trim() || "You"}</b>
      <span>
        {isGm ? "Game Master" : "Player"}
        {campaign ? ` · ${campaign.name}` : null}
      </span>
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  return (
    <BrandButton variant="neutral" size="sm" className="flex-1" onClick={() => void signOut().then(() => router.push("/signin"))}>
      <LogOut aria-hidden="true" />
      Sign out
    </BrandButton>
  );
}

/**
 * The Preferences popover's body (design `.pm-pop`). Rendered only while the popover is open. Each slot sits in its
 * own boundary (CL1).
 */
export function PreferencesBody({ campaignId, isGm, onDone }: Props) {
  const slot = { campaignId, isGm };
  return (
    <>
      <div className="cfg-pm-h">
        <AvatarFace campaignId={campaignId} isGm={isGm} big />
        <SlotBoundary fallback={<div className="cfg-row-t"><b>You</b></div>}>
          <Who campaignId={campaignId} isGm={isGm} />
        </SlotBoundary>
      </div>
      <p className="cfg-lbl">{PREFERENCES_SAVED_LABEL}</p>
      <SlotBoundary fallback={<p role="alert" className="cfg-muted">Your preferences could not load.</p>}>
        <PreferenceRows {...slot} />
      </SlotBoundary>
      <SlotBoundary fallback={null}>
        <AppAdminLink {...slot} />
      </SlotBoundary>
      <div className="cfg-pm-f">
        {isGm ? (
          <BrandButton
            variant="neutral"
            size="sm"
            className="flex-1"
            aria-haspopup="dialog"
            onClick={() => {
              onDone();
              openSettings("table");
            }}
          >
            <Settings aria-hidden="true" />
            Campaign settings
          </BrandButton>
        ) : null}
        <SignOutButton />
      </div>
    </>
  );
}
