"use client";

import { useState, type ReactNode } from "react";

import { SheetDiceBox } from "@/components/party/dice";
import { FeaturesPanel } from "@/components/party/features";
import { RestPicker } from "@/components/party/rest";
import { WitherCounter } from "@/components/party/wither";
import { derivedDefense } from "@/lib/domain/characters/derived";
import { withEffects } from "@/lib/domain/characters/effects";
import { BASE_HOPE_MAX, damageThresholds, hopeMax, tierForLevel } from "@/lib/domain/characters";
import { assetBackground } from "@/lib/design-assets";
import type { SheetPatch } from "@/lib/validation/characters";
import {
  ARMOR,
  getArmor,
  getCommunity,
  getSubclass,
  getWeapon,
  portraitFor,
  TRAIT_IDS,
  WEAPONS,
  type ClassDef,
  type TraitId,
  type Weapon,
} from "@/lib/srd";

import { DamageCalculator } from "./damage-calculator";
import { Stepper, TextField, Track } from "./fields";
import { useSheet, type CharacterStatus } from "./sheet-context";
import { ancestryArtId, ancestryLabel, signed, thresholdRanges, weaponDamage } from "./sheet-helpers";

const TRAITS: Record<TraitId, { label: string; verbs: string }> = {
  agility: { label: "Agility", verbs: "Sprint · Leap · Maneuver" },
  strength: { label: "Strength", verbs: "Lift · Smash · Grapple" },
  finesse: { label: "Finesse", verbs: "Control · Hide · Tinker" },
  instinct: { label: "Instinct", verbs: "Perceive · Sense · Navigate" },
  presence: { label: "Presence", verbs: "Charm · Perform · Deceive" },
  knowledge: { label: "Knowledge", verbs: "Recall · Analyze · Comprehend" },
};

const MAX_SLOTS = 12;

function Box({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`cs-box ${className}`} aria-label={title}>
      <h3 className="cs-h">{title}</h3>
      {children}
    </section>
  );
}

function FeatureText({ name, text }: { name: string; text: string }) {
  return (
    <p className="cs-small m-0 whitespace-pre-line">
      <strong className="font-display text-[14px]">{name}:</strong> {text}
    </p>
  );
}

export function TraitsGrid() {
  const { sheet, canEdit, update } = useSheet();
  const epoch = sheet.level >= 8 ? 3 : sheet.level >= 5 ? 2 : 1;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="list" aria-label="Traits">
      {TRAIT_IDS.map((t) => {
        const marked = (sheet.traitMarks[t] ?? 0) === epoch;
        return (
          <div key={t} role="listitem" className="cs-box items-center !gap-2 !p-3 text-center">
            <span className="cs-trait-head self-stretch">{TRAITS[t].label}</span>
            <span className="relative">
              <span className="cs-num cs-circle" aria-label={`${TRAITS[t].label} ${signed(sheet.traits[t])}`}>
                {signed(sheet.traits[t])}
              </span>
              {marked ? (
                <span
                  className="absolute -top-1 -right-2 size-5 rounded-full border-2 border-[#4d7a3a] bg-[#4d7a3a]"
                  role="img"
                  aria-label={`${TRAITS[t].label} marked this tier`}
                />
              ) : null}
            </span>
            {canEdit ? (
              <Stepper
                label={TRAITS[t].label}
                value={sheet.traits[t]}
                min={-5}
                max={10}
                display={<span className="sr-only">{signed(sheet.traits[t])}</span>}
                onChange={(v) => void update({ traits: { ...sheet.traits, [t]: v } })}
                readOnly={false}
              />
            ) : null}
            <span className="text-[14px] text-[#4a3a26] italic">{TRAITS[t].verbs}</span>
          </div>
        );
      })}
    </div>
  );
}

