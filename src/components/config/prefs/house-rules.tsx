"use client";

import { useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { RULE_ROWS_TEXT } from "../sections/rules/model";
import { RuleRows } from "../sections/rules/rule-list";
import type { PreferencesSlotProps } from "../slots";

export const HOUSE_RULES_ITEM = "House rules";

/**
 * Players read the campaign's rule switches here (plan rule-switches RU, Q18 a): 'House rules' in the Preferences
 * popover opens the same rows as the GM's settings section, read-only (modes as text, no controls). The GM and co-GMs
 * change them in Campaign settings, so they don't get the item. The rows render only while open, so their query runs
 * only then.
 */
export function HouseRulesItem({ campaignId, isGm }: PreferencesSlotProps): ReactNode {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (isGm) return null;
  return (
    <div className="cfg-row cfg-col cfg-prefs-rules">
      <button type="button" className="cfg-prefs-rules-btn" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span>{HOUSE_RULES_ITEM}</span>
        <ChevronDown size={16} aria-hidden="true" className={open ? "" : "cfg-prefs-rules-shut"} />
      </button>
      <div id={bodyId} hidden={!open}>
        {open ? (
          <SlotBoundary fallback={<p role="alert" className="cfg-muted">{RULE_ROWS_TEXT.failed}</p>}>
            <PlayerRules campaignId={campaignId} />
          </SlotBoundary>
        ) : null}
      </div>
    </div>
  );
}

function PlayerRules({ campaignId }: { campaignId: Id<"campaigns"> }) {
  // The shell's own subscription (same query and args), so this costs nothing extra.
  const campaign = useQuery(api.campaigns.get, { campaignId });
  if (campaign === undefined || campaign === null) {
    return (
      <p role="status" className="cfg-muted">
        {RULE_ROWS_TEXT.loading}
      </p>
    );
  }
  return <RuleRows campaignId={campaignId} frameId={campaign.frameId} editable={false} />;
}
