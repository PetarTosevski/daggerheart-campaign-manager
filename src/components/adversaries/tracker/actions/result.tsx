"use client";

import { useState } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { rollText } from "./model";
import type { ActionResult, Intent } from "./use-adversary-actions";

const PROMPT_LABEL = { manual: "Apply", move: "Move", pcSave: "Reaction roll", summon: "Summon", countdown: "Countdown", spotlight: "Spotlight", choice: "Choice" } as const;

/**
 * The GM's view of an adversary action (AA2's `resolved` answer): the roll, hit or miss and damage per target and
 * whether its reaction window is still open, the Fear gained or spent, the GM prompts (summons, countdowns, reaction
 * rolls, the feature's words) and the reactions the server offers (Q19: one tap, default No).
 */
export function ActionResultView({
  shown,
  nameOf,
  pending,
  onFire,
  onDismiss,
}: {
  shown: ActionResult;
  nameOf: (id: string) => string;
  pending: boolean;
  onFire: (intent: Intent) => void;
  onDismiss: () => void;
}) {
  const { label, result, actor, instanceId } = shown;
  // Offers the GM said No to, per result (a new result starts with none).
  const [declined, setDeclined] = useState<{ entryId: Id<"actionLog">; uses: string[] }>({ entryId: result.entryId, uses: [] });
  const said = declined.entryId === result.entryId ? declined.uses : [];
  const hitIds = result.targets.filter((t) => t.hit && t.characterId !== undefined).map((t) => t.characterId as string);
  const offers = result.offers.filter((o) => !said.includes(o.useId));

  return (
    <section className="trk-res" aria-label="Action result" data-testid="tracker-action-result">
      <div className="trk-res-h">
        <strong>{label}</strong>
        <button type="button" className="trk-btn trk-btn-parch trk-btn-sm" onClick={onDismiss}>
          Clear
        </button>
      </div>
      {result.roll ? (
        <p className="trk-res-roll" data-testid="tracker-action-roll">
          Roll {rollText(result.roll)}
          {result.roll.dice[0]?.sides === 20 && result.roll.dice[0].value === 20 ? ": natural 20, a critical success" : ""}
        </p>
      ) : null}
      {result.targets.length > 0 ? (
        <ul className="trk-res-targets" aria-label="Targets">
          {result.targets.map((t) => {
            const id = t.characterId ?? t.instanceId ?? "";
            return (
              <li key={id} data-hit={t.hit}>
                <b>{nameOf(id)}</b>
                <span className="trk-res-verdict">{t.hit ? "Hit" : "Miss"}</span>
                {t.hit && t.damage !== undefined ? <span>{t.damage} damage</span> : null}
                {t.hit && t.requestId ? <span className="trk-res-wait">{t.resolved ? "resolved" : "waiting for answers"}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {result.fearDelta ? <p className="trk-res-line">{result.fearDelta > 0 ? `Gained ${result.fearDelta} Fear.` : `Spent ${-result.fearDelta} Fear.`}</p> : null}
      {result.prompts.length > 0 ? (
        <ul className="trk-res-prompts" aria-label="For you to do">
          {result.prompts.map((p, i) => (
            <li key={`${i}-${p.kind}`}>
              <b>{PROMPT_LABEL[p.kind]}</b> {p.text}
            </li>
          ))}
        </ul>
      ) : null}
      {offers.length > 0 ? (
        <ul className="trk-res-offers" aria-label="Reactions you may use">
          {offers.map((o) =>
            o.trigger === "beforeDamage" ? (
              <li key={o.useId}>
                {o.feature} was not used on this attack (turn it on before attacking).
              </li>
            ) : (
              <li key={o.useId}>
                <span>Use {o.feature}?</span>
                <button
                  type="button"
                  className="trk-btn trk-btn-parch trk-btn-sm"
                  disabled={pending}
                  onClick={() =>
                    onFire({
                      kind: "feature",
                      label: `${actor} uses ${o.feature}`,
                      actor,
                      args: { instanceId, targets: hitIds, feature: o.feature, useId: o.useId, ...(hitIds[0] ? { trigger: { subjectId: hitIds[0] } } : {}) },
                    })
                  }
                >
                  Yes
                </button>
                <button type="button" className="trk-btn trk-btn-parch trk-btn-sm" onClick={() => setDeclined({ entryId: result.entryId, uses: [...said, o.useId] })}>
                  No
                </button>
              </li>
            ),
          )}
        </ul>
      ) : null}
    </section>
  );
}
