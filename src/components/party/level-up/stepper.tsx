"use client";

import { useState } from "react";

import { Label, paperField, Small } from "@/components/party/sheet-ui";
import { tierForLevel } from "@/lib/domain/characters";
import {
  ACHIEVEMENT_LEVELS,
  availableOptions,
  cardsWithin,
  DOMAIN_CARD_CAP,
  isMarked,
  MARK_CLEAR_LEVELS,
  OPTION_RULES,
  validateLevelUp,
  type LevelUpChoice,
  type MulticlassChoice,
  type PickChoice,
  type Tier,
} from "@/lib/domain/level-up";
import { useIntent } from "@/lib/use-intent";
import { CLASSES } from "@/lib/srd/classes";
import { DOMAIN_CARDS, DOMAINS } from "@/lib/srd/domain-cards";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { TRAIT_IDS } from "@/lib/srd/types";
import type { CharacterSheet } from "@/lib/validation/characters";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

import { OPTION_SHORT, sourcesFor, traitLabel } from "./shared";

const STEPS = ["Achievements", "Advancements", "Domain card", "Summary"] as const;

type Pick = PickChoice & { key: number };

/** The board's advPick option button (aria-pressed); styles in level-up.css. */
const chip = "lu-opt";

const select = paperField.input;

const cardName = (id: string) => DOMAIN_CARDS.find((c) => c.id === id)?.name ?? id;

