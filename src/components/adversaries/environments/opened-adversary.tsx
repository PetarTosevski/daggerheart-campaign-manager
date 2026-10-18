"use client";

import "../catalogue/catalogue.css";
import "./environments.css";

import { useEffect, useRef, type ReactNode } from "react";

import { ADVERSARIES } from "@/lib/srd/adversaries";

import type { CatalogueEntryRef } from "../slots";
import { StatBlock } from "../catalogue/stat-block";

export type OpenedAdversaryProps = {
  adversaryId: string;
  /** The environment whose Potential Adversaries line it was opened from. */
  fromEnvironment: string;
  /** The stat block's head actions, as in the catalogue ("Add to encounter", "Duplicate & edit"). */
  renderActions: (adversary: CatalogueEntryRef) => ReactNode;
  onBack: () => void;
  onClose: () => void;
};

/** Catalogue tab: the adversary picked in an environment's stat block, above the catalogue, with a way back. */
export function OpenedAdversary({ adversaryId, fromEnvironment, renderActions, onBack, onClose }: OpenedAdversaryProps) {
  const ref = useRef<HTMLElement>(null);
  // The tab changed under the GM's pointer: move focus (and the view) to what they opened.
  useEffect(() => {
    ref.current?.focus();
  }, [adversaryId]);
  const adversary = ADVERSARIES.find((a) => a.id === adversaryId);
  if (!adversary) return null;
  return (
    <section ref={ref} tabIndex={-1} className="env-opened" aria-label={`${adversary.name}, opened from ${fromEnvironment}`}>
      <div className="env-opened-bar">
        <p>
          Potential adversary of <strong>{fromEnvironment}</strong>
        </p>
        <button type="button" onClick={onBack}>
          Back to {fromEnvironment}
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <StatBlock adversary={adversary} actions={renderActions(adversary)} />
    </section>
  );
}
