"use client";

import { useState } from "react";

import { Pip } from "@/components/party/sheet-ui";
import {
  REWARD_GROUP_LABEL,
  RELIC_VALUE,
  SCRAP_CATEGORIES,
  SCRAP_REWARD_TABLE,
  SCRAP_TABLES,
  type FightDifficulty,
  type RewardGroup,
} from "@/lib/domain/frames/motherboard";
import { TRAIT_LABEL, traitIdSchema } from "@/lib/frames/extras/common";
import {
  augmentDefense,
  AUGMENTS,
  augmentSlots,
  getAugment,
  IKONIS_RANGES,
  ikonisDamage,
  type Ikonis,
  type MotherboardState,
} from "@/lib/frames/extras/motherboard";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ALT_BTN, BTN, ErrorLine, ExtraBox, Field, INPUT, LABEL, NOTE, Notice, PlaqueBox, TEXTAREA } from "./ui";

type Props = { characterId: Id<"characters">; state: MotherboardState; level: number; tier: number; canEdit: boolean };

const DIFFICULTY_LABEL: Record<FightDifficulty, string> = { easy: "Easy", standard: "Standard", difficult: "Difficult", veryDifficult: "Very difficult" };

/** Motherboard module (Core pp.301–303): Ikonis, augments, quantum and scrap. */
export function MotherboardPanel(props: Props) {
  return (
    <ExtraBox frame="Motherboard" title="Ikonis Module" subtitle="Your Ikonis, its augments, and the scrap and quantum that build them.">
      <IkonisCard key={JSON.stringify(props.state.ikonis)} {...props} />
      <WalletCard {...props} />
      <AugmentsCard {...props} />
    </ExtraBox>
  );
}

/** Installed augments are features of the Ikonis (CB 301); Guard, Deny and Block change Armor Score and Evasion. */
function InstalledLine({ installed }: { installed: readonly string[] }) {
  const names = installed.map((id) => getAugment(id)?.name ?? id);
  const defense = augmentDefense(installed);
  const parts = [defense.armorScore ? `+${defense.armorScore} Armor Score` : "", defense.evasion ? `${defense.evasion} Evasion` : ""].filter(Boolean);
  return (
    <p data-testid="ikonis-augments" className={NOTE}>
      {names.length > 0 ? `Installed augments: ${names.join(", ")}` : "No augments installed."}
      {parts.length > 0 ? ` (${parts.join(", ")})` : ""}
    </p>
  );
}

