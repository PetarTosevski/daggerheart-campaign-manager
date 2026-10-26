"use client";

import "@/app/(gm)/campaigns/[campaignId]/lorekeeper/lorekeeper.css";
import "./drawer.css";

import { useEffect, useId, useRef } from "react";

import { LOREKEEPER_NAME, LOREKEEPER_SUBTITLE } from "@/lib/lorekeeper/copy";

import type { Id } from "../../../../convex/_generated/dataModel";
import { LorekeeperChat } from "../chat";
import { ChatBoundary } from "../chat/boundary";
import { Sigil, SigilIcon } from "../sigil";
import type { LorekeeperAccess } from "../slots";
import { DRAWER_OPEN_LABEL } from "./labels";

/**
 * The drawer (board Lorekeeper.dc.html, drawer variant): a native modal <dialog> over the dimmed campaign page with
 * the 440 px panel on the right (full width under 760 px): the chat header with ✕ and L6's chat column
 * (`variant: "drawer"`). The dialog gives focus trapping, Escape and the inert page; a click on the dimmed page closes
 * it. The board's 'The Lorekeeper is open' pill beside the panel is drawn again inside the dialog (decorative: the
 * real pill is under the backdrop). Loaded lazily by ./index.tsx; this module carries lorekeeper.css itself.
 */
export function DrawerPanel({
  campaignId,
  access,
  open,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  access: LorekeeperAccess;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="lk-root lk-drawerdlg"
      data-role={access.isGm ? "gm" : "player"}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? (
        <>
          <div className="lk-fab lk-drawerfab" aria-hidden="true">
            <span className="lk-mini lk-fabmini">
              <SigilIcon size={20} />
            </span>
            {DRAWER_OPEN_LABEL}
          </div>
          <aside className="lk-drawer lk-drawerpanel" aria-labelledby={titleId}>
            <header className="lk-chathead">
              <Sigil />
              <div className="lk-chathead-text">
                <h2 id={titleId} className="lk-name">
                  {LOREKEEPER_NAME}
                </h2>
                <span className="lk-muted">{LOREKEEPER_SUBTITLE}</span>
              </div>
              <button type="button" className="lk-act lk-act-dark lk-drawerclose" aria-label="Close the Lorekeeper" onClick={onClose}>
                ✕
              </button>
            </header>
            <div className="lk-body">
              <ChatBoundary label="The conversation" dark>
                <LorekeeperChat campaignId={campaignId} access={access} variant="drawer" />
              </ChatBoundary>
            </div>
          </aside>
        </>
      ) : null}
    </dialog>
  );
}
