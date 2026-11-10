"use client";

import { Compass, MessageCircle, Swords, Tent, type LucideIcon } from "lucide-react";
import { Component, useId, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { SCENE_TYPE_LABEL } from "@/lib/journal/sessions";

import type { SessionSceneType } from "../../../../convex/lib/validators/sessions";

/**
 * Shared pieces of the Journal (J1, design reference/designs/journal/journal_views.jpg). Styles live in
 * ../journal.css (`jr-*`). Every slot may use them; only J1 changes them.
 */

/** Keeps a failing slot (a `useQuery` that throws) from blanking the page (CL1); "Try again" remounts it. */
export class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
  state: { failed: boolean; message: string } = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="jr-alert">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <BrandButton variant="neutral" size="sm" onClick={() => this.setState({ failed: false, message: "" })}>
          Try again
        </BrandButton>
      </div>
    );
  }
}

/**
 * A dark card with a heading. `kind="title"`: the gold serif heading ('Planned scenes', 'Session log', 'Recap');
 * `kind="label"`: the small spaced caps ('Battle points · Scene 3', 'Session tally', 'Campaign so far'). `actions`
 * sit on the right of the heading ('+ Add scene', 'Reset', 'Share with players').
 */
export function Card({
  heading,
  kind = "title",
  actions,
  className,
  children,
}: {
  heading: string;
  kind?: "title" | "label";
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`jr-card${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="jr-card-top">
        <h2 id={id} className={kind === "title" ? "jr-card-h" : "jr-lbl jr-card-lbl"}>
          {heading}
        </h2>
        {actions ? <div className="jr-card-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Chip tones: a session's status (planned gold, live green with a dot, played muted) or a neutral count. */
export type ChipTone = "planned" | "live" | "played" | "neutral";

/** A small rounded chip: 'Planned', '● Live', a count ('6', '11 pages'). */
export function Chip({ tone = "neutral", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className="jr-chip" data-tone={tone}>
      {tone === "live" ? <span className="jr-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** The cream paper card ('GM prep', the recap). `label`: the small caps line on top. */
export function Parchment({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`jr-parchment${className ? ` ${className}` : ""}`}>
      {label ? <div className="jr-parchment-lbl">{label}</div> : null}
      {children}
    </div>
  );
}

/** A scene type's label (`SCENE_TYPE_LABEL`, shared with the phone) and icon (design: Exploration green, Social blue, Combat red, Downtime amber). */
export const SCENE_TYPE_DISPLAY: Record<SessionSceneType, { label: string; Icon: LucideIcon }> = {
  exploration: { label: SCENE_TYPE_LABEL.exploration, Icon: Compass },
  social: { label: SCENE_TYPE_LABEL.social, Icon: MessageCircle },
  combat: { label: SCENE_TYPE_LABEL.combat, Icon: Swords },
  downtime: { label: SCENE_TYPE_LABEL.downtime, Icon: Tent },
};

/** The scene type chip: icon and label in the type's colour. */
export function TypeChip({ type }: { type: SessionSceneType }) {
  const { label, Icon } = SCENE_TYPE_DISPLAY[type];
  return (
    <span className="jr-type" data-type={type}>
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}