function IkonisCard({ characterId, state, level, canEdit }: Props) {
  const save = useIntent(api.characterExtras.saveIkonis);
  const [draft, setDraft] = useState<Ikonis>(state.ikonis);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.ikonis);
  const damage = ikonisDamage(state.ikonis, level);
  const ro = !canEdit;
  return (
    <PlaqueBox title={state.ikonis.name || "Ikonis"}>
      <p className={NOTE}>Two-handed. Bonded: gain a bonus to your damage rolls equal to your level.</p>
      {damage ? (
        <p data-testid="ikonis-damage" className="xs-strong m-0">
          {state.ikonis.trait ? `${TRAIT_LABEL[state.ikonis.trait]} · ` : ""}
          {state.ikonis.range} · {damage}
        </p>
      ) : null}
      <InstalledLine installed={state.installed} />
      <div className="xs-grid2">
        <Field label="Name">
          <input className={INPUT} disabled={ro} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Trait">
          <select className={INPUT} disabled={ro} value={draft.trait ?? ""} onChange={(e) => setDraft({ ...draft, trait: e.target.value ? traitIdSchema.parse(e.target.value) : null })}>
            <option value="">Choose…</option>
            {traitIdSchema.options.map((t) => (
              <option key={t} value={t}>
                {TRAIT_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Range and damage">
          <select
            className={INPUT}
            disabled={ro}
            value={draft.range ?? ""}
            onChange={(e) => setDraft({ ...draft, range: (IKONIS_RANGES.find((r) => r.range === e.target.value)?.range ?? null) })}
          >
            <option value="">Choose…</option>
            {IKONIS_RANGES.map((r) => (
              <option key={r.range} value={r.range}>
                {r.range} – {r.damage}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Damage type">
          <select className={INPUT} disabled={ro} value={draft.damageType ?? ""} onChange={(e) => setDraft({ ...draft, damageType: (e.target.value || null) as Ikonis["damageType"] })}>
            <option value="">Choose…</option>
            <option value="physical">Physical</option>
            <option value="tech">Tech</option>
          </select>
        </Field>
      </div>
      <Field label="Description">
        <textarea className={TEXTAREA} disabled={ro} maxLength={2000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </Field>
      {canEdit ? (
        <button type="button" className={`${BTN} self-start`} disabled={!dirty || save.pending} onClick={() => void save.fire({ characterId, ikonis: draft })}>
          Save Ikonis
        </button>
      ) : null}
      <ErrorLine error={save.error} />
    </PlaqueBox>
  );
}

function WalletCard({ characterId, state, canEdit }: Props) {
  const gather = useIntent(api.characterExtras.gatherScrap);
  const trade = useIntent(api.characterExtras.tradeScrap);
  const addRelic = useIntent(api.characterExtras.addRelic);
  const sellRelic = useIntent(api.characterExtras.sellRelic);
  const correct = useIntent(api.characterExtras.correctWallet);
  const [dice, setDice] = useState({ shards: 0, metals: 0, components: 0 });
  const [qty, setQty] = useState(1);
  const [relicName, setRelicName] = useState("");
  const [quantum, setQuantum] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const error = gather.error ?? trade.error ?? addRelic.error ?? sellRelic.error ?? correct.error;

  const preset = (value: string) => {
    const [group, difficulty] = value.split(":") as [RewardGroup, FightDifficulty];
    if (group && difficulty) setDice({ ...SCRAP_REWARD_TABLE[group][difficulty] });
  };

  return (
    <PlaqueBox title="Scrap & Quantum">
      <p className={NOTE}>Each piece of scrap is worth its value, buying or selling. 10 quantum = 1 handful of gold.</p>
      <div className="xs-row">
        <div className="flex flex-col">
          <span className={LABEL}>Quantum</span>
          <span data-testid="quantum" className="xs-big">
            {state.quantum}
          </span>
        </div>
        {canEdit ? (
          <>
            <input className={`${INPUT} xs-narrow`} type="number" min={0} aria-label="Correct quantum" placeholder="Set…" value={quantum} onChange={(e) => setQuantum(e.target.value)} />
            <button
              type="button"
              className={ALT_BTN}
              disabled={quantum === "" || correct.pending}
              onClick={async () => {
                await correct.fire({ characterId, correction: { quantum: Number(quantum) } });
                setQuantum("");
              }}
            >
              Correct
            </button>
            <Field label="Trade quantity" className="ml-auto">
              <input className={`${INPUT} xs-narrow`} type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          </>
        ) : null}
      </div>

      <div className="xs-grid3">
        {SCRAP_CATEGORIES.map((c) => (
          <div key={c} className="flex min-w-0 flex-col">
            <span className={LABEL}>
              {SCRAP_TABLES[c].label} (d{SCRAP_TABLES[c].die})
            </span>
            {SCRAP_TABLES[c].items.map((item) => {
              const n = state.scrap[item.name] ?? 0;
              return (
                <div key={item.name} className="xs-item">
                  <span className="xs-meta w-5 text-right">{item.value}</span>
                  <span className="xs-grow">{item.name}</span>
                  <span data-testid={`scrap-${item.name}`} className={cn("xs-num", n === 0 && "zero")}>
                    {n}
                  </span>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        className={BTN}
                        aria-label={`Buy ${qty} ${item.name}`}
                        disabled={trade.pending || state.quantum < item.value * qty}
                        onClick={() => void trade.fire({ characterId, name: item.name, quantity: qty, direction: "buy" })}
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        className={ALT_BTN}
                        aria-label={`Sell ${qty} ${item.name}`}
                        disabled={trade.pending || n < qty}
                        onClick={() => void trade.fire({ characterId, name: item.name, quantity: qty, direction: "sell" })}
                      >
                        Sell
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className={LABEL}>Relics ({RELIC_VALUE} quantum each)</span>
        {state.relics.length === 0 ? <p className={NOTE}>No relics.</p> : null}
        {state.relics.map((r) => (
          <div key={r.id} className="xs-item">
            <span className="xs-grow">{r.name}</span>
            {canEdit ? (
              <button type="button" className={ALT_BTN} disabled={sellRelic.pending} onClick={() => void sellRelic.fire({ characterId, relicId: r.id })}>
                Sell
              </button>
            ) : null}
          </div>
        ))}
        {canEdit ? (
          <div className="xs-row">
            <input className={`${INPUT} xs-grow`} aria-label="Relic name" placeholder="Steelhorn of the stag…" maxLength={80} value={relicName} onChange={(e) => setRelicName(e.target.value)} />
            <button
              type="button"
              className={BTN}
              disabled={!relicName.trim() || addRelic.pending}
              onClick={async () => {
                await addRelic.fire({ characterId, name: relicName });
                setRelicName("");
              }}
            >
              Add relic
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={LABEL}>Gather scrap</legend>
          <select className={INPUT} aria-label="Scrap reward preset" defaultValue="" onChange={(e) => preset(e.target.value)}>
            <option value="">Preset from the Scrap Reward Table…</option>
            {(Object.keys(SCRAP_REWARD_TABLE) as RewardGroup[]).map((g) =>
              (Object.keys(SCRAP_REWARD_TABLE[g]) as FightDifficulty[]).map((d) => (
                <option key={`${g}:${d}`} value={`${g}:${d}`}>
                  {REWARD_GROUP_LABEL[g]}, {DIFFICULTY_LABEL[d]} fight
                </option>
              )),
            )}
          </select>
          <div className="xs-row">
            {SCRAP_CATEGORIES.map((c) => (
              <Field key={c} label={`${SCRAP_TABLES[c].label} d${SCRAP_TABLES[c].die}`}>
                <input
                  className={`${INPUT} xs-narrow`}
                  type="number"
                  min={0}
                  max={10}
                  value={dice[c]}
                  onChange={(e) => setDice({ ...dice, [c]: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                />
              </Field>
            ))}
            <button
              type="button"
              className={BTN}
              disabled={gather.pending || dice.shards + dice.metals + dice.components === 0}
              onClick={async () => {
                const got = await gather.fire({ characterId, ...dice });
                if (got) setNotice(`Rolled ${got.map((g) => `${g.roll} → ${g.item.name}`).join(", ")}.`);
              }}
            >
              Roll scrap
            </button>
          </div>
        </fieldset>
      ) : null}
      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorLine error={error} />
    </PlaqueBox>
  );
}

function AugmentsCard({ characterId, state, tier, canEdit }: Props) {
  const craft = useIntent(api.characterExtras.craftAugment);
  const salvage = useIntent(api.characterExtras.salvageAugment);
  const install = useIntent(api.characterExtras.installAugments);
  const slots = augmentSlots(tier);
  const built = new Set(state.built.map((b) => b.id));
  const error = craft.error ?? salvage.error ?? install.error;

  const affordable = (recipe: Record<string, number>) =>
    Object.entries(recipe).every(([name, n]) => (name === "Relic" ? state.relics.length : (state.scrap[name] ?? 0)) >= n);

  return (
    <PlaqueBox title="Augments">
      <div className="xs-kv">
        <span className={LABEL}>
          Installed {state.installed.length} / {slots}
        </span>
        <span role="img" aria-label={`Augment slots: ${state.installed.length} of ${slots} used`} className="xs-pips">
          {Array.from({ length: slots }, (_, k) => (
            <Pip key={k} kind="armor" on={k < state.installed.length} />
          ))}
        </span>
      </div>
      <p className={NOTE}>Two slots at Tier 1, one more each tier. Craft, install and salvage during downtime.</p>
      <ul className="xs-list">
        {AUGMENTS.map((aug) => {
          const isBuilt = built.has(aug.id);
          const installed = state.installed.includes(aug.id);
          const locked = tier < aug.precompileTier;
          return (
            <li key={aug.id} className={cn("xs-item col", installed && "on", locked && "locked")}>
              <div className="xs-item-head">
                <strong className="xs-name">{aug.name}</strong>
                <span className="xs-grow">{aug.text}</span>
                {aug.precompileTier > 1 ? <span className="xs-meta">Precompile: Tier {aug.precompileTier}</span> : null}
              </div>
              <span className="xs-meta">
                {Object.entries(aug.recipe)
                  .map(([name, n]) => `${n} ${name}`)
                  .join(", ")}
              </span>
              {canEdit ? (
                <div className="xs-actions">
                  {isBuilt ? (
                    <>
                      <button
                        type="button"
                        className={BTN}
                        aria-pressed={installed}
                        disabled={install.pending || (!installed && state.installed.length >= slots)}
                        onClick={() =>
                          void install.fire({
                            characterId,
                            augmentIds: installed ? state.installed.filter((id) => id !== aug.id) : [...state.installed, aug.id],
                          })
                        }
                      >
                        {installed ? "Uninstall" : "Install"}
                      </button>
                      <button type="button" className={ALT_BTN} disabled={salvage.pending} onClick={() => void salvage.fire({ characterId, augmentId: aug.id })}>
                        Salvage
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={BTN}
                      disabled={locked || craft.pending || !affordable(aug.recipe)}
                      onClick={() => void craft.fire({ characterId, augmentId: aug.id })}
                    >
                      Craft
                    </button>
                  )}
                </div>
              ) : isBuilt ? (
                <span className="xs-meta">{installed ? "Installed" : "Built"}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ErrorLine error={error} />
    </PlaqueBox>
  );
}
