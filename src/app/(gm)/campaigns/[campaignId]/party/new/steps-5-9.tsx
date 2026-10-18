"use client";

import { designAsset } from "@/lib/design-assets";
import { TRAIT_LABEL, traitIdSchema } from "@/lib/frames/extras/common";
import { IKONIS_RANGES, IKONIS_TRAINING_CLASS_ID, type Ikonis } from "@/lib/frames/extras/motherboard";
import { DOMAIN_CARD_ART, EXPERIENCE_SUGGESTIONS, getClass, getDomain, getSubclass, getWeapon, type Armor, type Weapon } from "@/lib/srd";
import { cn } from "@/lib/utils";

import { Choice, formatModifier, Group, HfMini, traitLabel, type StepProps } from "./steps-1-4";
import {
  armorFor,
  classItemsFor,
  domainCardOptions,
  gearSummary,
  POTIONS,
  primaryWeaponsFor,
  secondaryWeaponsFor,
  suggestedLoadout,
  toggleCard,
  toggleExperience,
} from "./wizard-logic";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const burdenLabel = (b: Weapon["burden"]) => (b === "two-handed" ? "Two-Handed" : b === "one-handed" ? "One-Handed" : "Barehanded");

function WeaponBody({ w }: { w: Weapon }) {
  return (
    <>
      <span className="wz-gn">
        {w.name}
        {w.category === "magic" ? <span className="wz-magic">Magic</span> : null}
        {w.source === "hope-and-fear" ? <HfMini /> : null}
      </span>
      <span>
        {w.trait === "choice" ? "Any trait" : traitLabel(w.trait)} · {w.range}
      </span>
      <span>
        {w.damage} · {burdenLabel(w.burden)}
      </span>
      {w.feature ? (
        <span className="wz-gf">
          {w.feature.name}: {w.feature.text}
        </span>
      ) : null}
    </>
  );
}

