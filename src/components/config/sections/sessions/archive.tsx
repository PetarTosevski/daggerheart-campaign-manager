"use client";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { SettingsSectionProps } from "../../slots";
import { RowText, SESSIONS_TEXT } from "./rows";

/** The row while the campaign is archived: the creator restores it here (and from the banner, Load Campaign). */
export const ARCHIVED_ROW_TEXT = {
  label: "This campaign is archived",
  hint: "Everything is read-only for everyone. Restore it to make changes again.",
  button: "Restore",
} as const;

/** The inline confirm: the text and both buttons on one wrapping line, in the danger row's colour. */
const CONFIRM_STYLE = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  width: "100%",
  fontSize: 13,
  color: "#f3a58f",
} as const;

/**
 * 'Archive this campaign' (design `.s-session .danger`; plan config S3, Q9 a): the last row of the Sessions section.
 * Only the campaign's creator archives (config Q7 a), so a co-GM never sees the row. 'Archive…' opens an inline confirm;
 * the server refuses while a session is live ('End the session first.', shown under the row). While archived the row
 * offers Restore instead. Both are one click with no optimistic update: `campaigns.get` flips `archived` for every
 * member at once, and the banner (`ArchivedBanner`) follows it.
 */
export function SessionsArchive({ campaign }: SettingsSectionProps): ReactNode {
  const archive = useMutation(api.campaignSettings.archive);
  const unarchive = useMutation(api.campaignSettings.unarchive);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!campaign.isCreator) return null;

  const run = (action: Promise<null>) => {
    setError(null);
    setBusy(true);
    action.then(
      () => {
        setBusy(false);
        setConfirming(false);
      },
      (e: unknown) => {
        setBusy(false);
        setError(errorMessage(e));
      },
    );
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div className="cfg-row" data-testid="settings-archive" style={{ borderTopColor: "#4a2a28" }}>
        {campaign.archived ? (
          <>
            <RowText label={ARCHIVED_ROW_TEXT.label} hint={ARCHIVED_ROW_TEXT.hint} />
            <BrandButton variant="confirm" size="sm" disabled={busy} onClick={() => run(unarchive({ campaignId: campaign._id }))}>
              {ARCHIVED_ROW_TEXT.button}
            </BrandButton>
          </>
        ) : confirming ? (
          <div role="group" aria-label={`Archive ${campaign.name}?`} style={CONFIRM_STYLE}>
            <span>Archive {campaign.name}? Everyone keeps reading it; nobody can change it until you restore it.</span>
            <BrandButton variant="danger" size="sm" disabled={busy} onClick={() => run(archive({ campaignId: campaign._id }))}>
              Archive
            </BrandButton>
            <BrandButton variant="cancel" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </BrandButton>
          </div>
        ) : (
          <>
            <RowText {...SESSIONS_TEXT.archive} />
            <BrandButton
              variant="danger"
              size="sm"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              {SESSIONS_TEXT.archive.button}
            </BrandButton>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="cfg-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
