"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSlot, CampaignSlotProps } from "../slots";

import { ImportBoundary } from "./boundary";

// D5 photo import (T7). Contract: ../slots.ts.

// The flow carries the rules data for the review form; load it only when the GM opens it.
const ImportFlow = dynamic(() => import("./flow").then((m) => m.ImportFlow), {
  loading: () => (
    <p role="status" className="m-0 text-[15px] text-[#9fb2b6]">
      Loading…
    </p>
  ),
});

function Gate({ campaignId, hopeAndFear }: CampaignSlotProps) {
  const available = useQuery(api.photoImport.available, { campaignId });
  const [open, setOpen] = useState(false);
  if (available !== true) return null;
  return (
    <>
      <BrandButton variant="pill" size="xl" onClick={() => setOpen(true)}>
        Import from photo
      </BrandButton>
      <Modal open={open} onClose={() => setOpen(false)} title="Import from photo" className="max-w-[860px]">
        <ImportFlow campaignId={campaignId} hopeAndFear={hopeAndFear} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

/** The GM's "Import from photo" button on the roster; hidden without ANTHROPIC_API_KEY and for players. */
export const ImportButton: CampaignSlot = (props) =>
  props.isGm ? (
    <ImportBoundary>
      <Gate {...props} />
    </ImportBoundary>
  ) : null;
