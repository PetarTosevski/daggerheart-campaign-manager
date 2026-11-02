"use client";

import { useId, type ReactNode } from "react";

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
};

export type PopupProps = {
  icon: ReactNode;
  title: string;
  sub?: ReactNode;
  tone?: PopupTone;
  children?: ReactNode;
  /** The one primary button (gold; lilac on the GM tone). Omit for a prompt that only informs. */
  primary?: PopupAction;
  /** Secondary footer controls (Decline, Pass, a TwoTapButton), left of the primary. */
  secondary?: ReactNode;
  className?: string;
  testId?: string;
};

export function hudButtonClass(kind: "primary" | "secondary" = "secondary"): string {
  return kind === "primary" ? "hud-btn hud-btn-primary" : "hud-btn";
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
              className={hudButtonClass("primary")}
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
