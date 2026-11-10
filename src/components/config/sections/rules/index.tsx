"use client";

import "./rules.css";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";
import { errorMessage } from "@/lib/convex-errors";
import { EXPANSION_OPTIONS, optionsFor, type CampaignOptionId } from "@/lib/frames/options";

import { api } from "../../../../../convex/_generated/api";
import type { SettingsSectionProps } from "../../slots";
import { RULE_ROWS_TEXT } from "./model";
import { RuleRows, useRuleSettings } from "./rule-list";
import { Rulings } from "./rulings";
import { RULES_TEXT } from "./text";

export { RULES_TEXT, rulingOrigin } from "./text";
export { RuleRows } from "./rule-list";

/**
 * Campaign settings, House rules (plan config U2, design `.s-rules`; plan rule-switches RU):
 * - the rule rows (./rule-list.tsx): every rule of the campaign's frame from the registry, by area, with its mode
 *   picker, optional switch or read-only Book row; locked while a session is live;
 * - today's campaign options for this frame (`optionsFor(frameId)`) as switches tagged 'Campaign option'. They write
 *   `campaigns.setOption` with an optimistic update on `campaigns.get`, the same field the dashboard's Campaign Rules
 *   panel writes (Q10 b), so the two always agree; locked with the rule switches while a session is live (Q17 a);
 * - the table rulings the Lorekeeper quotes (`lorekeeperRulings`): add, edit and unpin (./rulings.tsx).
 * Each part that reads a query sits in its own error boundary (CL1).
 */
export function HouseRulesSection({ campaign }: SettingsSectionProps): ReactNode {
  return (
    <div data-testid="settings-rules">
      <p className="cfg-lbl">{RULE_ROWS_TEXT.label}</p>
      <SlotBoundary fallback={<p role="alert" className="cfg-muted">{RULE_ROWS_TEXT.failed}</p>}>
        <RuleRows campaignId={campaign._id} frameId={campaign.frameId} editable />
      </SlotBoundary>
      <SlotBoundary fallback={<p role="alert" className="cfg-muted">{RULE_ROWS_TEXT.failed}</p>}>
        <CampaignOptions campaign={campaign} pick={(id) => !EXPANSION_OPTIONS.includes(id)} label={RULES_TEXT.optionsLabel} tag={RULES_TEXT.optionTag} />
      </SlotBoundary>
      <p className="cfg-lbl cfg-rules-gap">{RULES_TEXT.rulingsLabel}</p>
      <p className="cfg-hint">{RULES_TEXT.hint}</p>
      <Rulings campaignId={campaign._id} />
    </div>
  );
}

/**
 * Campaign options as switches; disabled while a session is live (the server refuses with RULES_LOCKED). House rules
 * shows the frame rules, Expansions (../expansions) the expansion content switches: `pick` chooses which.
 */
export function CampaignOptions({
  campaign,
  pick,
  label,
  tag,
}: SettingsSectionProps & { pick: (id: CampaignOptionId) => boolean; label: string; tag: string }): ReactNode {
  const campaignId = campaign._id;
  const options = optionsFor(campaign.frameId).filter((o) => pick(o.id));
  const locked = useRuleSettings(campaignId)?.locked === true;
  const setOption = useMutation(api.campaigns.setOption).withOptimisticUpdate((store, { option, enabled }) => {
    const current = store.getQuery(api.campaigns.get, { campaignId });
    if (current) store.setQuery(api.campaigns.get, { campaignId }, { ...current, options: { ...current.options, [option]: enabled } });
  });
  const [error, setError] = useState<string | null>(null);

  function toggle(option: CampaignOptionId, enabled: boolean) {
    setError(null);
    setOption({ campaignId, option, enabled }).catch((e: unknown) => setError(errorMessage(e)));
  }

  if (options.length === 0) return null;
  return (
    <>
      <p className="cfg-lbl cfg-rules-gap">{label}</p>
      <ul className="cfg-rules-list" aria-label={label}>
        {options.map((o) => (
          <li key={o.id} className="cfg-row">
            <div className="cfg-row-t">
              <b>{o.label}</b>
              <span>{o.description}</span>
              <em>{tag}</em>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={campaign.options[o.id]}
              aria-label={o.label}
              className="cfg-sw"
              disabled={locked}
              onClick={() => toggle(o.id, !campaign.options[o.id])}
            >
              <i />
            </button>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="cfg-muted cfg-rules-err">
        {error}
      </p>
    </>
  );
}
