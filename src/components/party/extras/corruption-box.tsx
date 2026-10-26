"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { Pip } from "@/components/party/sheet-ui";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ALT_BTN, BTN, ErrorLine, LABEL, NOTE, Notice, PlaqueBox } from "./ui";

/**
 * Motherboard's optional Corruption Track on the Companion sheet (CB 295): a Beastbound ranger's remnant
 * companion rolls the Fear Die at the start of downtime and marks a Corruption on a 1. Six boxes; the GM
 * (a technomancer) repairs 1d4; the last box makes the remnant violent and the ranger takes a new companion.
 * Renders nothing where the rule doesn't apply.
 */
export function CorruptionBox({ characterId }: { characterId: Id<"characters"> }) {
  const view = useQuery(api.characterExtras.corruption, { characterId });
  const remnant = useIntent(api.characterExtras.setCompanionRemnant);
  const repair = useIntent(api.characterExtras.repairCompanion);
  const replace = useIntent(api.characterExtras.replaceCompanion);
  const [notice, setNotice] = useState<string | null>(null);
  if (!view) return null;
  const error = remnant.error ?? repair.error ?? replace.error;

  return (
    <PlaqueBox level={3} title="Corruption Track">
      <label className="xs-row">
        <input
          type="checkbox"
          checked={view.remnant}
          disabled={!view.canEdit || view.lost || remnant.pending}
          onChange={(e) => void remnant.fire({ characterId, remnant: e.target.checked })}
        />
        <span>This companion is a remnant</span>
      </label>
      {view.remnant || view.marks > 0 ? (
        <div className="xs-kv">
          <span className={LABEL}>
            Corruption {view.marks} / {view.trackSize}
          </span>
          <span role="img" aria-label={`Corruption: ${view.marks} of ${view.trackSize} marked`} className="xs-pips">
            {Array.from({ length: view.trackSize }, (_, k) => (
              <Pip key={k} kind="diamond" on={k < view.marks} />
            ))}
          </span>
        </div>
      ) : null}
      {view.lastRoll ? (
        <p className={NOTE}>
          Last downtime roll: Fear Die {view.lastRoll.fearDie}
          {view.lastRoll.marked ? " (marked a Corruption)" : ""}.
        </p>
      ) : null}
      {view.lost ? (
        <>
          <p className="xs-warn">
            The remnant has marked its last Corruption: it becomes violent and can no longer be commanded or repaired. Take a new companion with
            two new Experiences; the level-up options you have already chosen carry over.
          </p>
          {view.canEdit ? (
            <button type="button" className={`${BTN} self-start`} disabled={replace.pending} onClick={() => void replace.fire({ characterId })}>
              Take a new companion
            </button>
          ) : null}
        </>
      ) : null}
      {view.canRepair && view.remnant && !view.lost ? (
        <button
          type="button"
          className={`${ALT_BTN} self-start`}
          disabled={repair.pending || view.marks === 0}
          onClick={async () => {
            const done = await repair.fire({ characterId });
            if (done) setNotice(`Repair rolled ${done.die}: cleared ${done.cleared} Corruption.`);
          }}
        >
          Repair (clear 1d4)
        </button>
      ) : null}
      {notice ? <Notice>{notice}</Notice> : null}
      <p className={NOTE}>
        At the beginning of downtime, roll your Fear Die. On a 1, mark a Corruption and describe the temporary glitch that overcomes your
        companion. Specialized technomancers may temporarily repair the remnant (clears 1d4 Corruption).
      </p>
      <ErrorLine error={error} />
    </PlaqueBox>
  );
}