function Experiences() {
  const { sheet, canEdit, update } = useSheet();
  const [draft, setDraft] = useState("");
  const list = sheet.experiences;
  const save = (next: NonNullable<SheetPatch["experiences"]>) => void update({ experiences: next });
  return (
    <Box title="Experiences">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((x, i) => (
          <li key={`${i}-${x.name}`} className="flex flex-wrap items-center gap-2">
            <div className="min-w-[160px] flex-[1_1_100%]">
              <TextField
                label={`Experience ${i + 1}`}
                hideLabel
                value={x.name}
                maxLength={80}
                readOnly={!canEdit}
                onSave={(name) => name && save(list.map((e, j) => (j === i ? { ...e, name } : e)))}
              />
            </div>
            <Stepper
              label={`${x.name} bonus`}
              value={x.value}
              min={-5}
              max={10}
              display={signed(x.value)}
              readOnly={!canEdit}
              onChange={(value) => save(list.map((e, j) => (j === i ? { ...e, value } : e)))}
            />
            {canEdit ? (
              <button type="button" className="cs-step" aria-label={`Remove ${x.name}`} onClick={() => save(list.filter((_, j) => j !== i))}>
                ×
              </button>
            ) : null}
          </li>
        ))}
        {list.length === 0 ? <li className="cs-small italic">No Experiences yet.</li> : null}
      </ul>
      {canEdit && list.length < 12 ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.trim();
            if (!name) return;
            save([...list, { name, value: 2 }]);
            setDraft("");
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">New Experience</span>
            <input className="cs-in" placeholder="New Experience" maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <button type="submit" className="cs-pill">
            Add
          </button>
        </form>
      ) : null}
    </Box>
  );
}

function weaponOptions(slot: Weapon["slot"], level: number, classId: string, spellcaster: boolean, hopeAndFear: boolean, current?: string) {
  const tier = tierForLevel(level);
  return WEAPONS.filter(
    (w) =>
      w.id === current ||
      (w.slot === slot &&
        w.tier <= tier &&
        (hopeAndFear || w.source === "core") &&
        (!w.classId || w.classId === classId) &&
        (w.category !== "magic" || spellcaster)),
  );
}

