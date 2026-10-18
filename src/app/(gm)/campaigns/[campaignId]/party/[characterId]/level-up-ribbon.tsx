"use client";

import "./level-up-ribbon.css";

import { OPTION_SHORT, traitLabel } from "@/components/party/level-up/shared";
import { ACHIEVEMENT_LEVELS, MARK_CLEAR_LEVELS, type PickChoice } from "@/lib/domain/level-up";
import { CLASSES } from "@/lib/srd/classes";
import { DOMAIN_CARDS, DOMAINS } from "@/lib/srd/domain-cards";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import type { CharacterSheet } from "@/lib/validation/characters";

import { useLevelUpDraft, type LevelUpDraftValue } from "./level-up-draft";

const cardName = (id: string) => DOMAIN_CARDS.find((c) => c.id === id)?.name ?? id;

/** The tier achievements of the new level (CB 109), as the old stepper said them. */
export function achievementText(level: number): string {
  if (!ACHIEVEMENT_LEVELS.includes(level)) return `No achievements at level ${level}. Take two advancements and the level's domain card.`;
  const clear = MARK_CLEAR_LEVELS.includes(level) ? "; the marks on your traits clear first, so you can raise them again." : ".";
  return `Level ${level} achievements: a new Experience at +2 and +1 Proficiency${clear}`;
}

function targetNames(pick: PickChoice, sheet: CharacterSheet): string {
  const names = (pick.targets ?? []).map((t) =>
    pick.option === "traits" ? traitLabel(t) : pick.option === "experiences" ? (sheet.experiences.find((x) => x.id === t)?.name ?? t) : cardName(t),
  );
  return names.length > 0 ? `: ${names.join(", ")}` : "";
}

/** Every choice of the draft in words, for the Finish step. */
function Summary({ lu, sheet }: { lu: LevelUpDraftValue; sheet: CharacterSheet }) {
  const { draft, choice, level } = lu;
  const mc = choice.multiclass;
  return (
    <ul className="lu-rb-choices" aria-label="Your choices">
      <li>
        Level {sheet.level} → {level}; damage thresholds +1.
      </li>
      {ACHIEVEMENT_LEVELS.includes(level) ? (
        <li>{draft.experienceName.trim() ? `New Experience “${draft.experienceName.trim()}” +2; Proficiency +1.` : "New Experience: not named yet. Proficiency +1."}</li>
      ) : null}
      {draft.picks.length === 0 ? <li>Advancements: none ticked yet.</li> : null}
      {draft.picks.map((p, i) => (
        // Picks have no id; the same option can be taken twice in a tier, so the position completes the key.
        <li key={`${p.tier}-${p.option}-${i}`}>
          Tier {p.tier}: {OPTION_SHORT[p.option]}
          {targetNames(p, sheet)}
          {p.option === "multiclass" && mc
            ? `: ${CLASSES.find((c) => c.id === mc.classId)?.name ?? mc.classId}, ${DOMAINS.find((d) => d.id === mc.domainId)?.name ?? mc.domainId}, ${SUBCLASSES.find((s) => s.id === mc.subclassId)?.name ?? mc.subclassId}`
            : ""}
        </li>
      ))}
      <li>{draft.cardId ? `Domain card: ${cardName(draft.cardId)}` : "Domain card: not chosen yet."}</li>
      {choice.trade ? (
        <li>
          Exchange {cardName(choice.trade.out)} for {cardName(choice.trade.in)}
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The guided level-up ribbon under the sheet header (plan guided-level-up): the steps in book order with their
 * done state, the tier achievements, Back / Next / Cancel, and on the Finish step the summary, the problems (each a
 * button to the step that fixes it) and "Finish level-up". Renders nothing outside the mode.
 */
export function LevelUpRibbon() {
  const lu = useLevelUpDraft();
  const { active, sheet, steps, step, level, issues, goTo } = lu;
  if (!active || !sheet) return null;
  const index = steps.findIndex((s) => s.id === step);
  const previous = steps[index - 1];
  const next = steps[index + 1];

  return (
    <section id="lu-ribbon" className="lu-ribbon" aria-labelledby="lu-ribbon-title">
      <div className="lu-rb-head">
        <h2 id="lu-ribbon-title" className="lu-rb-title" tabIndex={-1}>
          Level-up to {level}
        </h2>
        <p className="lu-rb-ach">{achievementText(level)}</p>
      </div>
      <ol className="lu-rb-steps" aria-label="Level-up steps">
        {steps.map((s, i) => (
          <li key={s.id} aria-current={s.id === step ? "step" : undefined} data-done={s.done}>
            <button type="button" className="lu-rb-step" onClick={() => goTo(s.id)}>
              <span className="lu-rb-num" aria-hidden="true">
                {s.done ? "✓" : i + 1}
              </span>
              <span>
                {s.label}
                {s.done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step === "finish" ? (
        <div className="lu-rb-summary">
          <h3 id="lu-ribbon-summary" className="lu-rb-sub">
            Summary
          </h3>
          <Summary lu={lu} sheet={sheet} />
          {issues.length > 0 ? (
            <>
              <h3 className="lu-rb-sub" id="lu-rb-todo">
                Still to do
              </h3>
              <ul className="lu-rb-problems" aria-labelledby="lu-rb-todo">
                {issues.map((issue) => (
                  <li key={issue.message}>
                    <button type="button" className="lu-rb-problem" onClick={() => goTo(issue.target)}>
                      {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="lu-rb-ready">Everything is chosen. Finish to level up.</p>
          )}
        </div>
      ) : null}

      <p role="alert" className="lu-rb-error">
        {lu.error}
      </p>

      <div className="lu-rb-nav">
        <button type="button" className="sh-modal-cancel lu-rb-cancel" onClick={lu.cancel}>
          Cancel
        </button>
        <button type="button" className="sh-modal-cancel" disabled={!previous} onClick={() => previous && goTo(previous.id)}>
          Back
        </button>
        {next ? (
          <button type="button" className="sh-modal-ok" onClick={() => goTo(next.id)}>
            Next
          </button>
        ) : (
          <button type="button" className="sh-modal-ok" disabled={lu.problems.length > 0 || lu.pending} onClick={() => void lu.finish()}>
            Finish level-up
          </button>
        )}
      </div>
    </section>
  );
}
