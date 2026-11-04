"use client";

import { useId, type ReactNode } from "react";

import type { CardUse } from "@/lib/domain/card-effects/types";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";

import { asksTriggerDamageType, distinctFromOf, listedValues, swapsWithVault } from "../../actions/hand/dialog";
import { fitsSide, type FormValues, type RecipientKey, type UseForm } from "../../actions/hand/model";
import { rollSummary } from "../../actions/roll-controls";
import type { PickSelection } from "../pick";
import { ChoiceRow, Stepper } from "../ui";
import { startData, type CardPickData, type Rider } from "./model";
import type { CardPickEnv } from "./session";

/**
 * The card's own rows in the picking panel (plan combat-hud H3.1; the panel's `extra`, between the targets and the
 * riders): every choice the classic Use dialog asks (actions/hand/dialog.tsx `UseForm`), as HUD rows: the grimoire's
 * spell, a number (a number of Hope), "Pay with", a situation to confirm, a choice before the roll, the creatures an
 * add-on or step names, the weapon, the trait, the vault card to swap in (dcm-p1r), the ally's damage type (Encore),
 * the GM's Difficulty, and the Hand's roll options it rolls with. Pure render: every answer goes back through `onData`
 * (the session's `update`), never into local state.
 */

const sideWord = (side: string) => (side === "enemy" ? "enemies" : side === "ally" ? "allies" : side === "selfOrAlly" ? "you or allies" : "creatures");

function Group({ label, radio = false, children, testId }: { label: string; radio?: boolean; children: ReactNode; testId?: string }) {
  const id = useId();
  return (
    <div className="hud-cr-g" role={radio ? "radiogroup" : "group"} aria-labelledby={id} data-testid={testId}>
      <p id={id} className="hud-cr-l">
        {label}
      </p>
      {children}
    </div>
  );
}

/** Whether the use asks anything the rows show (otherwise the panel gets no extra rows). */
export function hasCardRows(env: Pick<CardPickEnv, "uses" | "block">, use: CardUse, form: UseForm): boolean {
  return (
    env.uses.length > 1 ||
    form.numbers.length + form.eithers.length + form.situations.length + form.choose.length + form.recipients.length > 0 ||
    form.weapon ||
    form.traits !== null ||
    form.gmDifficulty ||
    swapsWithVault(use) ||
    asksTriggerDamageType(use) ||
    (form.rolls && rollSummary(env.block.rollOptions) !== null)
  );
}

