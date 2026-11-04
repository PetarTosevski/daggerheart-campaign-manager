"use client";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { TableSettingChange } from "../../../../../convex/campaignSettings";
import type { SettingsSectionProps } from "../../slots";
import { SessionsArchive } from "./archive";
import { ChoiceRow, SESSIONS_TEXT, SwitchRow } from "./rows";

export { SESSIONS_TEXT } from "./rows";

/**
 * Campaign settings, Sessions (plan config U5, design `.s-session`). Each row writes `campaignSettings.set`, one field
 * per call with an optimistic update on `campaigns.get` (rule 12), and reads the live settings (`props.campaign`):
 * - 'GM Fear at the start of a session' Carry over / Reset to number of PCs (`fearAtStart`; R3 applies it in
 *   `sessions.start`);
 * - 'A new session opens on' Journal / Combat Map (`sessionOpensOn`; JO1 applies it);
 * - 'Write the session log from the Combat Map' (`autoSessionLog`; JO2 applies it);
 * - `SessionsArchive`, S3's slot ('Archive this campaign', creator only).
 * No clock row (Q4 d: the clock stays manual).
 */
export function SessionsSection(props: SettingsSectionProps): ReactNode {
  const { campaign } = props;
  const campaignId = campaign._id;
  const setSetting = useMutation(api.campaignSettings.set).withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.campaigns.get, { campaignId });
    if (current) store.setQuery(api.campaigns.get, { campaignId }, { ...current, settings: { ...current.settings, [change.key]: change.value } });
  });
  const [error, setError] = useState<string | null>(null);

  function change(c: TableSettingChange) {
    setError(null);
    setSetting({ campaignId, change: c }).catch((e: unknown) => setError(errorMessage(e)));
  }
  const { settings } = campaign;

  return (
    <div data-testid="settings-sessions">
      <ChoiceRow
        {...SESSIONS_TEXT.fearAtStart}
        value={settings.fearAtStart}
        onChange={(value) => change({ key: "fearAtStart", value })}
      />
      <ChoiceRow {...SESSIONS_TEXT.opensOn} value={settings.sessionOpensOn} onChange={(value) => change({ key: "sessionOpensOn", value })} />
      <SwitchRow {...SESSIONS_TEXT.sessionLog} checked={settings.autoSessionLog} onChange={(value) => change({ key: "autoSessionLog", value })} />
      <p aria-live="polite" className="cfg-muted" style={error ? { marginTop: 8, color: "#f0a8a0" } : undefined}>
        {error}
      </p>
      <SessionsArchive {...props} />
    </div>
  );
}
