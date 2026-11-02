"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A full-height side panel (HANDOFF "Sheet panel": right 0, 400 px; the tools drawer uses the left side). Not modal:
 * the map beside it stays usable, so it is an `<aside>`, not a `<dialog>`. On open it takes focus; on close focus goes
 * back to whatever had it before (the banner, token or button that opened it). Escape inside the panel closes it.
 * Swapping its content while open (another banner) keeps focus where it is.
 */
export type SidePanelProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** The accessible name of the panel (defaults to the title when that is a string). */
  label?: string;
  side?: "right" | "left";
  /** Right of the title: tags such as "View only" or "GM edit". */
  headerEnd?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function SidePanel({ open, onClose, title, label, side = "right", headerEnd, children, className, testId }: SidePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.focus();
    return () => {
      // Back to the opener, unless focus already moved somewhere else on purpose (outside the panel).
      const now = document.activeElement;
      const lostWithPanel = now === null || now === document.body || (panel?.contains(now) ?? true);
      if (previous?.isConnected && lostWithPanel) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={label}
      aria-labelledby={label === undefined ? titleId : undefined}
      className={cn("hud-panel", side === "left" && "hud-panel-left", className)}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="hud-panel-top">
        <h2 id={titleId} className="hud-panel-title">
          {title}
        </h2>
        {headerEnd}
        <button type="button" className="hud-panel-x" aria-label={`Close ${label ?? (typeof title === "string" ? title : "panel")}`} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="hud-panel-body">{children}</div>
    </aside>
  );
}