function WeaponBlock({ label, weaponId, slot }: { label: string; weaponId?: string; slot: Weapon["slot"] }) {
  const { sheet, canEdit, update, hopeAndFear } = useSheet();
  const weapon = weaponId ? getWeapon(weaponId) : undefined;
  const spellcaster = Boolean(getSubclass(sheet.subclassId)?.spellcastTrait);
  const primary = getWeapon(sheet.primaryWeaponId);
  const blocked = slot === "secondary" && primary?.burden === "two-handed";
  const options = weaponOptions(slot, sheet.level, sheet.classId, spellcaster, hopeAndFear, weaponId);
  const traitText = weapon ? (weapon.trait === "choice" ? "Trait of your choice" : weapon.trait[0].toUpperCase() + weapon.trait.slice(1)) : "";
  return (
    <div className="flex flex-col gap-2 border-b border-dashed border-[#c9b083] pb-3 last:border-b-0">
      <h4 className="m-0 font-display text-[16px] font-bold text-[#3d5e2e]">{label}</h4>
      {canEdit && !(blocked && !weapon) ? (
        <label className="flex flex-col gap-1">
          <span className="cs-lbl">Name</span>
          <select
            className="cs-in"
            value={weaponId ?? ""}
            disabled={blocked && !weapon}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void update(slot === "primary" ? { primaryWeaponId: id } : { secondaryWeaponId: id });
            }}
          >
            {weaponId ? null : <option value="">— None —</option>}
            {options.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} (Tier {w.tier})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="cs-lbl">Name</span>
          <span className="cs-in cs-ro">{weapon?.name ?? (blocked ? "Both hands on the primary weapon" : "None")}</span>
        </div>
      )}
      {weapon ? (
        <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="cs-lbl">Trait &amp; range</dt>
            <dd className="cs-in cs-ro m-0">
              {traitText} · {weapon.range}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="cs-lbl">Damage dice</dt>
            <dd className="cs-in cs-ro m-0" data-testid={`${slot}-damage`}>
              {weaponDamage(weapon.damage, sheet.proficiency)}
            </dd>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <dt className="cs-lbl">Feature</dt>
            <dd className="cs-small m-0">
              {weapon.feature ? <FeatureText name={weapon.feature.name} text={weapon.feature.text} /> : "—"}
              <span className="block text-[14px] italic">{weapon.burden === "two-handed" ? "Two-handed" : weapon.burden === "barehanded" ? "Barehanded" : "One-handed"}</span>
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function ArmorBlock() {
  const { sheet, canEdit, update, hopeAndFear } = useSheet();
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const tier = tierForLevel(sheet.level);
  const options = ARMOR.filter((a) => a.id === sheet.armorId || (a.tier <= tier && (hopeAndFear || a.source === "core")));
  return (
    <Box title="Active Armor">
      {canEdit ? (
        <label className="flex flex-col gap-1">
          <span className="cs-lbl">Name</span>
          <select className="cs-in" value={sheet.armorId ?? ""} onChange={(e) => e.target.value && void update({ armorId: e.target.value })}>
            {sheet.armorId ? null : <option value="">Unarmored</option>}
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} (Tier {a.tier})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="cs-lbl">Name</span>
          <span className="cs-in cs-ro">{armor?.name ?? "Unarmored"}</span>
        </div>
      )}
      <dl className="m-0 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <dt className="cs-lbl">Base score</dt>
          <dd className="cs-in cs-ro m-0">{derivedDefense(sheet).armorScore}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="cs-lbl">Base thresholds</dt>
          <dd className="cs-in cs-ro m-0">{armor ? `${armor.baseThresholds.major} / ${armor.baseThresholds.severe}` : "—"}</dd>
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <dt className="cs-lbl">Feature</dt>
          <dd className="m-0">{armor?.feature ? <FeatureText name={armor.feature.name} text={armor.feature.text} /> : <span className="cs-small">—</span>}</dd>
        </div>
      </dl>
    </Box>
  );
}

function Wealth() {
  const { sheet, canEdit, update } = useSheet();
  const [item, setItem] = useState("");
  const g = sheet.gold;
  return (
    <Box title="Gold & Inventory">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="cs-lbl">Handfuls</span>
          <Stepper label="Handfuls of gold" value={g.handfuls} min={0} max={99} readOnly={!canEdit} onChange={(handfuls) => void update({ gold: { ...g, handfuls } })} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="cs-lbl">Bags</span>
          <Stepper label="Bags of gold" value={g.bags} min={0} max={99} readOnly={!canEdit} onChange={(bags) => void update({ gold: { ...g, bags } })} />
        </div>
        {canEdit ? (
          <label className="flex min-h-11 items-center gap-2 text-[17px]">
            <input type="checkbox" className="size-5 accent-[#5b2b2b]" checked={g.chest} onChange={(e) => void update({ gold: { ...g, chest: e.target.checked } })} />
            Chest of gold
          </label>
        ) : (
          <span className="cs-small">{g.chest ? "Has a chest of gold" : "No chest"}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="cs-lbl">Inventory</span>
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Inventory">
          {sheet.inventory.map((x, i) => (
            <li key={x.id} className="flex min-h-11 items-center gap-2 border-b border-[#e0cfa8] text-[17px]">
              <span className="flex-1">{x.name}</span>
              {canEdit ? (
                <button
                  type="button"
                  className="cs-step"
                  aria-label={`Remove ${x.name}`}
                  onClick={() => void update({ inventory: sheet.inventory.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
          {sheet.inventory.length === 0 ? <li className="cs-small italic">Nothing carried.</li> : null}
        </ul>
        {canEdit && sheet.inventory.length < 60 ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = item.trim();
              if (!name) return;
              void update({ inventory: [...sheet.inventory, name] });
              setItem("");
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">New item</span>
              <input className="cs-in" placeholder="Add an item" maxLength={200} value={item} onChange={(e) => setItem(e.target.value)} />
            </label>
            <button type="submit" className="cs-pill">
              Add
            </button>
          </form>
        ) : null}
      </div>
    </Box>
  );
}

const STATUS_LABEL: Record<CharacterStatus, string> = { active: "Active", dead: "Dead", retired: "Retired" };

function StatusControls() {
  const { character, canEdit, setStatus } = useSheet();
  const [confirm, setConfirm] = useState<CharacterStatus | null>(null);
  if (!canEdit) return null;
  return (
    <Box title="Status">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Character status">
        {(Object.keys(STATUS_LABEL) as CharacterStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`cs-pill ${character.status === s ? "cs-solid" : ""}`}
            aria-pressed={character.status === s}
            onClick={() => (s === "active" || s === character.status ? void setStatus(s) : setConfirm(s))}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {confirm ? (
        <div role="alertdialog" aria-label={`Confirm ${STATUS_LABEL[confirm].toLowerCase()}`} className="cs-take">
          <p className="cs-small m-0">
            Mark {character.sheet.name} as {STATUS_LABEL[confirm].toLowerCase()}? You can set them active again later.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="cs-pill cs-solid"
              onClick={() => {
                void setStatus(confirm);
                setConfirm(null);
              }}
            >
              Mark {STATUS_LABEL[confirm].toLowerCase()}
            </button>
            <button type="button" className="cs-pill" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </Box>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="cs-lbl">{label}</span>
      <span className="cs-in cs-ro">{value}</span>
    </div>
  );
}

function Identity({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, update, character } = useSheet();
  const uploaded = character.portraitUrl;
  const art = portraitFor({ subclassId: sheet.subclassId, ancestryId: ancestryArtId(sheet.ancestry) });
  const image =
    sheet.portrait?.kind === "upload"
      ? uploaded
        ? `url(${uploaded})`
        : "none"
      : sheet.portrait?.kind === "asset"
        ? assetBackground(sheet.portrait.asset)
        : art
          ? assetBackground(art.asset)
          : "none";
  const subclass = getSubclass(sheet.subclassId);
  return (
    <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
      <div
        role="img"
        aria-label={`Portrait of ${sheet.name}`}
        className="mx-auto aspect-[4/5] w-full max-w-[220px] rounded-t-full border-[3px] border-double border-[#a8865a] bg-[#e8d9b6] bg-cover bg-no-repeat shadow-[inset_0_0_30px_rgba(40,25,8,.3)]"
        style={{ backgroundImage: image, backgroundPosition: sheet.portrait ? "center" : (art?.position ?? "center") }}
      />
      <div className="cs-box !grid grid-cols-1 content-start !gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <TextField label="Name" value={sheet.name} maxLength={80} readOnly={!canEdit} onSave={(name) => name && void update({ name })} />
        <TextField label="Pronouns" value={sheet.pronouns} maxLength={80} placeholder="they/them" readOnly={!canEdit} onSave={(pronouns) => void update({ pronouns })} />
        <ReadOnlyField label="Class" value={cls?.name ?? sheet.classId} />
        <ReadOnlyField label="Subclass" value={subclass?.name ?? sheet.subclassId} />
        <ReadOnlyField label="Ancestry" value={ancestryLabel(sheet.ancestry)} />
        <ReadOnlyField label="Community" value={getCommunity(sheet.communityId)?.name ?? sheet.communityId} />
      </div>
    </div>
  );
}

export function PageOne({ cls, extras }: { cls: ClassDef | undefined; extras?: ReactNode }) {
  const { sheet, canEdit, update, adjust, slot } = useSheet();
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  // Evasion shown with active effects (Rogue's Dodge and the like); the base on the sheet never changes.
  const defense = derivedDefense(withEffects(sheet));
  const effectEvasion = defense.evasion - derivedDefense(sheet).evasion;
  const armorSlots = defense.armorScore;
  const thresholds = damageThresholds(sheet.level, armor?.baseThresholds ?? null);
  const ranges = thresholdRanges(thresholds);
  const hopeSlots = BASE_HOPE_MAX + (sheet.hopeSlotBonus ?? 0);
  const maxHope = hopeMax(sheet.scars, sheet.hopeSlotBonus ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <Identity cls={cls} />
      <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_3fr]">
        <Experiences />
        <TraitsGrid />
      </div>

      <div className="cs-grid">
        <Box title="Defence">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex flex-col items-center gap-1">
              {canEdit ? (
                <label className="flex flex-col items-center gap-1">
                  <input
                    key={sheet.evasion}
                    className="cs-num cs-circle"
                    inputMode="numeric"
                    defaultValue={sheet.evasion}
                    aria-label="Base Evasion"
                    onBlur={(e) => {
                      const v = Number.parseInt(e.target.value, 10);
                      if (Number.isInteger(v) && v >= 0 && v <= 40 && v !== sheet.evasion) void update({ evasion: v });
                      else e.target.value = String(sheet.evasion);
                    }}
                  />
                  <span className="cs-lbl">Base Evasion</span>
                </label>
              ) : null}
              <span className="cs-num cs-circle" aria-label={`Evasion ${defense.evasion}`} data-testid="evasion">
                {defense.evasion}
              </span>
              <span className="cs-lbl">
                Evasion
                {defense.evasionModifier ? ` (${defense.evasionModifier > 0 ? "+" : ""}${defense.evasionModifier} gear)` : ""}
                {effectEvasion ? ` (${effectEvasion > 0 ? "+" : ""}${effectEvasion} effects)` : ""}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="cs-num cs-circle" aria-label={`Armor Score ${armorSlots}`}>
                {armorSlots}
              </span>
              <span className="cs-lbl">Armor</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="cs-lbl">Armor slots</span>
              {armorSlots > 0 ? (
                <Track
                  name="Armor Slot"
                  kind="armor"
                  slots={armorSlots}
                  marked={sheet.armorMarked}
                  readOnly={!canEdit}
                  onDelta={(d) => void adjust("armor", d)}
                />
              ) : (
                <span className="cs-small italic">Unarmored: no Armor Slots.</span>
              )}
            </div>
          </div>
        </Box>

        <Box title="Hope">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="cs-small">
              Hope max <strong className="font-display text-[20px]">{maxHope}</strong>
            </span>
            <span className="flex items-center gap-2">
              <span className="cs-lbl !text-[#8e2b2b]">Scars</span>
              <Stepper label="Scars" value={sheet.scars} min={0} max={6} readOnly={!canEdit} onChange={(v) => void adjust("scars", v - sheet.scars)} />
            </span>
          </div>
          <Track name="Hope" kind="coin" slots={hopeSlots} lost={hopeSlots - maxHope} marked={sheet.hope} readOnly={!canEdit} onDelta={(d) => void adjust("hope", d)} />
          <div className="cs-small grid grid-cols-1 gap-2 italic sm:grid-cols-2">
            <span>Spend a Hope to use an Experience or help an ally.</span>
            <span>Spend 3 Hope to make a tag team roll or use your class’ Hope feature.</span>
          </div>
          {cls ? (
            <div className="flex flex-col gap-1">
              <span className="cs-lbl">Class Hope feature</span>
              <FeatureText name={cls.hopeFeature.name} text={cls.hopeFeature.text} />
            </div>
          ) : null}
        </Box>
      </div>

      <SheetDiceBox {...slot} />
      <FeaturesPanel {...slot} />

      <div className="cs-grid">
        <Box title="Hit Points & Stress">
          <div className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["Minor", ranges.minor, 1],
                ["Major", ranges.major, 2],
                ["Severe", ranges.severe, 3],
              ] as const
            ).map(([name, range, marks]) => (
              <div key={name} className="flex flex-col gap-1">
                <span className="cs-thr-head">{name}</span>
                <span className="cs-thr-val" aria-label={`${name} damage ${range}`}>
                  {range}
                </span>
                <span className="cs-small">Mark {marks} HP</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="cs-lbl">Thresholds</span>
            <strong className="cs-thr-pill" data-testid="threshold-major">
              Major {thresholds.major}
            </strong>
            <strong className="cs-thr-pill" data-testid="threshold-severe">
              Severe {thresholds.severe}
            </strong>
            <span className="cs-small italic">
              = {armor ? `${armor.name} ${armor.baseThresholds.major}/${armor.baseThresholds.severe}` : "Unarmored"} + level {sheet.level}
            </span>
          </div>
          {canEdit ? <DamageCalculator thresholds={thresholds} armorFree={armorSlots - sheet.armorMarked} /> : null}
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="cs-lbl">
                HP <span className="normal-case">{sheet.hp} / {sheet.hpMax}</span>
              </span>
              {canEdit ? (
                <Stepper label="Hit Point slots" value={sheet.hpMax} min={1} max={MAX_SLOTS} readOnly={false} display={<span className="sr-only">{sheet.hpMax}</span>} onChange={(hpMax) => void update({ hpMax })} />
              ) : null}
            </div>
            <Track name="Hit Point" kind="heart" slots={sheet.hpMax} marked={sheet.hp} readOnly={!canEdit} onDelta={(d) => void adjust("hp", d)} />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="cs-lbl">
                Stress <span className="normal-case">{sheet.stress} / {sheet.stressMax}</span>
              </span>
              {canEdit ? (
                <Stepper label="Stress slots" value={sheet.stressMax} min={1} max={MAX_SLOTS} readOnly={false} display={<span className="sr-only">{sheet.stressMax}</span>} onChange={(stressMax) => void update({ stressMax })} />
              ) : null}
            </div>
            <Track name="Stress" kind="diamond" slots={sheet.stressMax} marked={sheet.stress} readOnly={!canEdit} onDelta={(d) => void adjust("stress", d)} />
            {sheet.stress >= sheet.stressMax ? <span className="cs-small font-bold text-[#8e2b2b]">All Stress marked: Vulnerable.</span> : null}
          </div>
        </Box>

        <Box title="Active Weapons">
          <div className="flex flex-wrap items-center gap-3 border-b border-dashed border-[#c9b083] pb-3">
            <span className="cs-lbl">Proficiency</span>
            <span className="flex gap-1" role="img" aria-label={`Proficiency ${sheet.proficiency}`}>
              {Array.from({ length: Math.max(6, sheet.proficiency) }, (_, k) => (
                <span key={k} className={`cs-prof${k < sheet.proficiency ? " on" : ""}`} />
              ))}
            </span>
            <strong className="font-display text-[20px]" aria-hidden="true">
              {sheet.proficiency}
            </strong>
          </div>
          <WeaponBlock label="Primary" weaponId={sheet.primaryWeaponId} slot="primary" />
          <WeaponBlock label="Secondary" weaponId={sheet.secondaryWeaponId} slot="secondary" />
        </Box>
      </div>

      <RestPicker {...slot} />
      <WitherCounter {...slot} />

      <div className="cs-grid">
        <ArmorBlock />
        <Wealth />
      </div>

      {cls ? (
        <Box title="Class Features">
          {cls.classFeatures.map((f) => (
            <FeatureText key={f.name} name={f.name} text={f.text} />
          ))}
        </Box>
      ) : null}

      {/* EXTRAS: beastform, companion, frame extras (wired by lead) */}
      {extras}

      <StatusControls />
    </div>
  );
}
