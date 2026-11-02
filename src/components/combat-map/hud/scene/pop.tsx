"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A small non-modal pop-over under a HUD button (plan combat-hud H1.2): the dice box, the area tools, the fog brush and
 * the time arc open in one of these, so the map stays usable beside it. On open it takes focus; Escape or ✕ closes it
 * and focus goes back to the button that opened it (the one whose `aria-controls` is this `id`).
 */
export type ScenePopProps = {
  id: string;
  /** The accessible name and heading ("Dice", "Areas", "Fog", "Time of the long cycle"). */
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function ScenePop({ id, title, onClose, children, className }: ScenePopProps) {
  const ref = useRef<HTMLElement>(null);

  // Focus moves in on open and back to the opener (the button whose aria-controls names this pop-over) on close, unless
  // it already moved elsewhere on purpose. DOM focus only; no state is set here.
  useEffect(() => {
    const pop = ref.current;
    pop?.focus();
    return () => {
      const now = document.activeElement;
      const lostWithPop = now === null || now === document.body || (pop?.contains(now) ?? true);
      const opener = document.querySelector<HTMLElement>(`[aria-controls="${id}"]`);
      if (opener && lostWithPop) opener.focus();
    };
  }, [id]);

  return (
    <section
      ref={ref}
      id={id}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      className={cn("hud-pop", className)}
      data-testid={id}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="hud-pop-h">
        <h2 className="hud-pop-t">{title}</h2>
        <button type="button" className="hud-pop-x" aria-label={`Close ${title}`} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="hud-pop-b">{children}</div>
    </section>
  );
}
