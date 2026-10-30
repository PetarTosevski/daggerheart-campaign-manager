"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import { api } from "../../../../convex/_generated/api";
import { usePlayFor } from "../play-for";
import { sheetHref, type SheetDrawerProps } from "../slots";
import { DrawerBoundary } from "./boundary";
import "./drawer.css";
import { FeatureList } from "./list";
import { DrawerPrompts } from "./prompts";
import { Trackers } from "./trackers";

export { FeatureUse } from "./use";

/**
 * The Combat Map sheet drawer (plan sheet-drawer, SD6): a native modal <dialog> (focus trap, Esc, focus back to the Sheet
 * button) docked to the right edge over the live map, full screen at 760 px and below. The page keeps it mounted after the
 * first open, so the map behind it is never remounted; the body (and its queries) exists only while it is open.
 * Contents: the trackers, then every owned feature by source with its Use button, and the "Full sheet" link.
 */
export function SheetDrawer({ campaignId, role, map, characterId, open, onClose }: SheetDrawerProps) {
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
      className="sd-drawer"
      aria-labelledby={titleId}
      data-testid="sheet-drawer"
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      // The map's shortcuts listen on window (Escape drops the selected token, WASD moves it): keys pressed in the drawer
      // stay in it, so Esc only closes the drawer and the map keeps its selection.
      onKeyDown={(event) => event.stopPropagation()}
    >
      {open ? (
        <div className="sd-shell">
          <header className="sd-header">
            <h2 id={titleId} className="sd-title">
              Character sheet
            </h2>
            <button type="button" className="cm-btn cm-sm sd-close" aria-label="Close character sheet" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="sd-scroll">
            <DrawerBoundary label="The character sheet">
              <DrawerBody campaignId={campaignId} role={role} map={map} characterId={characterId} />
            </DrawerBoundary>
          </div>
          <footer className="sd-footer">
            <Link href={sheetHref(campaignId, characterId)} className="cm-btn" data-testid="sheet-drawer-full-sheet">
              Full sheet
            </Link>
          </footer>
        </div>
      ) : null}
    </dialog>
  );
}

function DrawerBody({ campaignId, role, map, characterId }: Omit<SheetDrawerProps, "open" | "onClose">) {
  const drawer = useQuery(api.combatFeatures.drawer, { campaignId, characterId });
  // The GM plays for a character only after turning the switch on: the one switch per PC the map Hand shows too, kept
  // on until the GM turns it off, on every device (DA6, user answers 2026-10-30; stored by convex/playFor.ts).
  const playFor = usePlayFor(campaignId, characterId, role === "gm");
  const switchId = useId();
  if (drawer === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading the sheet…
      </p>
    );
  }
  const canAct = role === "player" || playFor.on;
  return (
    <div className="sd-body">
      <p className="sd-name" data-testid="sheet-drawer-name">
        {drawer.name}
      </p>
      {role === "gm" ? (
        <>
          <label className="sd-switch" htmlFor={switchId}>
            <input id={switchId} type="checkbox" role="switch" checked={playFor.on} onChange={(e) => playFor.set(e.target.checked)} />
            <span className="sd-switch-track" aria-hidden="true" />
            <span>Play for this character</span>
          </label>
          {playFor.error ? (
            <p role="alert" className="cma-error">
              {playFor.error}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="sd-grey" data-greyed={canAct ? "false" : "true"}>
        <Trackers campaignId={campaignId} characterId={characterId} trackers={drawer.trackers} counters={drawer.counters} heldDice={drawer.heldDice} canAct={canAct} />
        {/* DA13: uses another PC rolls (Cannonball): the ally's prompt, the druid's ask, the GM's pending list. */}
        <DrawerBoundary label="The prompts">
          <DrawerPrompts campaignId={campaignId} role={role} map={map} characterId={characterId} drawer={drawer} canAct={canAct} />
        </DrawerBoundary>
        <FeatureList campaignId={campaignId} role={role} map={map} characterId={characterId} drawer={drawer} canAct={canAct} />
      </div>
    </div>
  );
}
