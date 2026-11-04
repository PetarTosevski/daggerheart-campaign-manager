"use client";

import "./features.css";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import { useState, type ComponentType, type ReactNode } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { FEATURE_MODES, type FeatureMode } from "@/lib/admin/config";
import { featureInfo, type FeatureKey } from "@/lib/admin/features";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { AdminTabProps } from "../slots";
import { TestersCard } from "./testers";
import { changedLabel, FEATURES_TEXT, MODE_LABEL } from "./text";

/** Shows the new mode (changed now) in `features.list` before the server answers (rule 12). */
export function setModeLocally(store: OptimisticLocalStore, key: FeatureKey, mode: FeatureMode): void {
  const current = store.getQuery(api.features.list, {});
  if (current === undefined) return;
  const changedAt = Date.now();
  store.setQuery(
    api.features.list,
    {},
    current.map((row) => (row.key === key && row.mode !== mode ? { ...row, mode, changedAt } : row)),
  );
}

/**
 * App admin, Feature switches (config AU4; design `.s-flags`). One row per `FEATURES` entry (every board row but the
 * dropped combat HUD, Q25 b) with its description, 'Changed <date>' and the four-way choice Off / Only me / Testers /
 * Everyone. A choice writes `features.setMode` (one field, optimistic, rule 12). Journal and Share links are inert
 * (N2 a): saved like the others, with the note that says they do nothing yet. Then the Testers card.
 */
export const FeatureSwitchesTab: ComponentType<AdminTabProps> = () => <FeatureSwitches />;

function FeatureSwitches(): ReactNode {
  const rows = useQuery(api.features.list, {});
  const setMode = useMutation(api.features.setMode).withOptimisticUpdate((store, { key, mode }) => setModeLocally(store, key, mode));
  const [error, setError] = useState<string | null>(null);

  async function choose(key: FeatureKey, mode: FeatureMode) {
    setError(null);
    try {
      await setMode({ key, mode });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <section className="adm-card" aria-labelledby="afs-title">
        <div className="adm-card-h">
          <h3 id="afs-title">{FEATURES_TEXT.title}</h3>
          <p>{FEATURES_TEXT.intro}</p>
        </div>
        {rows === undefined ? (
          <p role="status" className="adm-muted afs-pad">
            {FEATURES_TEXT.loading}
          </p>
        ) : (
          rows.map((row) => {
            const info = featureInfo(row.key);
            return (
              <div key={row.key} className="adm-row afs-flag" data-testid={`feature-${row.key}`}>
                <div className="adm-row-t">
                  <b>{info.name}</b>
                  <span>{info.description}</span>
                  {info.inert && info.note ? <span className="afs-note">{info.note}</span> : null}
                  <em className="afs-changed">{changedLabel(row.changedAt)}</em>
                </div>
                <div className="afs-seg" role="group" aria-label={info.name}>
                  {FEATURE_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={glassButtonClass({ role: "neutral", size: "sm" })}
                      aria-pressed={row.mode === mode}
                      onClick={() => {
                        if (row.mode !== mode) void choose(row.key, mode);
                      }}
                    >
                      {MODE_LABEL[mode]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
        <p aria-live="polite" className="adm-muted afs-err">
          {error}
        </p>
      </section>
      <TestersCard />
    </>
  );
}
