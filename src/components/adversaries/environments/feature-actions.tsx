"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { featureCountdownLabels } from "@/lib/domain/environments";
import { MAX_FEAR } from "@/lib/domain/fear";
import { ENVIRONMENTS } from "@/lib/srd/environments";
import type { EnvironmentDef, EnvironmentFeature } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** The line under the stat block's Fear bar, for the environment it was written for. */
type Status = { environmentId: string; text: string; error: boolean };

/**
 * The Environment tab's actions (EF1): spend a feature's Fear and start its countdown (Private) on the dashboard. The
 * Fear spend lowers the campaign's Fear at once (optimistic, as the tracker's Spend Fear); a click with visible latency
 * is disabled while it runs.
 */
export function useEnvironmentActions(campaignId: Id<"campaigns">) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const spend = useMutation(api.environmentActions.spendFear).withOptimisticUpdate((store, { environmentId, featureName }) => {
    const campaign = store.getQuery(api.campaigns.get, { campaignId });
    // The same bundled stat block the server reads the cost from.
    const cost = ENVIRONMENTS.find((e) => e.id === environmentId)?.features.find((f) => f.name === featureName)?.fearCost;
    if (!campaign || cost === undefined || campaign.fear < cost) return;
    store.setQuery(api.campaigns.get, { campaignId }, { ...campaign, fear: campaign.fear - cost });
  });
  const start = useMutation(api.environmentActions.startCountdown);

  async function run(environment: EnvironmentDef, feature: EnvironmentFeature, action: "spend" | "start", label?: string) {
    const id = `${environment.id}/${feature.name}`;
    setPending(id);
    setStatus(null);
    const args = { campaignId, environmentId: environment.id, featureName: feature.name, idempotencyKey: crypto.randomUUID() };
    try {
      if (action === "spend") {
        const { spent } = await spend(args);
        setStatus({ environmentId: environment.id, text: `Spent ${spent} Fear: ${feature.name}`, error: false });
      } else {
        const { name, startingValue } = await start(label === undefined ? args : { ...args, label });
        setStatus({ environmentId: environment.id, text: `Countdown started on the dashboard: ${name} at ${startingValue} (private)`, error: false });
      }
    } catch (e) {
      setStatus({ environmentId: environment.id, text: errorMessage(e), error: true });
    } finally {
      setPending(null);
    }
  }

  return {
    /** The status line for this environment (another environment's line is not shown). */
    statusFor: (environmentId: string) => (status?.environmentId === environmentId ? status : null),
    pending: (environment: EnvironmentDef, feature: EnvironmentFeature) => pending === `${environment.id}/${feature.name}`,
    spendFear: (environment: EnvironmentDef, feature: EnvironmentFeature) => run(environment, feature, "spend"),
    startCountdown: (environment: EnvironmentDef, feature: EnvironmentFeature, label?: string) => run(environment, feature, "start", label),
  };
}

export type EnvironmentActions = ReturnType<typeof useEnvironmentActions>;

/** GM Fear as the dashboard's token art (12, lit up to the current Fear) with "+ Fear", at the top of the stat block. */
export function EnvironmentFearBar({ campaignId, fear }: { campaignId: Id<"campaigns">; fear: number }) {
  const gain = useIntent(api.fear.adjust);
  return (
    <div className="env-fear">
      <span className="env-fear-label">GM Fear</span>
      <span className="env-tokens" role="img" aria-label={`GM Fear ${fear} of ${MAX_FEAR}`} data-testid="environment-fear">
        {Array.from({ length: MAX_FEAR }, (_, i) => (
          <i key={i} className={`env-token ${i < fear ? "env-token-on" : "env-token-off"}`} />
        ))}
      </span>
      <span className="env-fear-n" aria-hidden="true">
        {fear}
      </span>
      <button
        type="button"
        className="env-act env-act-fear"
        aria-label="Gain 1 Fear"
        disabled={fear >= MAX_FEAR || gain.pending}
        onClick={() => void gain.fire({ campaignId, direction: "increase" })}
      >
        + Fear
      </button>
      {gain.error ? (
        <p role="alert" className="env-status env-status-error">
          {gain.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A feature's buttons: "Spend N Fear" when it has a Fear cost (disabled, with the reason, when the GM holds less) and
 * "Start countdown" when it has a countdown label. Nothing for a feature with neither.
 */
export function FeatureActions({
  environment,
  feature,
  fear,
  actions,
}: {
  environment: EnvironmentDef;
  feature: EnvironmentFeature;
  fear: number;
  actions: EnvironmentActions;
}) {
  const cost = feature.fearCost;
  const countdowns = featureCountdownLabels(feature);
  if (cost === undefined && countdowns.length === 0) return null;
  const busy = actions.pending(environment, feature);
  const short = cost !== undefined && fear < cost;
  const reasonId = `env-short-${environment.id}-${feature.name.replace(/[^a-z0-9]+/gi, "-")}`;
  return (
    <div className="env-acts">
      {cost !== undefined ? (
        <button
          type="button"
          className="env-act env-act-fear"
          disabled={short || busy}
          aria-describedby={short ? reasonId : undefined}
          onClick={() => void actions.spendFear(environment, feature)}
        >
          Spend {cost} Fear
        </button>
      ) : null}
      {countdowns.length === 1 ? (
        <button type="button" className="env-act" disabled={busy} onClick={() => void actions.startCountdown(environment, feature, countdowns[0])}>
          Start countdown
        </button>
      ) : (
        // Several countdowns in one feature (e.g. a Progress and a Consequence Countdown): one button each.
        countdowns.map((label) => (
          <button key={label} type="button" className="env-act" disabled={busy} onClick={() => void actions.startCountdown(environment, feature, label)}>
            Start {label}
          </button>
        ))
      )}
      {short ? (
        <span id={reasonId} className="env-act-note">
          {fear === 0 ? "No Fear to spend." : `You hold ${fear} Fear.`}
        </span>
      ) : null}
    </div>
  );
}

/** The confirmation (or error) line for the shown environment; an aria-live region so it is announced. */
export function EnvironmentStatus({ status }: { status: Status | null }) {
  return (
    <p role="status" className={`env-status${status?.error ? " env-status-error" : ""}`} data-testid="environment-status">
      {status?.text ?? ""}
    </p>
  );
}
