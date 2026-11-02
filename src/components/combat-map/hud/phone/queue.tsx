"use client";

import { useId, useState, type ReactNode } from "react";

import type { CombatRole } from "../../slots";
import { usePhoneHud } from "./media";

/**
 * The GM at phone width (plan combat-hud H7.2, answer 13a): the tablet layout, with the request queue as a bottom
 * sheet. Wraps the shell's left column (the GM's `HudQueue`: "Waiting on you" with its count, the cards, Resolutions;
 * then the spotlight panel); for a player, or wider than a phone, it renders the column unchanged. Folded (the default,
 * so the map stays usable) the sheet shows the queue's heading and count under a grab handle; the handle unfolds it to
 * the cards, Resolutions and the spotlight panel, scrolling inside.
 */
export function PhoneQueueSheet({ role, children }: { role: CombatRole; children: ReactNode }) {
  const phone = usePhoneHud();
  if (!phone || role !== "gm") return children;
  return <QueueSheet>{children}</QueueSheet>;
}

function QueueSheet({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="hud-ph-q" data-open={open} data-testid="hud-phone-queue">
      <button type="button" className="hud-ph-handle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" />
        <b>{open ? "Fold the requests down" : "Show the requests"}</b>
      </button>
      <div id={id} className="hud-ph-q-body">
        {children}
      </div>
    </div>
  );
}
