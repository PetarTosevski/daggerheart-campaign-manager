"use client";

import "./rules.css";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { optionsFor, type CampaignOptionId } from "@/lib/frames/options";

import { api } from "../../../../../convex/_generated/api";
import type { SettingsSectionProps } from "../../slots";
import { Rulings } from "./rulings";
import { RULES_TEXT } from "./text";

export { RULES_TEXT, rulingOrigin } from "./text";

/**
 * Campaign settings, House rules (plan config U2, design `.s-rules`):
 * - today's campaign options for this frame (`optionsFor(frameId)`) as switches tagged 'Campaign option'. They write
 *   `campaigns.setOption` with an optimistic update on `campaigns.get`, the same field the dashboard's Campaign Rules
 *   panel writes (Q10 b), so the two always agree. The board's rule switches (Massive damage, Action tracker) are a
 *   later plan (dcm-bxp.134) and are not here;
 * - the table rulings the Lorekeeper quotes (`lorekeeperRulings`): add, edit and unpin (./rulings.tsx).
 */
export function HouseRulesSection({ campaign }: SettingsSectionProps): ReactNode {
  const campaignId = campaign._id;
  const options = optionsFor(campaign.frameId);
  const setOption = useMutation(api.campaigns.setOption).withOptimisticUpdate((store, { option, enabled }) => {
    const current = store.getQuery(api.campaigns.get, { campaignId });
    if (current) store.setQuery(api.campaigns.get, { campaignId }, { ...current, options: { ...current.options, [option]: enabled } });
  });
  const [error, setError] = useState<string | null>(null);

  function toggle(option: CampaignOptionId, enabled: boolean) {
    setError(null);
    setOption({ campaignId, option, enabled }).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <div data-testid="settings-rules">
      <p className="cfg-hint">{RULES_TEXT.hint}</p>
      {options.length > 0 ? (
        <ul className="cfg-rules-list" aria-label={RULES_TEXT.optionsLabel}>
          {options.map((o) => (
            <li key={o.id} className="cfg-row">
              <div className="cfg-row-t">
                <b>{o.label}</b>
                <span>{o.description}</span>
                <em>{RULES_TEXT.optionTag}</em>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={campaign.options[o.id]}
                aria-label={o.label}
                className="cfg-sw"
                onClick={() => toggle(o.id, !campaign.options[o.id])}
              >
                <i />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="cfg-muted cfg-rules-err">
        {error}
      </p>
      <Rulings campaignId={campaignId} />
    </div>
  );
}
