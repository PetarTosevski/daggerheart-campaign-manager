"use client";

import "../catalogue/catalogue.css";
import "./environments.css";

import { useEffect, useRef, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { prefersReducedMotion } from "@/lib/use-reduced-motion";

import type { CatalogueEntryRef } from "../slots";
import { StatBlock } from "../catalogue/stat-block";

export type OpenedAdversaryProps = {
  adversaryId: string;
  /** The environment whose Potential Adversaries line it was opened from. */
  fromEnvironment: string;
  /** The stat block's head actions, as in the catalogue ("Add to encounter", "Duplicate & edit"). */
  renderActions: (adversary: CatalogueEntryRef) => ReactNode;
  /** Optional "Back to <environment>" (not needed when the panel opens inside the Environment tab). */
  onBack?: () => void;
  onClose: () => void;
};

/** The adversary picked in an environment's Potential Adversaries line, shown above the environment catalogue. */
export function OpenedAdversary({ adversaryId, fromEnvironment, renderActions, onBack, onClose }: OpenedAdversaryProps) {
  const ref = useRef<HTMLElement>(null);
  // Move focus (and the view) to what the GM opened.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [adversaryId]);
  const adversary = ADVERSARIES.find((a) => a.id === adversaryId);
  if (!adversary) return null;
  return (
    <section ref={ref} tabIndex={-1} className="env-opened" aria-label={`${adversary.name}, opened from ${fromEnvironment}`}>
      <div className="env-opened-bar">
        <p>
          Potential adversary of <strong>{fromEnvironment}</strong>
        </p>
        {onBack ? (
          <BrandButton variant="cancel" size="sm" onClick={onBack}>
            Back to {fromEnvironment}
          </BrandButton>
        ) : null}
        <BrandButton variant="cancel" size="sm" onClick={onClose}>
          Close
        </BrandButton>
      </div>
      <StatBlock adversary={adversary} actions={renderActions(adversary)} />
    </section>
  );
}
