"use client";

import Link from "next/link";

import { Modal } from "@/components/brand/modal";

import { sheetHref, type SheetDrawerProps } from "../slots";

export { FeatureUse } from "./use";

/**
 * The Combat Map sheet drawer (plan sheet-drawer). SD0 ships this stub: a modal (native <dialog>: focus trap, Esc,
 * focus back to the Sheet button) with the "Full sheet" link. SD6 replaces the body with the trackers and the feature
 * list and makes it the right-side drawer (full screen at 760 px and below); props: src/components/combat-map/slots.ts.
 */
export function SheetDrawer({ campaignId, characterId, open, onClose }: SheetDrawerProps) {
  return (
    <Modal open={open} onClose={onClose} title="Character sheet">
      <p className="m-0 text-[15px] text-parchment/80">Your trackers and features will be here. Everything else is on the full sheet.</p>
      <Link href={sheetHref(campaignId, characterId)} className="cm-btn self-start" data-testid="sheet-drawer-full-sheet">
        Full sheet
      </Link>
    </Modal>
  );
}
