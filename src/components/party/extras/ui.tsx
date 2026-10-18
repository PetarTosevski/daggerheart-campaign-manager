"use client";

import "./extras.css";

import { useId, type CSSProperties, type ReactNode } from "react";

import { PaperModal, Pip, SheetBox } from "@/components/party/sheet-ui";
import { assetBackground } from "@/lib/design-assets";
import { cn } from "@/lib/utils";

// Shared pieces for the class and frame extras in the board's paper style (Party.dc.html). Styles: extras.css.

/** One frame extra in the frame extras region: an sh-box with the frame name as kicker over the heading. */
export function ExtraBox({ frame, title, subtitle, children }: { frame: string; title: string; subtitle?: string; children: ReactNode }) {
  const id = useId();
  return (
    <SheetBox aria-labelledby={id}>
      <p className="xs-kicker">{frame}</p>
      <h3 id={id} className="sh-h">
        {title}
      </h3>
      {subtitle ? <p className="sh-small xs-sub">{subtitle}</p> : null}
      {children}
    </SheetBox>
  );
}

/** A white panel with the board's cs-plaque title (green rule, leaf tips, wine Cinzel); a region named by its title. */
export function PlaqueBox({ title, level = 4, className, children }: { title: string; level?: 3 | 4; className?: string; children: ReactNode }) {
  const id = useId();
  const Heading = `h${level}` as const;
  return (
    <section aria-labelledby={id} className={cn("xs-pbox", className)}>
      <Heading className="xs-plaque">
        <span id={id}>{title}</span>
      </Heading>
      {children}
    </section>
  );
}

const SHEET_ART = {
  paper: "1b5d2cdbd7397da9bbb31c7d7a033e98",
  comp: "45e957825dd3f49bbbb681d516262274",
  beast: "f5e178542a1987b57ae229bbf747dd34",
} as const;

/** The board's cs-ov/cs-sheet overlay: a wide parchment PaperModal whose head carries the banner art. */
export function ExtraSheet({
  open,
  onClose,
  title,
  banner,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name; the banner art shows the same words. */
  title: string;
  banner: "comp" | "beast";
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const art = { "--xs-paper": assetBackground(SHEET_ART.paper), "--xs-banner": assetBackground(SHEET_ART[banner]) } as CSSProperties;
  return (
    <div style={art} className="contents">
      <PaperModal open={open} onClose={onClose} title={title} subtitle={subtitle} className="xs-sheet">
        {children}
      </PaperModal>
    </div>
  );
}

/** The board's paw icon (launcher pills and the companion portrait). */
export function PawIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <ellipse cx="6" cy="10" rx="2.1" ry="2.7" />
      <ellipse cx="10" cy="6" rx="2.1" ry="2.8" />
      <ellipse cx="14.5" cy="6" rx="2.1" ry="2.8" />
      <ellipse cx="18.4" cy="10" rx="2.1" ry="2.7" />
      <path d="M12.2 11.2c-3.2 0-6.2 4.3-6.2 6.6 0 1.8 1.4 2.6 3 2.6 1.2 0 2.1-.6 3.2-.6s2 .6 3.2.6c1.6 0 3-.8 3-2.6 0-2.3-3-6.6-6.2-6.6z" />
    </svg>
  );
}

/** Green pill (cs-btn); `ALT_BTN` is the white one with the wine outline. */
export const BTN = "xs-btn";
export const ALT_BTN = "xs-btn alt";
export const INPUT = "sh-in";
export const TEXTAREA = "sh-ta xs-ta-sm";
export const LABEL = "sh-lbl";
export const NOTE = "xs-note";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("xs-field", className)}>
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  );
}

export function ErrorLine({ error }: { error: string | null | undefined }) {
  return (
    <p aria-live="polite" className="xs-error">
      {error}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="xs-notice">
      {children}
    </p>
  );
}

/** A row of diamond Stress pips (sheet-ui Pip); clicking pip k marks k (or clears back to k − 1). */
export function Pips({
  label,
  marked,
  total,
  disabled,
  onSet,
}: {
  label: string;
  marked: number;
  total: number;
  disabled: boolean;
  onSet: (value: number) => void;
}) {
  return (
    <div role="group" aria-label={`${label}: ${marked} of ${total} marked`} className="xs-pips">
      {Array.from({ length: total }, (_, k) => (
        <Pip
          key={k}
          kind="diamond"
          on={k < marked}
          label={`${label} ${k + 1} of ${total}`}
          disabled={disabled}
          onClick={() => onSet(k + 1 === marked ? k : k + 1)}
        />
      ))}
    </div>
  );
}
