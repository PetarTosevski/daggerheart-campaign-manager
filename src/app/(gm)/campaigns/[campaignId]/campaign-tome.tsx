"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import type { TomeChapterId } from "@/lib/frames/tomes";

import type { CampaignSummary } from "../../../../../convex/campaigns";

/** Shown while the tome's chunk loads: the book's leather cover over the dialog backdrop (Tome* boards). */
function TomeLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(4_8_10/0.78)] p-3">
      <p
        role="status"
        className="m-0 rounded-2xl border border-[#5c4430] bg-[#3b2b1d] px-8 py-6 font-display text-[22px] text-[#f1e3c4] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        Opening the tome…
      </p>
    </div>
  );
}

// CL8: the book and every frame's lore (tomes.ts) load only when the tome is first opened.
const CampaignTomeBook = dynamic(() => import("./campaign-tome-book").then((m) => m.CampaignTomeBook), {
  ssr: false,
  loading: TomeLoading,
});

/** The campaign's tome: the frame's lore book, or the GM-written book of a custom campaign. Mounts on first open. */
export function CampaignTome(props: {
  campaign: CampaignSummary;
  chapter: TomeChapterId | null;
  onChapter: (chapter: TomeChapterId) => void;
  onClose: () => void;
}) {
  // Stays mounted after the first open, so closing the dialog returns focus as before.
  const [opened, setOpened] = useState(false);
  if (props.chapter !== null && !opened) setOpened(true);
  return opened ? <CampaignTomeBook {...props} /> : null;
}
