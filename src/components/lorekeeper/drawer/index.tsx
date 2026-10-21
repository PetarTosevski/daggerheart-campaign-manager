"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";
import { useCampaign } from "@/app/(gm)/campaigns/[campaignId]/campaign-shell";

import { api } from "../../../../convex/_generated/api";
import { SigilIcon } from "../sigil";
import { DRAWER_OPEN_LABEL, DRAWER_PILL_LABEL } from "./labels";

/*
 * The drawer's panel (the chat column, lorekeeper.css, chat.css) is its own chunk, fetched the first time the pill is
 * pressed: campaign pages only carry this pill (PF5: small page bundles).
 */
const DrawerPanel = dynamic(() => import("./panel").then((module) => module.DrawerPanel), { ssr: false });

/**
 * The Lorekeeper over every campaign page (D13 L7, Q13): a floating pill bottom-right opens the chat column as a
 * 440 px side drawer (full width under 760 px). Mounted by the campaign layout inside the campaign shell; absent on
 * the Lorekeeper page itself and while `lorekeeper.available` is false. Its query sits in an error boundary (CL1).
 */
export function LorekeeperDrawer() {
  return (
    <SlotBoundary fallback={null}>
      <DrawerMount />
    </SlotBoundary>
  );
}

function DrawerMount() {
  const campaign = useCampaign();
  const pathname = usePathname();
  const onPage = pathname === `/campaigns/${campaign._id}/lorekeeper`;
  const available = useQuery(api.lorekeeper.available, onPage ? "skip" : { campaignId: campaign._id });
  // The drawer is open on the page it was opened on: moving to another page (a link in an answer) closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  // Load the panel's chunk only once someone has opened it; then keep it for reopening.
  const [wanted, setWanted] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const open = openAt === pathname;

  if (onPage || available !== true) return null;

  function close() {
    setOpenAt(null);
    pill.current?.focus();
  }

  return (
    <>
      <button
        ref={pill}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setWanted(true);
          setOpenAt(pathname);
        }}
        className="fixed right-4 bottom-4 z-40 flex min-h-[52px] cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-[#c9a24a] bg-[#1a120a] py-2.5 pr-4 pl-2.5 font-display text-[15px] font-bold text-[#f3cf86] shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3b45a] sm:right-6 sm:bottom-6"
      >
        <span aria-hidden="true" className="flex size-[30px] items-center justify-center rounded-full border-[1.5px] border-[#c9a24a] bg-[#1a120a]">
          <SigilIcon size={20} />
        </span>
        {open ? DRAWER_OPEN_LABEL : DRAWER_PILL_LABEL}
      </button>
      {wanted ? <DrawerPanel campaignId={campaign._id} access={{ isGm: campaign.role === "gm" }} open={open} onClose={close} /> : null}
    </>
  );
}
