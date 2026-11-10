"use client";

import { useMutation } from "convex/react";

import { GiveTransformation, transformationOfRule } from "@/components/tome/give-transformation";
import { TomeBook } from "@/components/tome/tome-book";
import { campaignArt } from "@/lib/campaign-art";
import { getPublishedFrame } from "@/lib/frames";
import { TOMES, type TomeChapterId, type TomeRule } from "@/lib/frames/tomes";

import { api } from "../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../convex/campaigns";

const EMPTY_TOME = { overview: "", incident: "", mechanics: "" };

/** The tome book itself (loaded with next/dynamic by campaign-tome.tsx): the frame's lore book, or the GM-written book of a custom campaign. */
export function CampaignTomeBook({
  campaign,
  chapter,
  onChapter,
  onClose,
}: {
  campaign: CampaignSummary;
  chapter: TomeChapterId | null;
  onChapter: (chapter: TomeChapterId) => void;
  onClose: () => void;
}) {
  const updateTome = useMutation(api.campaigns.updateTome);
  const art = campaignArt(campaign.frameId, campaign.custom?.background);
  const frame = campaign.frameId === "custom" ? null : getPublishedFrame(campaign.frameId)!;

  // Bead dcm-psg9: the GM of an Andaluria campaign with Hope & Fear content gives a rule's transformation to a PC.
  const gives = frame?.id === "dark-heart-of-andaluria" && campaign.role === "gm" && Boolean(campaign.options.hopeAndFear);
  const ruleAction = gives
    ? (rule: TomeRule) => {
        const id = transformationOfRule(rule);
        return id === null ? null : <GiveTransformation campaignId={campaign._id} transformationId={id} andaluriaReanimated={Boolean(campaign.options.transformations)} />;
      }
    : undefined;

  const content = frame
    ? ({ kind: "published", tome: TOMES[frame.id], ruleAction } as const)
    : ({
        kind: "custom",
        text: campaign.tome ?? EMPTY_TOME,
        onSave:
          campaign.role === "gm"
            ? (c: TomeChapterId, text: string) => updateTome({ campaignId: campaign._id, chapter: c, text })
            : undefined,
        setup: [
          { label: "Pitch", value: campaign.custom?.pitch ?? "" },
          { label: "Themes", value: campaign.custom?.themes ?? "" },
          { label: "Touchstones", value: campaign.custom?.touchstones ?? "" },
          { label: "Tone", value: (campaign.custom?.tones ?? []).join(", ") },
        ].filter((row) => row.value.trim()),
      } as const);

  return (
    <TomeBook
      open={chapter !== null}
      onClose={onClose}
      chapter={chapter ?? "overview"}
      onChapter={onChapter}
      kicker={frame ? `Campaign Frame · ${frame.expansion ? "Hope & Fear" : "Core Rulebook"}` : "Custom Campaign Frame"}
      title={frame ? frame.name : campaign.name}
      art={art}
      content={content}
    />
  );
}
