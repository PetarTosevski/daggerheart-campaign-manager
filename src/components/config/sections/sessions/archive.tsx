"use client";

import type { ReactNode } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";

import type { SettingsSectionProps } from "../../slots";
import { RowText, SESSIONS_TEXT } from "./rows";

/**
 * 'Archive this campaign' (design `.s-session .danger`): a stub at the end of the Sessions section. Tracer S3 fills it
 * (the archive / restore server, the confirm, the archived banner); until then the button is disabled. Only the
 * campaign's creator archives (config Q7 a), so a co-GM never sees the row.
 */
export function SessionsArchive({ campaign }: SettingsSectionProps): ReactNode {
  if (!campaign.isCreator) return null;
  return (
    <div className="cfg-row" data-testid="settings-archive" style={{ marginTop: 20, borderTopColor: "#4a2a28" }}>
      <RowText {...SESSIONS_TEXT.archive} />
      <button type="button" className={glassButtonClass({ role: "danger", size: "sm" })} disabled>
        {SESSIONS_TEXT.archive.button}
      </button>
    </div>
  );
}