export function CardRows({
  env,
  use,
  form,
  riders,
  data,
  selection,
  onData,
}: {
  env: CardPickEnv;
  use: CardUse;
  form: UseForm;
  riders: readonly Rider[];
  data: CardPickData;
  selection: PickSelection;
  onData: (next: CardPickData) => void;
}) {
  const values = data.values;
  const set = (patch: Partial<FormValues>) => onData({ ...data, values: { ...values, ...patch } });
  const name = (tokenId: string) => {
    const c = env.creatures.find((x) => x.tokenId === tokenId);
    return c ? (c.side === "self" ? "You" : c.name) : "Someone";
  };
  // An add-on's own pick ("Restrain: who") shows while the add-on is on.
  const riderFor = (key: RecipientKey) => (key === "picked" ? riders.find((r) => r.picks) : undefined);
  const rollNote = form.rolls ? rollSummary(env.block.rollOptions) : null;

  return (
    <div className="hud-cr" data-testid="hud-card-rows">
      {env.uses.length > 1 ? (
        <Group label="Spell" radio testId="hud-card-spell">
          {env.uses.map((u) => (
            <ChoiceRow
              key={u.useId}
              type="radio"
              checked={u.useId === data.useId}
              disabled={!u.ready}
              label={u.name}
              note={u.ready ? (u.usesLeft !== null ? `${u.usesLeft} left` : undefined) : `Used · ${u.resetLabel ?? "Back after a rest"}`}
              onSelect={() => {
                const next = env.effectUses.find((e) => e.id === u.useId);
                if (next && u.useId !== data.useId) onData(startData(next));
              }}
            />
          ))}
        </Group>
      ) : null}

      {form.numbers.map((n) => {
        // E3 (dcm-uyc, Teleport): a number with listed values is picked from them.
        const listed = listedValues(use, n.id);
        const value = values.numbers[n.id] ?? listed?.[0] ?? n.min;
        return listed ? (
          <Group key={n.id} label={n.label} radio>
            {listed.map((v) => (
              <ChoiceRow key={v} type="radio" checked={value === v} label={v > 0 ? `+${v}` : String(v)} onSelect={() => set({ numbers: { ...values.numbers, [n.id]: v } })} />
            ))}
          </Group>
        ) : (
          <div key={n.id} className="hud-cr-g hud-cr-num">
            <span className="hud-cr-l">{n.label}</span>
            <Stepper
              label={n.label}
              value={value}
              min={n.min}
              max={n.max ?? Math.max(n.min, 99)}
              onStep={(d) => set({ numbers: { ...values.numbers, [n.id]: value + d } })}
            />
          </div>
        );
      })}

      {form.eithers.map((e) => (
        <Group key={e.index} label="Pay with" radio>
          {e.options.map((label, i) => (
            <ChoiceRow key={label} type="radio" checked={(values.eithers[e.index] ?? 0) === i} label={label} onSelect={() => set({ eithers: { ...values.eithers, [e.index]: i } })} />
          ))}
        </Group>
      ))}

      {form.situations.length > 0 ? (
        <Group label="Confirm">
          {form.situations.map((s) => {
            const on = values.situations.includes(s);
            return <ChoiceRow key={s} type="checkbox" checked={on} label={s} onSelect={() => set({ situations: on ? values.situations.filter((x) => x !== s) : [...values.situations, s] })} />;
          })}
        </Group>
      ) : null}

      {form.choose.map((c) => {
        const picked = values.options[c.stepId] ?? [];
        // E3 (dcm-40m, Twin Fang): an option picked in the step this one must differ from is not offered.
        const other = distinctFromOf(use, c.stepId);
        return (
          <Group key={c.stepId} label={c.label} radio={c.count === 1}>
            {c.options.map((o) => {
              if (other && (values.options[other] ?? []).includes(o.id) && !picked.includes(o.id)) return null;
              const on = picked.includes(o.id);
              return (
                <ChoiceRow
                  key={o.id}
                  type={c.count === 1 ? "radio" : "checkbox"}
                  checked={on}
                  label={o.label}
                  onSelect={() => set({ options: { ...values.options, [c.stepId]: c.count === 1 ? [o.id] : on ? picked.filter((x) => x !== o.id) : [...picked, o.id] } })}
                />
              );
            })}
          </Group>
        );
      })}

      {form.recipients.map((r) => {
        const rider = riderFor(r.key);
        if (rider && !selection.options[rider.id]) return null;
        const picked = values.recipients[r.key] ?? [];
        const fits = env.creatures.filter((c) => fitsSide(c, r.side));
        const single = rider !== undefined;
        return (
          <Group key={r.key} label={rider ? `${rider.picks}: pick who` : `${r.label} · ${sideWord(r.side)}`} radio={single} testId={`hud-card-who-${r.key}`}>
            {fits.length === 0 ? (
              <p className="hud-cr-note">No one on the map fits.</p>
            ) : (
              fits.map((c) => {
                const on = picked.includes(c.tokenId);
                return (
                  <ChoiceRow
                    key={c.tokenId}
                    type={single ? "radio" : "checkbox"}
                    checked={on}
                    label={name(c.tokenId)}
                    onSelect={() =>
                      set({ recipients: { ...values.recipients, [r.key]: single ? (on ? [] : [c.tokenId]) : on ? picked.filter((id) => id !== c.tokenId) : [...picked, c.tokenId] } })
                    }
                  />
                );
              })
            )}
          </Group>
        );
      })}

      {form.weapon ? (
        <Group label="Weapon" radio>
          {(["primary", "secondary"] as const).map((w) => (
            <ChoiceRow key={w} type="radio" checked={values.weapon === w} label={w === "primary" ? "Primary weapon" : "Secondary weapon"} onSelect={() => set({ weapon: w })} />
          ))}
        </Group>
      ) : null}

      {form.traits ? (
        <Group label="Trait" radio>
          {form.traits.map((tr) => (
            <ChoiceRow key={tr} type="radio" checked={values.trait === tr} label={TRAIT_LABEL[tr]} onSelect={() => set({ trait: tr })} />
          ))}
        </Group>
      ) : null}

      {swapsWithVault(use) ? (
        // dcm-p1r (UI half): the vault card a Codex-Touched swap brings in, at or under the character's level (CB p.333).
        env.block.vault.length > 0 ? (
          <Group label="Swap in from the vault" radio testId="hud-card-swap">
            {env.block.vault.map((c) => (
              <ChoiceRow key={c.cardId} type="radio" checked={data.swapWith === c.cardId} label={c.name} note={`Level ${c.level}`} onSelect={() => onData({ ...data, swapWith: c.cardId })} />
            ))}
          </Group>
        ) : (
          <p className="hud-cr-note">No vault card at or under your level to swap in.</p>
        )
      ) : null}

      {asksTriggerDamageType(use) ? (
        <Group label="Your ally’s damage was" radio>
          {(["physical", "magic"] as const).map((t) => (
            <ChoiceRow key={t} type="radio" checked={data.triggerType === t} label={t === "physical" ? "Physical" : "Magic"} onSelect={() => onData({ ...data, triggerType: t })} />
          ))}
        </Group>
      ) : null}

      {form.gmDifficulty ? (
        env.block.gm ? (
          <div className="hud-cr-g hud-cr-num">
            <span className="hud-cr-l">Difficulty (the card names none)</span>
            <Stepper
              label="Difficulty"
              value={values.difficulty ?? 10}
              min={1}
              max={30}
              onStep={(d) => set({ difficulty: (values.difficulty ?? 10) + d })}
            />
          </div>
        ) : (
          <p className="hud-cr-note">The card names no Difficulty: the GM decides how the roll lands.</p>
        )
      ) : null}

      {rollNote ? (
        <p className="hud-cr-note" data-testid="hud-card-roll-note">
          Rolls with {rollNote}
        </p>
      ) : null}
    </div>
  );
}
