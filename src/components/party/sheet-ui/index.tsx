"use client";

// Board primitives for the character sheet (reference/designs/project/Party.dc.html), shared by every
// section of the sheet redesign (.omc/plans/sheet-redesign.yaml). Colours: the --sheet-* tokens in the
// sheet route's sheet.css. Keep names and props stable; add variants rather than changing behaviour.

import "./sheet-ui.css";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";

import { assetBackground } from "@/lib/design-assets";
import { cn } from "@/lib/utils";

/** A parchment box (`sh-box`) with the gold-ruled Cinzel heading (`sh-h`); a region named by its title. */
export function SheetBox({
  title,
  label,
  headingLevel = 3,
  className,
  style,
  children,
  ...rest
}: {
  title?: string;
  /** Accessible name when it differs from the title (or there is no title). */
  label?: string;
  headingLevel?: 2 | 3 | 4;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Pick<ComponentProps<"section">, "id" | "aria-labelledby"> & { "data-testid"?: string }) {
  const Heading = `h${headingLevel}` as const;
  const named = rest["aria-labelledby"] ? {} : { "aria-label": label ?? title };
  return (
    <section className={cn("sh-box", className)} style={style} {...named} {...rest}>
      {title ? <Heading className="sh-h">{title}</Heading> : null}
      {children}
    </section>
  );
}

/** Field label (`sh-lbl`): Cinzel, small caps, brown. */
export function Label({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("sh-lbl", className)} {...props} />;
}

/** Body note (`sh-small`): 15 px Garamond. */
export function Small({ as = "span", className, ...props }: Omit<ComponentProps<"span">, "ref"> & { as?: "span" | "p" | "div" }) {
  const cls = cn("sh-small", as === "p" && "m-0", className);
  if (as === "p") return <p className={cls} {...props} />;
  if (as === "div") return <div className={cls} {...props} />;
  return <span className={cls} {...props} />;
}

/** Class names for paper fields, for elements the components below don't cover (select, read-only div). */
export const paperField = {
  input: "sh-in",
  textarea: "sh-ta",
  number: "sh-num",
  /** A set-at-creation or derived value: `<div className={paperField.locked}>`. */
  locked: "sh-in sh-locked",
} as const;

/** Paper text input (`sh-in`). */
export function PaperInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn("sh-in", className)} {...props} />;
}

/** Lined paper textarea (`sh-ta`). */
export function PaperTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn("sh-ta", className)} {...props} />;
}

/** Ringed number input (`sh-num`); add a size class (e.g. a 76 px circle) per use. */
export function PaperNumber({ className, ...props }: ComponentProps<"input">) {
  return <input inputMode="numeric" className={cn("sh-num", className)} {...props} />;
}

export type PillVariant = "mark" | "solid" | "roll";

/** Pill button: `mark` = the board's dmg-mark outline, `solid` = wine, `roll` = the gold-to-purple roll button. */
export function Pill({ variant = "mark", className, type = "button", ...props }: ComponentProps<"button"> & { variant?: PillVariant }) {
  return <button type={type} className={cn("sh-pill", variant !== "mark" && variant, className)} {...props} />;
}

/** The board's 12-column slot grid (6 columns of 44 px pips at phone width). */
export function SlotRow({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("sh-slot-row", className)} {...props} />;
}

export type PipKind = "heart" | "diamond" | "armor" | "coin" | "scar" | "sword";

/** `--coin` for coin and scar pips: put it on the SlotRow (or any ancestor). */
export const HOPE_COIN_STYLE = { "--coin": assetBackground("adec0ee116c933de010a35432e8e5e36") } as CSSProperties;

/**
 * One slot: a toggle button when `onClick` is given (`label` is its accessible name, `on` its pressed
 * state), otherwise a decorative mark (give the row a summary label).
 */
export function Pip({
  kind,
  on = false,
  label,
  onClick,
  disabled,
  className,
}: {
  kind: PipKind;
  on?: boolean;
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const cls = cn("sh-pip", kind, on && "on", className);
  if (!onClick) return <span aria-hidden="true" className={cls} />;
  return <button type="button" className={cls} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick} />;
}

/** Launcher row (`cs-launch` + `cs-open`): a note and a green pill that opens a sheet. */
export function Launcher({
  children,
  action,
  icon,
  onOpen,
  actionLabel,
}: {
  children: ReactNode;
  /** Visible text of the open button. */
  action: string;
  icon?: ReactNode;
  onOpen: () => void;
  /** Accessible name of the open button when the visible text is not enough. */
  actionLabel?: string;
}) {
  return (
    <div className="sh-launch">
      <span className="sh-small">{children}</span>
      <button type="button" className="sh-open" aria-label={actionLabel} onClick={onOpen}>
        {icon}
        {action}
      </button>
    </div>
  );
}

export type BadgeTone = "dark" | "wine" | "paper" | "green";

/** Status pill in the banner style of the board's FALLEN badge. */
export function Badge({ tone = "dark", className, ...props }: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return <span className={cn("sh-badge", tone !== "dark" && tone, className)} {...props} />;
}

/** One active effect: dashed gold row with its text, until-when note and an End button. */
export function EffectRow({
  children,
  until,
  onEnd,
  endLabel = "End",
  endAriaLabel,
  disabled,
}: {
  children: ReactNode;
  until?: ReactNode;
  onEnd?: () => void;
  endLabel?: string;
  endAriaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="sh-effect">
      <span>
        <strong>{children}</strong>
        {until ? <span className="sh-small"> ({until})</span> : null}
      </span>
      {onEnd ? (
        <button type="button" className="sh-effect-end" aria-label={endAriaLabel} disabled={disabled} onClick={onEnd}>
          {endLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Parchment dialog (the board's advPick and cs-sheet overlays) on native `<dialog>` + `showModal()`
 * (CL12): the browser traps focus, closes on Escape and restores focus. Cinzel title, 44 px close.
 * `actions` renders right-aligned under the body (use `sh-modal-cancel` / `sh-modal-ok` buttons).
 */
export function PaperModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
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
      className={cn("sh-modal", className)}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="sh-modal-body">
          <div className="sh-modal-head">
            <div className="min-w-0">
              <h2 id={titleId} className="sh-modal-title">
                {title}
              </h2>
              {subtitle ? <p className="sh-modal-sub">{subtitle}</p> : null}
            </div>
            <button type="button" className="sh-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {children}
          {actions ? <div className="sh-modal-actions">{actions}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
