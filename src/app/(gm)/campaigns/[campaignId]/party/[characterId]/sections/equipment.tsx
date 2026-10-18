"use client";

import "./equipment.css";

import { SheetBox } from "@/components/party/sheet-ui";
import { derivedDefense } from "@/lib/domain/characters/derived";
import { tierForLevel } from "@/lib/domain/characters";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";
import { ikonisDamage, type MotherboardState } from "@/lib/frames/extras/motherboard";
import { ARMOR, getArmor, getSubclass, getWeapon, WEAPONS, type Weapon } from "@/lib/srd";

import { FeatureText } from "../fields";
import { useMotherboard, useSheet } from "../sheet-context";
import { weaponDamage } from "../sheet-helpers";

// Active Weapons (with the Motherboard Ikonis) and Active Armor of page 1. Restyled by S4.

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
            aria-label={`${label} weapon`}
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

/** The Ikonis in place of the weapon pickers (CB 301: no normal weapons; edited in the Motherboard panel). */
function IkonisBlock({ state }: { state: MotherboardState | null }) {
  const { sheet } = useSheet();
  const ikonis = state?.ikonis;
  return (
    <div className="flex flex-col gap-2" data-testid="ikonis-weapon">
      <h4 className="m-0 font-display text-[16px] font-bold text-[#3d5e2e]">Ikonis</h4>
      <div className="flex flex-col gap-1">
        <span className="cs-lbl">Name</span>
        <span className="cs-in cs-ro">{ikonis?.name || "Ikonis"}</span>
      </div>
      {ikonis ? (
        <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="cs-lbl">Trait &amp; range</dt>
            <dd className="cs-in cs-ro m-0">
              {ikonis.trait ? TRAIT_LABEL[ikonis.trait] : "—"} · {ikonis.range ?? "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="cs-lbl">Damage dice</dt>
            <dd className="cs-in cs-ro m-0">{ikonisDamage(ikonis, sheet.level) ?? "—"}</dd>
          </div>
        </dl>
      ) : null}
      <span className="cs-small italic">Two-handed. Edit it and its augments in the Motherboard panel below.</span>
    </div>
  );
}

export function ActiveWeaponsBox() {
  const { sheet } = useSheet();
  const motherboard = useMotherboard();
  return (
    <SheetBox title="Active Weapons">
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
      {motherboard.motherboard && sheet.primaryWeaponId === "" ? (
        <IkonisBlock state={motherboard.state} />
      ) : (
        <>
          <WeaponBlock label="Primary" weaponId={sheet.primaryWeaponId} slot="primary" />
          <WeaponBlock label="Secondary" weaponId={sheet.secondaryWeaponId} slot="secondary" />
        </>
      )}
    </SheetBox>
  );
}

export function ActiveArmorBox() {
  const { sheet, canEdit, update, hopeAndFear } = useSheet();
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const tier = tierForLevel(sheet.level);
  const options = ARMOR.filter((a) => a.id === sheet.armorId || (a.tier <= tier && (hopeAndFear || a.source === "core")));
  return (
    <SheetBox title="Active Armor">
      {canEdit ? (
        <label className="flex flex-col gap-1">
          <span className="cs-lbl">Name</span>
          <select className="cs-in" aria-label="Active armor" value={sheet.armorId ?? ""} onChange={(e) => e.target.value && void update({ armorId: e.target.value })}>
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
    </SheetBox>
  );
}
