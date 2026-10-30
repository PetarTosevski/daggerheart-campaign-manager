"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { Drawer } from "../list/model";
import { applyTrackerDelta, TRACKER_LABELS, trackerText, type TrackerResource } from "./model";

const ORDER: readonly TrackerResource[] = ["hp", "stress", "hope", "armor"];

function filled(t: Drawer["trackers"], r: TrackerResource): { on: number; max: number } {
  return r === "hope" ? { on: t.hope.value, max: t.hope.max } : { on: t[r].marked, max: t[r].max };
}

/**
 * The HP / Stress / Hope / Armor trackers (SD6). Each click is an intent (one slot more or fewer) through the sheet's own
 * `characters.adjustResource`, with an optimistic update on the drawer query; the server's limits are the sheet's (rule 12).
 * `canAct` is false while the GM has not turned on "Play for this character": the buttons are greyed.
 */
export function Trackers({
  campaignId,
  characterId,
  trackers,
  counters,
  heldDice,
  canAct,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  trackers: Drawer["trackers"];
  counters: Drawer["counters"];
  heldDice: Drawer["heldDice"];
  canAct: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const adjust = useMutation(api.characters.adjustResource).withOptimisticUpdate((store, args) => {
    if (args.resource === "scars") return;
    const query = { campaignId, characterId: args.characterId };
    const drawer = store.getQuery(api.combatFeatures.drawer, query);
    if (drawer) store.setQuery(api.combatFeatures.drawer, query, { ...drawer, trackers: applyTrackerDelta(drawer.trackers, args.resource, args.delta) });
  });

  async function step(resource: TrackerResource, delta: number) {
    setError(null);
    try {
      await adjust({ characterId, resource, delta });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="sd-trackers" aria-label="Trackers" data-testid="sheet-drawer-trackers">
      {ORDER.map((r) => {
        const { on, max } = filled(trackers, r);
        const { name, one } = TRACKER_LABELS[r];
        return (
          <div key={r} className="sd-tracker" role="group" aria-label={name} data-resource={r}>
            <span className="cm-lbl">{name}</span>
            <span className="sd-pips" aria-hidden="true">
              {Array.from({ length: max }, (_, i) => (
                <span key={i} className={i < on ? "sd-pip sd-pip-on" : "sd-pip"} data-resource={r} />
              ))}
            </span>
            <span className="sd-tracker-row">
              <button type="button" className="cm-btn cm-sm" disabled={!canAct || on <= 0} aria-label={r === "hope" ? "Spend 1 Hope" : `Clear 1 ${one}`} onClick={() => step(r, -1)}>
                −
              </button>
              <output className="sd-tracker-value" aria-label={`${name}: ${trackerText(trackers, r)}`}>
                {trackerText(trackers, r)}
              </output>
              <button type="button" className="cm-btn cm-sm" disabled={!canAct || on >= max} aria-label={r === "hope" ? "Gain 1 Hope" : `Mark 1 ${one}`} onClick={() => step(r, 1)}>
                +
              </button>
            </span>
          </div>
        );
      })}
      {counters.length > 0 || heldDice.length > 0 ? (
        <ul className="sd-chips" aria-label="Class counters">
          {counters.map((c) => (
            <li key={c.key} className="sd-chip">
              {c.label}: {c.value}
            </li>
          ))}
          {heldDice.map((d) => (
            <li key={d.id} className="sd-chip">
              d{d.sides} {d.kind}
              {d.value !== null ? `: ${d.value}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="sd-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
