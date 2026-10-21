"use client";

import { useMutation, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/brand/brand";
import { BrandButton, brandButton } from "@/components/brand/buttons";
import { frameName, roman } from "@/lib/campaign-display";
import { errorMessage } from "@/lib/convex-errors";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CampaignListItem } from "../../../../convex/campaigns";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Band({
  campaign,
  index,
  open,
  onToggle,
  onDeleted,
}: {
  campaign: CampaignListItem;
  index: number;
  open: boolean;
  onToggle: () => void;
  onDeleted: (campaign: CampaignListItem) => void;
}) {
  const remove = useMutation(api.campaigns.remove);
  const leave = useMutation(api.members.leave);
  const isGm = campaign.role === "gm";
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      id={`campaign-${index}`}
      className={cn("flex-none scroll-mt-2 rounded-2xl border", open ? "border-brand bg-[#1c1a27]" : "border-[#272434] bg-[#15141d]")}
    >
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          onToggle();
        }}
        aria-expanded={open}
        className="flex min-h-[150px] w-full cursor-pointer flex-wrap items-center gap-x-9 gap-y-6 px-6 py-6 text-left text-parchment sm:px-10"
      >
        <span
          className={cn(
            "w-[100px] text-center font-display text-[64px] leading-none font-black sm:w-[140px] sm:text-[80px]",
            open ? "text-brand" : "text-[#3f3a4e]",
          )}
          aria-hidden="true"
        >
          {roman(index)}
        </span>
        <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] tracking-[0.22em] text-muted-text uppercase">
            <span>
              Tier {campaign.tier} · Level {campaign.level} · {frameName(campaign.frameId)}
            </span>
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] tracking-[0.16em]",
                isGm ? "border-brand/60 text-brand" : "border-[#5b4a8f] text-fear",
              )}
            >
              {isGm ? "Game Master" : "Player"}
            </span>
          </span>
          <span className="font-display text-[28px] font-bold tracking-[0.03em] sm:text-[34px]">{campaign.name}</span>
          <span className="text-[15px] text-label">
            Started {dateFormat.format(campaign.createdAt)} · Last opened {dateFormat.format(campaign.lastOpenedAt)}
          </span>
        </span>
        <span className="flex gap-2.5">
          <span className="flex min-w-[76px] flex-col items-center gap-0.5 rounded-[10px] bg-[#16262a] px-3.5 py-2.5 text-[#9fd3c7]">
            <span className="text-[12px] tracking-[0.12em] uppercase">Players</span>
            <strong className="text-[24px]">{campaign.players}</strong>
          </span>
          <span className="flex min-w-[76px] flex-col items-center gap-0.5 rounded-[10px] bg-fear-bg px-3.5 py-2.5 text-fear">
            <span className="text-[12px] tracking-[0.12em] uppercase">Fear</span>
            <strong className="text-[24px]">{campaign.fear}</strong>
          </span>
        </span>
      </button>

      {open ? (
        <div className="flex flex-wrap items-center justify-end gap-4 px-6 pb-7 sm:pr-10 sm:pl-[216px]">
          <div className="flex flex-wrap gap-3">
            <Link href={`/campaigns/${campaign._id}`} className={brandButton({ variant: "solid", size: "lg", className: "px-7" })}>
              Resume Campaign
            </Link>
            <BrandButton
              variant="danger"
              size="lg"
              aria-label={`${isGm ? "Delete" : "Leave"} ${campaign.name}`}
              onClick={() => setConfirming(true)}
            >
              {isGm ? <Trash2 className="!size-4" strokeWidth={1.8} aria-hidden="true" /> : null}
              {isGm ? "Delete" : "Leave"}
            </BrandButton>
          </div>
        </div>
      ) : null}

      {open && confirming ? (
        <div
          role="alertdialog"
          aria-label={isGm ? "Confirm delete" : "Confirm leave"}
          className="mx-6 mb-7 flex flex-wrap items-center gap-3 rounded-[10px] border border-danger-line bg-danger-bg px-4 py-3.5 sm:mr-10 sm:ml-[216px]"
        >
          <span className="flex-[1_1_260px] text-[15px] text-[#ffd9d6]">
            {isGm ? "Delete" : "Leave"} <strong>{campaign.name}</strong>?{" "}
            {isGm
              ? "It will be removed from your saved campaigns."
              : "You'll need a new invite or join code to come back."}
          </span>
          <BrandButton variant="outline" className="border-[#5a3a3a]" onClick={() => setConfirming(false)}>
            Keep it
          </BrandButton>
          <BrandButton
            variant="dangerSolid"
            onClick={() => {
              setError(null);
              (isGm ? remove({ campaignId: campaign._id }) : leave({ campaignId: campaign._id }))
                .then(() => (isGm ? onDeleted(campaign) : undefined))
                .catch((e) => setError(errorMessage(e)));
            }}
          >
            {isGm ? "Delete" : "Leave"}
          </BrandButton>
          {error ? (
            <p role="alert" className="m-0 w-full text-[14px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Chronicle board: the GM's saved campaigns. */
export function Chronicle() {
  const campaigns = useQuery(api.campaigns.list);
  const restore = useMutation(api.campaigns.restore);
  const [openId, setOpenId] = useState<Id<"campaigns"> | null | undefined>(undefined);
  const [deleted, setDeleted] = useState<CampaignListItem | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  // Oldest first, so the first campaign you made is I (user 2026-10-21); the server lists most recently opened first.
  const ordered = useMemo(() => (campaigns === undefined ? undefined : [...campaigns].sort((x, y) => x.createdAt - y.createdAt)), [campaigns]);
  // The most recently opened campaign starts expanded.
  const expanded = openId === undefined ? campaigns?.[0]?._id : openId;

  return (
    <div className="flex min-h-screen flex-col bg-ink-2 text-parchment">
      <PageHeader backHref="/" backLabel="Back to main menu" title="Load Campaign" />

      <div className="flex min-h-0 flex-1 gap-6 px-4 pt-8 pb-10 sm:px-12">
        <div className="flex min-w-0 flex-1 flex-col gap-4 pr-1.5">
          {deleted ? (
            <div
              role="status"
              className="flex flex-none flex-wrap items-center justify-between gap-3 rounded-xl border border-line-2 bg-[#1c1a27] px-4 py-3 text-[15px]"
            >
              <span>{undoError ?? `Deleted ${deleted.name}.`}</span>
              <BrandButton
                variant="outline"
                size="sm"
                className="border-brand text-brand"
                onClick={() => {
                  setUndoError(null);
                  restore({ campaignId: deleted._id })
                    .then(() => {
                      setOpenId(deleted._id);
                      setDeleted(null);
                    })
                    .catch((e) => setUndoError(errorMessage(e)));
                }}
              >
                Undo
              </BrandButton>
            </div>
          ) : null}

          {campaigns === undefined ? (
            <p className="text-muted-text">Loading campaigns…</p>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3.5 rounded-2xl border-2 border-dashed border-line-2 px-6 py-12 text-center text-[16px] text-label">
              No saved campaigns.
              <Link href="/new" className={brandButton({ variant: "solid", size: "md" })}>
                Create a campaign
              </Link>
            </div>
          ) : (
            ordered!.map((campaign, index) => (
              <Band
                key={campaign._id}
                campaign={campaign}
                index={index}
                open={campaign._id === expanded}
                onToggle={() => setOpenId(campaign._id === expanded ? null : campaign._id)}
                onDeleted={(c) => {
                  setUndoError(null);
                  setDeleted(c);
                  setOpenId(null);
                }}
              />
            ))
          )}
        </div>

        {campaigns && campaigns.length > 1 ? (
          <nav aria-label="Jump to campaign" className="hidden flex-none flex-col items-center justify-center gap-1 sm:flex">
            {ordered!.map((campaign, index) => {
              const on = campaign._id === expanded;
              return (
                <a
                  key={campaign._id}
                  href={`#campaign-${index}`}
                  aria-label={`Campaign ${roman(index)}`}
                  onClick={() => setOpenId(campaign._id)}
                  className="flex size-11 items-center justify-center"
                >
                  <span className={cn("block w-2 rounded-full", on ? "h-7 bg-brand" : "h-2 bg-[#4a4458]")} />
                </a>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
