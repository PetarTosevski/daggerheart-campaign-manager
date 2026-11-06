"use client";

import "./table.css";

import { useMutation, useQuery } from "convex/react";
import { Lock } from "lucide-react";
import { useState, type ReactNode } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import type { OutOfRange } from "@/lib/config/campaign-settings";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { TableSettingChange } from "../../../../../convex/campaignSettings";
import type { SettingsSectionProps } from "../../slots";

/** The board's text for the At the table rows (reference/designs/config/Settings.dc.html, `.s-table`). */
export const TABLE_TEXT = {
  hands: { label: "Players can see each other’s hands", hint: "Each player can still hide their own hand." },
  fear: { label: "Players see the GM’s Fear", hint: "The Fear banner on the Combat Map." },
  outOfRange: { label: "Out-of-range actions", hint: "When a card or attack targets something beyond its range." },
  spotlight: { label: "Show spotlight balance to players", hint: "The bars in the session recap." },
  adversary: { label: "Show adversary HP, Stress and Difficulty to players", hint: "Players see Hit, Miss or Defeated instead." },
  locked: "Always off",
  /** Rule switches ODR: the Out-of-range row while the optional rule Defined Ranges (CB p.103) is off. */
  rangesOff: "Defined Ranges is off",
} as const;

const OUT_OF_RANGE_LABEL: Record<OutOfRange, string> = { ask: "Ask me", refuse: "Refuse" };

/**
 * Campaign settings, At the table (plan config U1, design `.s-table`). Every switch saves on change with an optimistic
 * update (rule 12), one field per call:
 * - hand sharing writes `campaigns.setPlayersSeeHands` and reads `combatCardsReads.handSharing`, the same pair as the
 *   Combat Map's switch (Q10 b), so the two stay in step;
 * - Fear, out of range and spotlight balance write `campaignSettings.set` and read the live `campaigns.get` settings
 *   (`props.campaign`). The rules they change are R1 / R2 / JO3's, not built here;
 * - the adversary stats row is locked off (no setting): players never get those numbers;
 * - rule switches ODR: while the optional rule Defined Ranges is off (`ruleSettings.get`; on until it loads) nothing is
 *   out of range, so the Out-of-range row is disabled and says "Defined Ranges is off" (the stored choice is kept).
 */
export function TableSection({ campaign }: SettingsSectionProps): ReactNode {
  const campaignId = campaign._id;
  const sharing = useQuery(api.combatCardsReads.handSharing, { campaignId });
  const definedRanges = useQuery(api.ruleSettings.get, { campaignId })?.modes.definedRanges ?? true;
  const setHands = useMutation(api.campaigns.setPlayersSeeHands).withOptimisticUpdate((store, { enabled }) => {
    const current = store.getQuery(api.combatCardsReads.handSharing, { campaignId });
    if (current !== undefined) store.setQuery(api.combatCardsReads.handSharing, { campaignId }, { ...current, playersSeeHands: enabled });
  });
  const setSetting = useMutation(api.campaignSettings.set).withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.campaigns.get, { campaignId });
    if (current) store.setQuery(api.campaigns.get, { campaignId }, { ...current, settings: { ...current.settings, [change.key]: change.value } });
  });
  const [error, setError] = useState<string | null>(null);

  async function run(write: () => Promise<unknown>) {
    setError(null);
    try {
      await write();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const change = (c: TableSettingChange) => void run(() => setSetting({ campaignId, change: c }));
  const { settings } = campaign;

  return (
    <div data-testid="settings-table">
      <div className="cfg-row">
        <RowText {...TABLE_TEXT.hands} />
        {sharing === undefined ? (
          <p role="status" className="cfg-muted">
            Loading …
          </p>
        ) : (
          <Switch label={TABLE_TEXT.hands.label} checked={sharing.playersSeeHands} onChange={(enabled) => void run(() => setHands({ campaignId, enabled }))} />
        )}
      </div>
      <div className="cfg-row">
        <RowText {...TABLE_TEXT.fear} />
        <Switch label={TABLE_TEXT.fear.label} checked={settings.playersSeeFear} onChange={(value) => change({ key: "playersSeeFear", value })} />
      </div>
      <div className="cfg-row cfg-col">
        <RowText {...TABLE_TEXT.outOfRange} />
        {definedRanges ? null : (
          <span className="cfg-muted cfg-lock" data-testid="settings-table-ranges-off">
            <Lock size={16} aria-hidden="true" />
            {TABLE_TEXT.rangesOff}
          </span>
        )}
        <div className="cfg-seg" role="group" aria-label={TABLE_TEXT.outOfRange.label}>
          {(Object.keys(OUT_OF_RANGE_LABEL) as OutOfRange[]).map((value) => (
            <button
              key={value}
              type="button"
              className={glassButtonClass({ role: "neutral" })}
              disabled={!definedRanges}
              aria-pressed={settings.outOfRange === value}
              onClick={() => {
                if (settings.outOfRange !== value) change({ key: "outOfRange", value });
              }}
            >
              {OUT_OF_RANGE_LABEL[value]}
            </button>
          ))}
        </div>
      </div>
      <div className="cfg-row">
        <RowText {...TABLE_TEXT.spotlight} />
        <Switch label={TABLE_TEXT.spotlight.label} checked={settings.spotlightToPlayers} onChange={(value) => change({ key: "spotlightToPlayers", value })} />
      </div>
      <div className="cfg-row">
        <RowText {...TABLE_TEXT.adversary} />
        <span className="cfg-muted cfg-lock">
          <Lock size={16} aria-hidden="true" />
          {TABLE_TEXT.locked}
        </span>
        <Switch label={TABLE_TEXT.adversary.label} checked={false} disabled />
      </div>
      <p aria-live="polite" className="cfg-muted cfg-err">
        {error}
      </p>
    </div>
  );
}

function RowText({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="cfg-row-t">
      <b>{label}</b>
      <span>{hint}</span>
    </div>
  );
}

/** The design's `.sw`: a button with role switch (the shared `cfg-sw` class). */
function Switch({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange?: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="cfg-sw" disabled={disabled} onClick={() => onChange?.(!checked)}>
      <i />
    </button>
  );
}
