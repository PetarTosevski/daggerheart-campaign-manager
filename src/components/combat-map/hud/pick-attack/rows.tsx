"use client";

import { useId } from "react";

import { experienceValue } from "@/lib/domain/dice";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";
import { TRAIT_IDS, type TraitId } from "@/lib/srd/types";
import { cn } from "@/lib/utils";

import { damageLabel } from "../../actions/attack";
import { extraCandidates, extraMax, pickOf, riderKey, type RiderOption, type RiderPick } from "../../actions/attack/riders";
import { edgeLabel, ROLL_DICE_LIMIT, signed } from "../../actions/roll-controls";
import { useActor } from "../../actions/targets";
import type { CombatPageState } from "../../slots";
import type { PickContext } from "../pick";
import { ChoiceRow, CostPill, Stepper, Toggle } from "../ui";
import { attackPatch, benefitOptions, chosenBenefit, costOf, ridersOf, switchWeapon, weaponLine, weaponOf, type AttackData, type AttackInput } from "./model";

/**
 * The weapon attack's own rows in the picking panel (plan combat-hud H3.2), between the targets and the footer:
 * - the weapon tiles (CmpPicking 'Weapon attack' `.wpn`): name, trait, range, damage at Proficiency;
 * - the trait pick when the sheet offers one (dcm-5dg: Versatile Fighter, a "choice" weapon);
 * - "Use as Spirit Weapon" when offered (CB p.44);
 * - Lead by Example (CmpPromptsPlayer 'Lead by Example', CB p.342): the benefit picked before the roll;
 * - the roll chips (`.chips`): Experiences with their Hope pill, advantage and Help dice;
 * - "With this attack" (CmpPromptsPlayer): the riders as switches with cost pills, and what a switched-on rider asks.
 * Every change goes through `update(attackPatch(input, next))`, so the primary, footer and rule follow the data.
 */

