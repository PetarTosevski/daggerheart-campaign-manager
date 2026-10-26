"use client";

import { DiceTiles } from "@/components/party/dice/parts";

import { outcomeLine, targetVerdict } from "../attack";
import { BAND_LABEL, type RangeBand } from "../targets";
import type { ResolvedUse } from "./model";

/**
 * A card use's result, in CA5's result view (U1, Q5): the player's own roll and damage totals, Hit / Miss / Defeated
 * per target, and what the table still does: manual steps show the card's words and a Done button (Q9), movements,
 * reaction rolls and damage to PCs are listed. It never shows an enemy's HP, Stress, thresholds or Difficulty: the
 * server never sends them.
 */

export type LastCard =
  | { kind: "resolved"; cardName: string; result: ResolvedUse; names: ReadonlyMap<string, string>; done: readonly number[] }
  | { kind: "pending"; cardName: string; outOfRange: { tokenId: string; band: RangeBand }[]; names: ReadonlyMap<string, string> };

const PROMPT_WORD: Record<ResolvedUse["prompts"][number]["kind"], string> = {
  manual: "At the table",
  move: "Move",
  pcSave: "Reaction roll",
  pcDamage: "Damage to a PC",
  fold: "Also",
};

export function CardResult({ last, onDone }: { last: LastCard; onDone: (index: number) => void }) {
  if (last.kind === "pending") {
    return (
      <p role="status" className="cma-waiting" data-testid="combat-card-pending">
        {last.cardName}: out of range ({last.outOfRange.map((o) => `${last.names.get(o.tokenId) ?? "target"}: ${BAND_LABEL[o.band]}`).join(", ")}). The card waits for the
        GM; nothing is rolled or paid until they allow it.
      </p>
    );
  }
  const { result, names, cardName } = last;
  const outcome = result.roll ? outcomeLine(result.roll) : null;
  const prompts = result.prompts.map((p, i) => ({ ...p, i })).filter((p) => !last.done.includes(p.i));
  return (
    <section className="cma-result" aria-label="Card result" data-testid="combat-card-result">
      {result.roll && outcome ? (
        <div className="cma-result-row">
          <DiceTiles roll={result.roll} />
          <div className="cma-result-main">
            <span className="cma-total">{result.roll.total}</span>
            <span className="cma-result-text">
              <span className={`cma-outcome ${outcome.tone}`}>{outcome.text}</span>
              <span className="cm-muted cma-small">{cardName}</span>
            </span>
          </div>
        </div>
      ) : (
        <p className="cma-result-text">
          <span className="cma-outcome hope">Used</span> <span className="cm-muted cma-small">{cardName}</span>
        </p>
      )}
      {result.damage.map((d, i) => (
        <div key={i} className="cma-result-row" data-testid="combat-card-damage">
          <DiceTiles roll={d} />
          <div className="cma-result-main">
            <span className="cma-total dmg">{d.total}</span>
            <span className="cma-result-text">
              <span className="cma-outcome dmg">Damage</span>
              <span className="cm-muted cma-small">Your damage total</span>
            </span>
          </div>
        </div>
      ))}
      {result.targets.length > 0 ? (
        <ul className="cma-verdicts" aria-label="Targets">
          {result.targets.map((t) => {
            const verdict = targetVerdict(t);
            return (
              <li key={t.tokenId} className="cma-verdict" data-verdict={verdict.toLowerCase()} data-testid="combat-card-verdict">
                <span>{names.get(t.tokenId) ?? "Target"}</span>
                <strong>{verdict}</strong>
              </li>
            );
          })}
        </ul>
      ) : null}
      {prompts.length > 0 ? (
        <ul className="cmh-prompts" aria-label="Still to do">
          {prompts.map((p) => (
            <li key={p.i} className="cmh-prompt" data-kind={p.kind} data-testid="combat-card-prompt">
              <span className="cm-lbl">{PROMPT_WORD[p.kind]}</span>
              <span className="cmh-prompt-text">{p.text}</span>
              {p.kind === "manual" ? (
                <button type="button" className="cm-btn cm-sm" aria-label={`Done: ${p.text}`} onClick={() => onDone(p.i)}>
                  Done
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {result.fearDelta > 0 ? <p className="cm-muted cma-small cma-note">The GM gains {result.fearDelta} Fear.</p> : null}
      {result.minionOffer ? <p className="cm-muted cma-small cma-note">Your damage can defeat more Minions: pick them under Attack.</p> : null}
    </section>
  );
}
