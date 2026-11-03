"use client";

import { useId, type ReactNode } from "react";

import { glassButtonClass, type GlassRole, type GlassSize } from "@/components/brand/glass-button";
import { cn } from "@/lib/utils";

/**
 * A small one-question prompt (boards CmpPromptsPlayer / CmpPromptsGM `.pc`): header with an icon, the title (what)
 * and a sub line (why), the body with the choice, and a footer whose one primary button names the result. Not modal:
 * the map stays usable; a part that must hold focus opens it in `<Modal>` instead (CL12).
 */

export type PopupTone = "player" | "gm" | "red" | "wait";

/** The footer's one primary action. */
export type PopupAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Extra accessible name when the visible label is not enough. */
  ariaLabel?: string;
  /** The button's role (default confirm). The GM's answer to a player's request is `"allow"`. */
  role?: HudButtonRole;
};

export type PopupProps = {
  icon: ReactNode;
  title: string;
  sub?: ReactNode;
  tone?: PopupTone;
  children?: ReactNode;
  /** The one primary button (confirm unless `role` says otherwise). Omit for a prompt that only informs. */
  primary?: PopupAction;
  /** Secondary footer controls (Decline, Pass, a TwoTapButton), left of the primary. */
  secondary?: ReactNode;
  className?: string;
  testId?: string;
};

/**
 * A HUD button's role: `primary` is confirm, `secondary` neutral; the rest are the arcane glass design's
 * (src/components/brand/glass-button.ts): cancel, danger, tool, allow / deny (the GM's answer to a player's request), …
 */
export type HudButtonRole = "primary" | "secondary" | GlassRole;

/**
 * The arcane glass button plus `hud-btn`, which the HUD's layout rules select (and `hud-btn-primary` on confirm, the
 * prompt's one primary). Confirm and cancel take their colours from the HUD root's `data-viewer` ("player" | "gm");
 * without it, the player's.
 */
export function hudButtonClass(kind: HudButtonRole = "secondary", size?: GlassSize): string {
  const role: GlassRole = kind === "primary" ? "confirm" : kind === "secondary" ? "neutral" : kind;
  return cn("hud-btn", role === "confirm" && "hud-btn-primary", glassButtonClass({ role, size }));
}

export function Popup({ icon, title, sub, tone = "player", children, primary, secondary, className, testId }: PopupProps) {
  const titleId = useId();
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={cn("hud-pc", tone !== "player" && `hud-pc-${tone}`, className)}
      data-testid={testId}
    >
      <div className="hud-pc-h">
        <span className="hud-pc-i" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h2 id={titleId} className="hud-pc-t">
            {title}
          </h2>
          {sub ? <span className="hud-pc-s">{sub}</span> : null}
        </div>
      </div>
      {children ? <div className="hud-pc-b">{children}</div> : null}
      {primary || secondary ? (
        <div className="hud-pc-f">
          {secondary}
          {primary ? (
            <button
              type="button"
              className={hudButtonClass(primary.role ?? "primary")}
              disabled={primary.disabled}
              aria-label={primary.ariaLabel}
              onClick={primary.onClick}
            >
              {primary.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
