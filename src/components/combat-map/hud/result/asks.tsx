"use client";

import { useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { answerChoices, askKey, type ChoiceAsk } from "../../actions/hand/model";
import { Popup, Stepper, hudButtonClass } from "../ui";
import { asksPrimary, asksProblem, choseCount, groupAsks, splitIsDamage, splitLeft, splitTotal, type ChooseAsk } from "./model";
import { hudResults, type AsksEntry } from "./store";

/**
 * After the roll (plan combat-hud H4.1; CmpPicking 'After the roll: splits and ally picks'): the numbers the roll decides
 * are split here with steppers ("Split 14 damage between your targets", "n left", Deal the damage), each ally's own pick is
 * a row of chips ("Rousing Strike · each ally picks their own", "2 of 3 chose"), and a plain choice is one row of chips.
 * The answers go back with the use (the server kept its dice: convex/lib/cardChoices.ts). Replaces the classic
 * after-roll dialog for the HUD hand. U1: the split rows name the targets only (the board's Major / Minor tags would
 * tell a player an adversary's thresholds, so they are left out).
 */

const SPLIT = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M8 2v5M8 7l-5 6M8 7l5 6" />
  </svg>
);

const keyOf = (a: ChoiceAsk) => askKey(a);

export function AsksPanel({ entry }: { entry: AsksEntry }) {
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [splits, setSplits] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const groups = groupAsks(entry.asks);
  const problem = asksProblem(entry.asks, options, splits, keyOf);
  const name = (id: string) => entry.names.get(id) ?? "Target";
  const pickOne = (a: ChooseAsk, id: string) => setOptions((all) => ({ ...all, [keyOf(a)]: [id] }));

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await entry.answer(answerChoices(entry.asks, options, splits));
      // The sender showed the result (or the next ask) in its place; anything else (a chain link's pick) closes this.
      hudResults.clear(entry.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  function chips(a: ChooseAsk, label: string) {
    const picked = options[keyOf(a)] ?? [];
    return (
      <span className="hud-res-chips" role="group" aria-label={label}>
        {a.options.map((o) => (
          <button key={o.id} type="button" className="hud-res-chip" aria-pressed={picked.includes(o.id)} onClick={() => pickOne(a, o.id)}>
            {o.label}
          </button>
        ))}
      </span>
    );
  }

  return (
    <div className="hud-res-spot" ref={ref} tabIndex={-1} data-testid="hud-result-asks">
      <Popup
        icon={SPLIT}
        title={entry.title}
        sub="After the roll"
        primary={{ label: pending ? "Sending…" : asksPrimary(entry.asks), disabled: pending || problem !== null, onClick: () => void confirm() }}
        secondary={
          <button
            type="button"
            className={hudButtonClass()}
            disabled={pending}
            onClick={() => {
              entry.cancel();
              hudResults.clear(entry.id);
            }}
          >
            Cancel
          </button>
        }
      >
        {groups.map((g) => {
          if (g.kind === "split") {
            const total = splitTotal(g.ask);
            const left = splitLeft(g.ask, splits);
            const assigned = g.ask.tokenIds.reduce((n, id) => n + (splits[id] ?? 0), 0);
            return (
              <div key={`split-${g.index}`} className="hud-res-bar" data-testid="hud-result-split">
                <div className="hud-res-sum">
                  <span>{total !== null && splitIsDamage(g.ask) ? <>Split <b>{total}</b> damage between your targets</> : g.ask.label}</span>
                  <b data-testid="hud-result-left">{left !== null ? `${left} left` : `${assigned} shared`}</b>
                </div>
                <div className="hud-res-split">
                  {g.ask.tokenIds.map((id) => {
                    const value = splits[id] ?? 0;
                    return (
                      <div key={id} className="hud-res-split-r">
                        <span>{name(id)}</span>
                        <Stepper
                          label={`${g.ask.label}: ${name(id)}`}
                          value={value}
                          min={0}
                          max={left !== null ? value + left : 99}
                          onStep={(d) => setSplits((all) => ({ ...all, [id]: Math.max(0, (all[id] ?? 0) + d) }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
          if (g.kind === "allies") {
            const count = choseCount(g.asks, options, keyOf);
            return (
              <div key={`allies-${g.stepId}`} className="hud-res-bar" data-testid="hud-result-allies">
                <div className="hud-res-sum">
                  <span>
                    <b>{g.label}</b> · each ally picks their own
                  </span>
                  <b data-testid="hud-result-chose">
                    {count.chose} of {count.of} chose
                  </b>
                </div>
                {g.asks.map((a) => (
                  <div key={keyOf(a)} className="hud-res-ally">
                    <b>{name(a.chooserId!)}</b>
                    {chips(a, `${name(a.chooserId!)}: ${a.label}`)}
                  </div>
                ))}
              </div>
            );
          }
          return (
            <div key={keyOf(g.ask)} className="hud-res-bar">
              <div className="hud-res-sum">
                <span>{g.ask.label}</span>
              </div>
              {chips(g.ask, g.ask.label)}
            </div>
          );
        })}
        {problem && !pending ? <p className="hud-res-why">{problem}</p> : null}
        {error ? (
          <p role="alert" className="hud-res-err">
            {error}
          </p>
        ) : null}
      </Popup>
    </div>
  );
}
