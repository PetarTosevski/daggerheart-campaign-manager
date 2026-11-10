"use client";

import type { ReactNode } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";
import { EXPANSION_OPTIONS } from "@/lib/frames/options";

import type { SettingsSectionProps } from "../../slots";
import { CampaignOptions } from "../rules";

export const EXPANSIONS_TEXT = {
  hint: "Turn an expansion's content on for this campaign: its classes, ancestries, communities, transformations, equipment and adversaries.",
  label: "Expansions",
  tag: "Expansion",
  failed: "The expansions couldn't load. Close the settings and open them again.",
} as const;

/**
 * Campaign settings, Expansions (user 2026-11-09: Hope & Fear moved out of House rules): the expansion content
 * switches. Same field, optimistic update and live-session lock as House rules' campaign options (`CampaignOptions`).
 */
export function ExpansionsSection({ campaign }: SettingsSectionProps): ReactNode {
  return (
    <div data-testid="settings-expansions">
      <p className="cfg-hint">{EXPANSIONS_TEXT.hint}</p>
      <SlotBoundary fallback={<p role="alert" className="cfg-muted">{EXPANSIONS_TEXT.failed}</p>}>
        <CampaignOptions campaign={campaign} pick={(id) => EXPANSION_OPTIONS.includes(id)} label={EXPANSIONS_TEXT.label} tag={EXPANSIONS_TEXT.tag} />
      </SlotBoundary>
    </div>
  );
}
