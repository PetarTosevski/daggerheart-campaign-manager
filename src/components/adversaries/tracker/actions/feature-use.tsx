"use client";

import { useQuery } from "convex/react";
import { Component, type ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { needsChoices, type FeatureAsk } from "./ask";

type Props = {
  campaignId: Id<"campaigns">;
  instanceId: string;
  feature: string;
  fearCost: number | undefined;
  disabled: boolean;
  /** False for a defeated adversary: no featureAsk (the server refuses it). */
  live: boolean;
  /** The GM tapped Use: with the feature's featureAsk when it loaded (null: send at once with the server's defaults). */
  onUse: (ask: FeatureAsk | null) => void;
};

function UseButton({ feature, fearCost, disabled, ask, onUse }: Omit<Props, "campaignId" | "instanceId" | "live"> & { ask: FeatureAsk | null }) {
  const blocked = ask !== null && !ask.available;
  return (
    <>
      <button
        type="button"
        className="trk-btn trk-btn-parch trk-btn-sm"
        aria-label={`Use ${feature}${fearCost ? ` (${fearCost} Fear)` : ""}`}
        aria-haspopup={ask !== null && needsChoices(ask) ? "dialog" : undefined}
        disabled={disabled || blocked}
        onClick={() => onUse(ask)}
      >
        Use
      </button>
      {blocked ? <p className="trk-act-why">{ask.unavailable.join(". ")}</p> : null}
    </>
  );
}

/** The live featureAsk for one feature (AA2c): whether Use asks first, and why it can't be used now. */
function AskedUse(props: Props) {
  const { campaignId, instanceId, feature, live, ...rest } = props;
  const ask = useQuery(api.adversaryActions.featureAsk, live ? { campaignId, instanceId, feature } : "skip");
  return <UseButton {...rest} feature={feature} ask={ask ?? null} />;
}

/** A refused featureAsk (a feature the server reads as passive, an encounter that just ended) keeps the plain Use. */
class AskBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * A feature's Use button (plan combat-actions AA3; AA3b): it reads `adversaryActions.featureAsk` so a feature that
 * needs the GM's choices opens the choices dialog first and a used-up one says why it is off. Until the ask loads, or
 * when the server refuses it, Use sends at once as before (the server answers with its defaults or a refusal).
 */
export function FeatureUse(props: Props) {
  const plain = <UseButton feature={props.feature} fearCost={props.fearCost} disabled={props.disabled} onUse={props.onUse} ask={null} />;
  return (
    <AskBoundary fallback={plain}>
      <AskedUse {...props} />
    </AskBoundary>
  );
}