/** The level-up stepper (CB 109-111): achievements, two picks, the level's card and trade, summary. */
export function LevelUpStepper({
  characterId,
  sheet,
  hopeAndFear,
  onDone,
}: {
  characterId: Id<"characters">;
  sheet: CharacterSheet;
  hopeAndFear: boolean;
  onDone: () => void;
}) {
  const level = sheet.level + 1;
  const tier = tierForLevel(level);
  const sources = sourcesFor(hopeAndFear);
  const ctx = { allowExpansion: hopeAndFear };
  const { fire, error, pending } = useIntent(api.levelUp.apply);

  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [experienceName, setExperienceName] = useState("");
  const [multiclass, setMulticlass] = useState<MulticlassChoice>({ classId: "", domainId: "", subclassId: "" });
  const takesMulticlass = picks.some((p) => p.option === "multiclass");
  const reach = takesMulticlass && multiclass.domainId ? { ...sheet, multiclass } : sheet;
  const levelCards = cardsWithin(reach, level, 10, sources);
  const [cardId, setCardId] = useState(() => cardsWithin(sheet, level, 10, sources)[0]?.id ?? "");
  const [tradeOut, setTradeOut] = useState("");
  const [tradeIn, setTradeIn] = useState("");

  const choice: LevelUpChoice = {
    picks: picks.map(({ option, tier: t, targets }) => (targets ? { option, tier: t, targets } : { option, tier: t })),
    cardId,
    ...(ACHIEVEMENT_LEVELS.includes(level) ? { experienceName } : {}),
    ...(tradeOut && tradeIn ? { trade: { out: tradeOut, in: tradeIn } } : {}),
    ...(takesMulticlass ? { multiclass } : {}),
  };
  const problems = validateLevelUp(sheet, choice, ctx);
  const cost = picks.reduce((sum, p) => sum + OPTION_RULES[p.option].cost, 0);
  const open = availableOptions(sheet).filter((o) => o.blocked === null);

  function take(option: PickChoice["option"], t: number) {
    setPicks([...picks, { key: nextKey, option, tier: t, ...(needsTargets(option) ? { targets: [] } : {}) }]);
    setNextKey(nextKey + 1);
  }
  const update = (key: number, targets: string[]) => setPicks(picks.map((p) => (p.key === key ? { ...p, targets } : p)));
  const toggle = (p: Pick, id: string) => {
    const list = p.targets ?? [];
    update(p.key, list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-2));
  };

  async function confirm() {
    const result = await fire({ characterId, choice });
    if (result) onDone();
  }

  const marksClear = MARK_CLEAR_LEVELS.includes(level);
  const traitsTaken = (except: number) => picks.filter((p) => p.option === "traits" && p.key !== except).flatMap((p) => p.targets ?? []);
  const cardsTaken = (except: number) => [cardId, tradeIn, ...picks.filter((p) => p.option === "domainCard" && p.key !== except).flatMap((p) => p.targets ?? [])];
  const ownClass = CLASSES.find((c) => c.id === sheet.classId);
  const mcClass = CLASSES.find((c) => c.id === multiclass.classId);
  const outCard = DOMAIN_CARDS.find((c) => c.id === tradeOut);

  return (
    <div className="lu-body">
      <ol className="lu-steps" aria-label="Level-up steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section aria-label="Achievements" className="flex flex-col gap-3">
          {ACHIEVEMENT_LEVELS.includes(level) ? (
            <>
              <Small as="p">
                Level {level} achievements: a new Experience at +2 and +1 Proficiency
                {marksClear ? "; the marks on your traits clear first, so you can raise them again." : "."}
              </Small>
              <label className="flex flex-col gap-1.5">
                <Label>New Experience</Label>
                <input className={select} value={experienceName} maxLength={80} onChange={(e) => setExperienceName(e.target.value)} />
              </label>
            </>
          ) : (
            <Small as="p">No achievements at level {level}. Take two advancements next.</Small>
          )}
        </section>
      ) : null}

      {step === 1 ? (
        <section aria-label="Advancements" className="flex flex-col gap-4">
          <Small as="p">
            Choose two options from tier {tier} or lower ({cost} of 2 picks used). Proficiency and multiclass take both.
          </Small>
          <ul className="lu-opts" aria-label="Options">
            {open.map((o) => {
              const takenNow = picks.filter((p) => p.tier === o.tier && p.option === o.option).length;
              const full = cost + o.cost > 2 || o.used + takenNow >= o.slots;
              // Pressed = taken at this level. With no room left a pressed option toggles off; otherwise it takes another slot.
              const untake = full && takenNow > 0;
              return (
                <li key={`${o.tier}-${o.option}`}>
                  <button
                    type="button"
                    className={chip}
                    aria-pressed={takenNow > 0}
                    disabled={full && !untake}
                    aria-label={`Take tier ${o.tier}: ${OPTION_SHORT[o.option]}`}
                    onClick={() => (untake ? setPicks(picks.filter((x) => x.key !== picks.findLast((p) => p.tier === o.tier && p.option === o.option)?.key)) : take(o.option, o.tier))}
                  >
                    <span className="lu-opt-tier">Tier {o.tier}</span>
                    {OPTION_SHORT[o.option]}
                    <span className="lu-opt-note">({o.slots - o.used - takenNow} left)</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {picks.length > 0 ? (
            <ul className="lu-picks" aria-label="Your picks">
              {picks.map((p) => (
                <li key={p.key} className="lu-pick" aria-label={`Pick: ${OPTION_SHORT[p.option]}`}>
                  <div className="flex items-center justify-between gap-2">
                    <strong>
                      Tier {p.tier}: {OPTION_SHORT[p.option]}
                    </strong>
                    <button type="button" className="sh-modal-cancel" onClick={() => setPicks(picks.filter((x) => x.key !== p.key))} aria-label={`Remove ${OPTION_SHORT[p.option]}`}>
                      Remove
                    </button>
                  </div>
                  {p.option === "traits" ? (
                    <div className="lu-chips" role="group" aria-label="Traits to raise">
                      {TRAIT_IDS.map((t) => {
                        const on = (p.targets ?? []).includes(t);
                        const marked = (!marksClear && isMarked({ ...sheet, level }, t)) || traitsTaken(p.key).includes(t);
                        return (
                          <button key={t} type="button" aria-pressed={on} disabled={marked} className={chip} onClick={() => toggle(p, t)}>
                            {traitLabel(t)} {marked ? "(marked)" : ""}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {p.option === "experiences" ? (
                    <div className="lu-chips" role="group" aria-label="Experiences to raise">
                      {sheet.experiences.map((x) => {
                        const on = (p.targets ?? []).includes(x.id);
                        return (
                          <button key={x.id} type="button" aria-pressed={on} className={chip} onClick={() => toggle(p, x.id)}>
                            {x.name} +{x.value}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {p.option === "domainCard" ? (
                    <label className="flex flex-col gap-1.5">
                      <Label>Extra card (up to level {Math.min(level, DOMAIN_CARD_CAP[p.tier as Tier])})</Label>
                      <select className={select} value={p.targets?.[0] ?? ""} onChange={(e) => update(p.key, e.target.value ? [e.target.value] : [])}>
                        <option value="">Choose a card</option>
                        {cardsWithin(reach, level, DOMAIN_CARD_CAP[p.tier as Tier], sources)
                          .filter((c) => !cardsTaken(p.key).includes(c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} (level {c.level})
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                  {p.option === "multiclass" ? (
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="flex flex-col gap-1.5">
                        <Label>Class</Label>
                        <select className={select} value={multiclass.classId} onChange={(e) => setMulticlass({ classId: e.target.value, domainId: "", subclassId: "" })}>
                          <option value="">Choose</option>
                          {CLASSES.filter((c) => c.id !== sheet.classId && sources.includes(c.source)).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <Label>Domain</Label>
                        <select className={select} value={multiclass.domainId} onChange={(e) => setMulticlass({ ...multiclass, domainId: e.target.value })}>
                          <option value="">Choose</option>
                          {(mcClass?.domains ?? [])
                            .filter((d) => !ownClass?.domains.includes(d))
                            .map((d) => (
                              <option key={d} value={d}>
                                {DOMAINS.find((x) => x.id === d)?.name ?? d}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <Label>Foundation card</Label>
                        <select className={select} value={multiclass.subclassId} onChange={(e) => setMulticlass({ ...multiclass, subclassId: e.target.value })}>
                          <option value="">Choose</option>
                          {SUBCLASSES.filter((s) => s.classId === multiclass.classId && sources.includes(s.source)).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-label="Domain card" className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <Label>Level {level} domain card</Label>
            <select className={select} value={cardId} onChange={(e) => setCardId(e.target.value)}>
              <option value="">Choose a card</option>
              {levelCards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (level {c.level}, {DOMAINS.find((d) => d.id === c.domain)?.name ?? c.domain})
                </option>
              ))}
            </select>
          </label>
          <fieldset className="lu-panel">
            <legend className="sh-lbl px-1">Optional: trade a card for one of equal or lower level</legend>
            <label className="flex flex-col gap-1.5">
              <Label>Trade out</Label>
              <select
                className={select}
                value={tradeOut}
                onChange={(e) => {
                  setTradeOut(e.target.value);
                  setTradeIn("");
                }}
              >
                <option value="">No trade</option>
                {sheet.domainCards.owned.map((id) => (
                  <option key={id} value={id}>
                    {cardName(id)}
                  </option>
                ))}
              </select>
            </label>
            {outCard ? (
              <label className="flex flex-col gap-1.5">
                <Label>Take instead</Label>
                <select className={select} value={tradeIn} onChange={(e) => setTradeIn(e.target.value)}>
                  <option value="">Choose a card</option>
                  {cardsWithin(reach, level, outCard.level, sources)
                    .filter((c) => c.id !== cardId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (level {c.level})
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
          </fieldset>
        </section>
      ) : null}

      {step === 3 ? (
        <section aria-label="Summary" className="flex flex-col gap-2">
          <ul className="m-0 flex flex-col gap-1 pl-5">
            <li>Level {sheet.level} → {level}; damage thresholds +1.</li>
            {ACHIEVEMENT_LEVELS.includes(level) ? <li>New Experience “{experienceName.trim()}” +2; Proficiency +1.</li> : null}
            {picks.map((p) => (
              <li key={p.key}>
                {OPTION_SHORT[p.option]}
                {p.targets?.length ? `: ${p.targets.map((t) => (p.option === "traits" ? traitLabel(t) : p.option === "experiences" ? (sheet.experiences.find((x) => x.id === t)?.name ?? t) : cardName(t))).join(", ")}` : ""}
              </li>
            ))}
            {cardId ? <li>Domain card: {cardName(cardId)}</li> : null}
            {tradeOut && tradeIn ? (
              <li>
                Trade {cardName(tradeOut)} for {cardName(tradeIn)}
              </li>
            ) : null}
          </ul>
          {problems.length > 0 ? (
            <ul className="lu-problems" aria-label="Still to do">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <p role="alert" className="lu-error empty:hidden">
        {error}
      </p>

      <div className="sh-modal-actions">
        <button type="button" className="sh-modal-cancel" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="sh-modal-ok" onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="sh-modal-ok" disabled={problems.length > 0 || pending} onClick={() => void confirm()}>
            Confirm level {level}
          </button>
        )}
      </div>
    </div>
  );
}

function needsTargets(option: PickChoice["option"]): boolean {
  return option === "traits" || option === "experiences" || option === "domainCard";
}