function ArmorBody({ a }: { a: Armor }) {
  return (
    <>
      <span className="wz-gn">
        {a.name}
        {a.source === "hope-and-fear" ? <HfMini /> : null}
      </span>
      <span>
        Thresholds {a.baseThresholds.major} / {a.baseThresholds.severe}
      </span>
      <span>Armor Score {a.baseScore}</span>
      {a.feature ? (
        <span className="wz-gf">
          {a.feature.name}: {a.feature.text}
        </span>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- Step 5

/** Motherboard module sheet, top section: trait, range and damage, damage type, name (CB 301). */
function IkonisFields({ state, update }: Pick<StepProps, "state" | "update">) {
  const ik = state.ikonis;
  const set = (patch: Partial<Ikonis>) => update({ ikonis: { ...ik, ...patch } });
  return (
    <Group legend="Ikonis">
      <p className="wz-note">
        Two-handed. Bonded: gain a bonus to your damage rolls equal to your level. It starts with two Augment slots
        {state.classId === IKONIS_TRAINING_CLASS_ID ? "; Ikonis Training gives you a Force augment (+1 damage) already crafted and installed." : " and no augments installed."}
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="wz-lbl">Ikonis name</span>
          <input className="wz-in" type="text" maxLength={80} value={ik.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="wz-lbl">Ikonis trait</span>
          <select className="wz-select" value={ik.trait ?? ""} onChange={(e) => set({ trait: traitIdSchema.safeParse(e.target.value).data ?? null })}>
            <option value="">Choose…</option>
            {traitIdSchema.options.map((t) => (
              <option key={t} value={t}>
                {TRAIT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="wz-lbl">Ikonis range and damage</span>
          <select className="wz-select" value={ik.range ?? ""} onChange={(e) => set({ range: IKONIS_RANGES.find((r) => r.range === e.target.value)?.range ?? null })}>
            <option value="">Choose…</option>
            {IKONIS_RANGES.map((r) => (
              <option key={r.range} value={r.range}>
                {r.range}: {r.damage}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="wz-lbl">Ikonis damage type</span>
          <select
            className="wz-select"
            value={ik.damageType ?? ""}
            onChange={(e) => set({ damageType: e.target.value === "physical" || e.target.value === "tech" ? e.target.value : null })}
          >
            <option value="">Choose…</option>
            <option value="physical">Physical</option>
            <option value="tech">Tech</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="wz-lbl">Ikonis description</span>
        <textarea className="wz-ta" maxLength={2000} value={ik.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
    </Group>
  );
}

export function EquipmentStep({ state, update, opts }: StepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  const sub = state.subclassId ? getSubclass(state.subclassId) : undefined;
  const primary = state.primaryWeaponId ? getWeapon(state.primaryWeaponId) : undefined;
  const twoHanded = primary?.burden === "two-handed";
  const loadout = suggestedLoadout(state, opts);
  const items = classItemsFor(cls);
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {opts.ikonis ? (
          <p className="wz-lead min-w-[min(100%,260px)] flex-1">
            In Motherboard you don&apos;t take weapons: design your <strong>Ikonis</strong>, a two-handed weapon that grows with you. Then choose a set of Tier 1 armor.
          </p>
        ) : (
          <p className="wz-lead min-w-[min(100%,260px)] flex-1">
            Choose Tier 1 weapons: a <strong>two-handed primary</strong>, or a <strong>one-handed primary and a one-handed secondary</strong>. Then choose a set of Tier
            1 armor.
          </p>
        )}
        {loadout ? (
          <button
            type="button"
            className="wz-ghost"
            onClick={() =>
              update(opts.ikonis ? { armorId: loadout.armorId } : { primaryWeaponId: loadout.primaryWeaponId, secondaryWeaponId: loadout.secondaryWeaponId, armorId: loadout.armorId })
            }
          >
            Use suggested {opts.ikonis ? "armor" : "loadout"}
          </button>
        ) : null}
      </div>
      {opts.ikonis ? <IkonisFields state={state} update={update} /> : null}
      {!opts.ikonis && sub ? (
        <p className="wz-note">
          {sub.spellcastTrait
            ? `Your Spellcast trait is ${traitLabel(sub.spellcastTrait)}, so you can wield magic weapons.`
            : "Your subclass has no Spellcast trait, so magic weapons are unavailable."}
        </p>
      ) : null}

      {opts.ikonis ? null : (
        <>
          <Group legend="Primary weapon">
            <div className="wz-gears">
              {primaryWeaponsFor(state, opts).map((w) => (
                <Choice
                  key={w.id}
                  name="primary"
                  checked={state.primaryWeaponId === w.id}
                  onSelect={() => update({ primaryWeaponId: w.id, ...(w.burden === "two-handed" ? { secondaryWeaponId: null } : {}) })}
                  className="wz-gear"
                >
                  <WeaponBody w={w} />
                </Choice>
              ))}
            </div>
          </Group>
    
          <Group
            legend={
              <>
                Secondary weapon{" "}
                <span className="font-serif text-[15px] tracking-normal text-[#8a6d3b] normal-case">(optional, one-handed primaries only)</span>
              </>
            }
          >
            <div className="wz-gears">
              <Choice name="secondary" checked={!state.secondaryWeaponId} onSelect={() => update({ secondaryWeaponId: null })} className="wz-gear">
                <span className="wz-gn">None</span>
                <span>{twoHanded ? "Your primary weapon takes both hands." : "Keep a hand free."}</span>
              </Choice>
              {secondaryWeaponsFor(opts).map((w) => (
                <Choice
                  key={w.id}
                  name="secondary"
                  checked={state.secondaryWeaponId === w.id}
                  disabled={twoHanded}
                  onSelect={() => update({ secondaryWeaponId: w.id })}
                  className="wz-gear"
                >
                  <WeaponBody w={w} />
                </Choice>
              ))}
            </div>
          </Group>
        </>
      )}

      <Group legend="Armor">
        <div className="wz-gears">
          {armorFor(opts).map((a) => (
            <Choice key={a.id} name="armor" checked={state.armorId === a.id} onSelect={() => update({ armorId: a.id })} className="wz-gear">
              <ArmorBody a={a} />
            </Choice>
          ))}
        </div>
      </Group>

      <div className="wz-sum" aria-live="polite">
        {gearSummary(state)}
      </div>

      <div className="flex flex-col gap-2">
        <span className="wz-lbl">Inventory</span>
        <p className="wz-lead">You take a torch, 50 feet of rope, basic supplies and a handful of gold. Then choose:</p>
      </div>
      <Group legend="Potion">
        <div className="flex flex-wrap gap-2">
          {POTIONS.map((p) => (
            <Choice key={p.name} name="potion" checked={state.potion === p.name} onSelect={() => update({ potion: p.name })} className="wz-pill">
              {p.name} ({p.effect})
            </Choice>
          ))}
        </div>
      </Group>
      {items.length > 0 ? (
        <Group legend="Class item">
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <Choice key={item} name="class-item" checked={state.classItem === item} onSelect={() => update({ classItem: item })} className="wz-pill">
                {item}
              </Choice>
            ))}
          </div>
        </Group>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Steps 6 and 9

function Questions({ questions, answers, onChange, prefix }: { questions: readonly string[]; answers: string[]; onChange: (answers: string[]) => void; prefix: string }) {
  if (questions.length === 0) return <p className="wz-note">Your class has no prompts here. Write anything you like on your sheet later.</p>;
  return questions.map((q, i) => (
    <div key={q} className="flex flex-col gap-1.5">
      <label htmlFor={`${prefix}-${i}`} className="text-[17px] leading-snug font-semibold">
        {q}
      </label>
      <textarea
        id={`${prefix}-${i}`}
        className="wz-ta"
        maxLength={2000}
        value={answers[i] ?? ""}
        onChange={(e) => {
          const next = questions.map((_, j) => answers[j] ?? "");
          next[i] = e.target.value;
          onChange(next);
        }}
      />
    </div>
  ));
}

export function BackgroundStep({ state, update }: StepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <p className="wz-lead">
        Develop your background by answering your class’s questions, or modify and replace them. Your background has no mechanical effect, and you can leave parts ambiguous
        to discover through play.
      </p>
      <Questions questions={cls?.backgroundQuestions ?? []} answers={state.background} onChange={(background) => update({ background })} prefix="cc-bq" />
    </div>
  );
}

export function ConnectionsStep({ state, update }: StepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <p className="wz-lead">
        Go around the table and describe your characters to one another: name, pronouns, description, Experiences and background answers. Then suggest at least one
        connection between your character and each other PC. Accept the ones you want to explore; it’s fine to leave some for play.
      </p>
      <Questions questions={cls?.connectionQuestions ?? []} answers={state.connections} onChange={(connections) => update({ connections })} prefix="cc-conn" />
    </div>
  );
}

// ---------------------------------------------------------------- Step 7

export function ExperiencesStep({ state, update }: StepProps) {
  const [a, b] = state.experiences;
  const chosen = [a.trim(), b.trim()];
  return (
    <div className="flex flex-col gap-4">
      <p className="wz-lead">
        An Experience is a word or phrase for a set of skills, traits or aptitudes your character has acquired. You get <strong>two Experiences at +2</strong>. Avoid ones
        too broad to apply to any roll, or that grant magical powers.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
        {(["First", "Second"] as const).map((label, i) => (
          <div key={label} className="wz-exp">
            <label htmlFor={`cc-exp${i + 1}`} className="sr-only">
              {label} Experience
            </label>
            <input
              id={`cc-exp${i + 1}`}
              className="wz-in"
              type="text"
              maxLength={80}
              placeholder={`${label} Experience`}
              value={state.experiences[i]}
              onChange={(e) => update({ experiences: i === 0 ? [e.target.value, b] : [a, e.target.value] })}
            />
            <span className="wz-plus" aria-label="Modifier +2">
              {formatModifier(2)}
            </span>
          </div>
        ))}
      </div>
      <div className="wz-examples">
        <span className="wz-lbl">Examples · click to use, click again to remove</span>
        {EXPERIENCE_SUGGESTIONS.map((group) => (
          <div key={group.category} className="flex flex-col gap-1.5">
            <strong className="text-[15px]">{group.category}:</strong>
            <div className="flex flex-wrap gap-1.5">
              {group.examples.map((x) => (
                <button
                  key={x}
                  type="button"
                  className="wz-ex"
                  aria-pressed={chosen.includes(x)}
                  onClick={() => update({ experiences: toggleExperience(state.experiences, x) })}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Step 8

export function DomainCardsStep({ state, update, opts }: StepProps) {
  const cls = state.classId ? getClass(state.classId) : undefined;
  const domains = (cls?.domains ?? []).map((d) => getDomain(d)?.name ?? d).join(" & ");
  const picks = state.domainCards;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <p className="wz-lead">
          Choose <strong>two level 1 cards</strong> from your class’s domains ({domains}): one from each, or both from one.
        </p>
        <strong className="font-display text-[#3d5e2e]" aria-live="polite">
          {picks.length} / 2 chosen
        </strong>
      </div>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Domain cards</legend>
        <div className="wz-cards">
          {domainCardOptions(state.classId, opts).map((card) => {
            const on = picks.includes(card.id);
            const full = !on && picks.length >= 2;
            const art = DOMAIN_CARD_ART[card.id];
            const artUrl = art ? designAsset(art) : undefined;
            const domain = getDomain(card.domain);
            return (
              <article key={card.id} className={cn("wz-dk", full && "full")} style={{ "--dc": domain?.color ?? "#5b2b2b" } as React.CSSProperties}>
                <header className="wz-dk-head">
                  <h3 className="wz-dk-name m-0">{card.name}</h3>
                  <span className="wz-dk-lvl" aria-label="Level 1">
                    1
                  </span>
                </header>
                {artUrl ? <div className="wz-dk-art" aria-hidden="true" style={{ backgroundImage: `url(${artUrl})` }} /> : null}
                <div className="wz-dk-meta">
                  {domain?.name} · {cap(card.type)} · Recall {card.recallCost}
                </div>
                <p className="wz-dk-text">{card.text}</p>
                <footer className="wz-dk-foot">
                  <Choice
                    type="checkbox"
                    name="domain-cards"
                    checked={on}
                    disabled={full}
                    onSelect={() => update({ domainCards: toggleCard(picks, card.id) })}
                    className="wz-dk-btn"
                    label={`Choose ${card.name}`}
                  >
                    {on ? "Chosen ✓" : "Choose"}
                  </Choice>
                </footer>
              </article>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
