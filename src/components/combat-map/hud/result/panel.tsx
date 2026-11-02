"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { damageText, outcomeTag, rowDamage, type ResultView } from "./model";
import { CardArt, DiceLine, VerdictPill } from "./parts";

/**
 * The result panel (plan combat-hud H4.1; Main 'Card result', `.res`): the card's art and name with "<actor> · <roll>",
 * the outcome tag ("Success with Hope"), the duality dice, modifier and total with "+1 Hope", then one row per target:
 * name, Hit / Miss / Defeated, the actor's own damage on a hit ("1d8+1 → 7 physical") and the condition names the target
 * now carries (answer 10a), and the table steps the use leaves (a manual step gets Done). Players never see an
 * adversary's number: the server sends none (U1). `children` adds the follow-up asks under the rows (a damage-phase
 * rider: "Use Death Strike on the Bandit?").
 */

const PROMPT_WORD: Record<ResultView["prompts"][number]["kind"], string> = {
  manual: "At the table",
  move: "Move",
  pcSave: "Reaction roll",
  pcDamage: "Damage to a PC",
  fold: "Also",
};

const CONDITION = (
  <svg className="hud-res-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <rect x="1.5" y="5" width="7" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <rect x="7.5" y="5" width="7" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export function ResultPanel({
  view,
  done,
  conditions,
  onDone,
  onClose,
  children,
}: {
  view: ResultView;
  /** Manual steps already marked done. */
  done: readonly number[];
  /** The condition names a target carries now (players: from their view; names only). */
  conditions: (tokenId: string) => readonly string[];
  onDone: (index: number) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const tag = outcomeTag(view.roll, view.success);
  const prompts = view.prompts.map((p, i) => ({ ...p, i })).filter((p) => !done.includes(p.i));
  const ownLines = view.damage.length > 1;
  return (
    <section
      className="hud-res"
      role="status"
      aria-labelledby={titleId}
      data-testid="hud-result"
      data-kind={view.kind}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="hud-res-h">
        <CardArt cardId={view.cardId} />
        <div className="hud-res-ht">
          <h2 id={titleId}>{view.title}</h2>
          <span>{view.sub}</span>
        </div>
        <span className={cn("hud-res-tag", `hud-res-tag-${tag.tone}`)} data-testid="hud-result-tag">
          {tag.text}
        </span>
        <button type="button" className="hud-res-x" aria-label={`Close the result of ${view.title}`} onClick={onClose}>
          ✕
        </button>
      </div>
      {view.roll ? <DiceLine roll={view.roll} fear={view.fear} /> : null}
      {view.targets.length > 0 ? (
        <ul className="hud-res-rows" aria-label="Targets">
          {view.targets.map((t) => {
            const dmg = rowDamage(view, t);
            const marks = conditions(t.tokenId);
            return (
              <li key={t.tokenId} className="hud-res-row" data-testid="hud-result-row" data-token={t.tokenId}>
                <span className="hud-res-t">{t.name}</span>
                <VerdictPill verdict={t.verdict} />
                {dmg ? (
                  <span className="hud-res-d" data-testid="hud-result-row-damage">
                    {dmg.formula} → <b>{dmg.total}</b>
                    {dmg.type ? ` ${dmg.type}` : ""}
                  </span>
                ) : null}
                {marks.length > 0 ? (
                  <span className="hud-res-c">
                    {CONDITION}
                    {marks.join(", ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {ownLines || (view.targets.length === 0 && view.damage.length > 0) ? (
        <ul className="hud-res-rows" aria-label="Your damage">
          {view.damage.map((d, i) => (
            <li key={i} className="hud-res-row" data-testid="hud-result-damage">
              <span className="hud-res-t">Your damage</span>
              <span className="hud-res-d">{damageText(d)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {prompts.length > 0 ? (
        <ul className="hud-res-rows" aria-label="Still to do">
          {prompts.map((p) => (
            <li key={p.i} className="hud-res-row hud-res-todo" data-testid="hud-result-prompt">
              <span className="hud-res-k">{PROMPT_WORD[p.kind]}</span>
              <span className="hud-res-todo-t">{p.text}</span>
              {p.kind === "manual" ? (
                <button type="button" className="hud-btn hud-res-done" aria-label={`Done: ${p.text}`} onClick={() => onDone(p.i)}>
                  Done
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {view.notes.length > 0 ? (
        <ul className="hud-res-notes">
          {view.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </section>
  );
}