export function AttackRows({ ctx, input, state }: { ctx: PickContext<AttackData>; input: AttackInput; state: CombatPageState }) {
  const { data, selection, update } = ctx;
  const actor = useActor(state);
  const weaponGroup = useId();
  const chipGroup = useId();
  const riderGroup = useId();
  const traitId = useId();
  const set = (next: AttackData) => update(attackPatch(input, next));
  const chosen = weaponOf(input, data.slot);
  const slot = chosen?.slot ?? data.slot;
  const riders = ridersOf(input, slot);
  const benefits = benefitOptions(input.hints, selection.targetIds);
  const benefit = chosenBenefit(benefits, data.benefit);
  const { experienceIds, edge, help } = data.roll;
  const enemies = (actor?.enemies ?? []).filter((e) => !selection.targetIds.includes(e._id));
  const allies = (actor?.view.others ?? []).filter((t) => t.side === "pc");

  return (
    <div className="hud-atk" data-testid="hud-attack-rows">
      {input.weapons.length > 0 ? (
        <div className="hud-atk-wpn" role="group" aria-labelledby={weaponGroup}>
          <span id={weaponGroup} className="hud-atk-l">
            Weapon
          </span>
          {input.weapons.map(({ slot: s, weapon }) => (
            <button key={s} type="button" aria-pressed={s === slot} data-testid="hud-attack-weapon" onClick={() => (s === slot ? undefined : set(switchWeapon(input, data, s)))}>
              <b>{weapon.name}</b>
              {weaponLine(weapon.trait === "choice" ? "Your choice" : TRAIT_LABEL[weapon.trait], weapon.range, damageLabel(weapon, input.proficiency))}
            </button>
          ))}
        </div>
      ) : null}

      {input.traitPick[slot] ? (
        <label className="hud-atk-trait" htmlFor={traitId}>
          <span className="hud-atk-l">Roll with</span>
          <select id={traitId} value={data.trait ?? input.traitDefault[slot] ?? "strength"} onChange={(e) => set({ ...data, trait: e.target.value as TraitId })} data-testid="hud-attack-trait">
            {TRAIT_IDS.map((t) => (
              <option key={t} value={t}>
                {TRAIT_LABEL[t]} {signed(input.traitValues[t] ?? 0)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {input.spirit[slot] ? (
        <Toggle
          checked={data.spirit}
          onChange={(on) => set({ ...data, spirit: on })}
          label="Use as Spirit Weapon"
          note="Reach Close; mark a Stress for one more target"
          end={<CostPill amount={1} resource="stress" />}
        />
      ) : null}

      {benefits.length > 0 ? (
        <section className="hud-atk-sec" aria-label="Before you roll" data-testid="hud-attack-benefit">
          <span className="hud-atk-l">
            {[...new Set(benefits.map((b) => b.from))].join(", ")} · before you roll
          </span>
          <div role="radiogroup" aria-label={[...new Set(benefits.map((b) => b.from))].join(", ")}>
            {benefits.map((b) => (
              <ChoiceRow key={`${b.from}:${b.id}`} type="radio" checked={benefit === b.id} onSelect={() => set({ ...data, benefit: b.id })} label={b.label} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="hud-atk-chips" role="group" aria-labelledby={chipGroup} data-testid="hud-attack-chips">
        <span id={chipGroup} className="hud-atk-l">
          Roll
        </span>
        {input.roller.experiences.map((e) => {
          const on = experienceIds.includes(e.id);
          return (
            <button
              key={e.id}
              type="button"
              className="hud-atk-chip"
              aria-pressed={on}
              onClick={() => set({ ...data, roll: { ...data.roll, experienceIds: on ? experienceIds.filter((x) => x !== e.id) : [...experienceIds, e.id] } })}
            >
              {e.name} {signed(experienceValue(e))}
              <CostPill amount={1} resource="hope" />
            </button>
          );
        })}
        <span className="hud-atk-step">
          <Stepper label="Advantage" value={edge} min={-ROLL_DICE_LIMIT} max={ROLL_DICE_LIMIT} onStep={(d) => set({ ...data, roll: { ...data.roll, edge: edge + d } })} />
          <small>{edgeLabel(edge)}</small>
        </span>
        <span className="hud-atk-step">
          <Stepper label="Help dice" value={help} min={0} max={ROLL_DICE_LIMIT} onStep={(d) => set({ ...data, roll: { ...data.roll, help: help + d } })} />
          <small>{help === 1 ? "Help die (d6)" : "Help dice (d6)"}</small>
        </span>
      </div>

      {riders.length > 0 ? (
        <section className="hud-atk-sec" aria-labelledby={riderGroup} data-testid="hud-attack-riders">
          <span id={riderGroup} className="hud-atk-l">
            With this attack
          </span>
          {riders.map((o) => (
            <Rider
              key={riderKey(o)}
              option={o}
              pick={pickOf(data.riders, o)}
              chips={extraCandidates(o, enemies, allies)}
              noEnemy={enemies.length === 0}
              onChange={(patch) => set({ ...data, riders: { ...data.riders, [riderKey(o)]: { ...pickOf(data.riders, o), ...patch } } })}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** One rider: a switch with its cost pills, and what it asks once on (numbers, an option, situations, more targets). */
function Rider({
  option: o,
  pick,
  chips,
  noEnemy,
  onChange,
}: {
  option: RiderOption;
  pick: RiderPick;
  chips: readonly { _id: string; name: string; ally?: boolean }[];
  noEnemy: boolean;
  onChange: (patch: Partial<RiderPick>) => void;
}) {
  const on = pick.on && o.ready;
  const pills = o.costs.map((c) => ({ text: c, pill: costOf(c) }));
  const note = o.ready ? [o.when, ...(o.limit ? [o.limit] : []), ...(o.defaultOn ? ["On while it applies; switch off to roll the usual d12"] : [])].join(" · ") : `Used · ${o.resetLabel ?? "comes back later"}`;
  return (
    <div className={cn("hud-atk-rider", on && "hud-atk-rider-on")} data-testid="hud-attack-rider">
      <Toggle
        checked={on}
        disabled={!o.ready}
        onChange={(next) => onChange({ on: next })}
        label={o.name}
        note={note}
        end={
          pills.length > 0 ? (
            <span className="hud-atk-pills">
              {pills.map(({ text, pill }) => (pill ? <CostPill key={text} amount={pill.amount} resource={pill.resource} /> : <small key={text}>{text}</small>))}
            </span>
          ) : undefined
        }
      />
      {on ? (
        <div className="hud-atk-ask">
          {o.numbers.map((n) => {
            const value = pick.numbers[n.id] ?? n.min;
            return (
              <span key={n.id} className="hud-atk-step">
                <Stepper label={n.label} value={value} min={n.min} max={n.max ?? 12} onStep={(d) => onChange({ numbers: { ...pick.numbers, [n.id]: value + d } })} />
                <small>{n.label}</small>
              </span>
            );
          })}
          {o.options.map((opt) => (
            <div key={opt.id} role="radiogroup" aria-label={`${o.name}: ${opt.label}`}>
              <span className="hud-atk-l">{opt.label}</span>
              {opt.options.map((x) => (
                <ChoiceRow key={x.id} type="radio" checked={pick.options[opt.id] === x.id} onSelect={() => onChange({ options: { ...pick.options, [opt.id]: x.id } })} label={x.label} />
              ))}
            </div>
          ))}
          {o.situations.map((text) => {
            const ticked = pick.situations.includes(text);
            return (
              <ChoiceRow
                key={text}
                type="checkbox"
                checked={ticked}
                onSelect={() => onChange({ situations: ticked ? pick.situations.filter((s) => s !== text) : [...pick.situations, text] })}
                label={text}
              />
            );
          })}
          {o.addTargets !== null ? (
            <div className="hud-atk-chips" role="group" aria-label={`${o.name}: more targets`}>
              <span className="hud-atk-l">
                More targets (up to {extraMax(o, pick)}, {o.addTargets.range === "weapon" ? "within your weapon’s range" : `within ${o.addTargets.range}`})
              </span>
              {chips.length === 0 ? <small>{noEnemy ? "No other enemy in sight." : "No other creature in sight."}</small> : null}
              {chips.map((c) => {
                const picked = pick.extra.includes(c._id);
                const full = !picked && pick.extra.length >= extraMax(o, pick);
                return (
                  <button
                    key={c._id}
                    type="button"
                    className="hud-atk-chip"
                    aria-pressed={picked}
                    disabled={full}
                    onClick={() => onChange({ extra: picked ? pick.extra.filter((x) => x !== c._id) : [...pick.extra, c._id] })}
                  >
                    {c.name}
                    {c.ally ? " (ally)" : ""}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
