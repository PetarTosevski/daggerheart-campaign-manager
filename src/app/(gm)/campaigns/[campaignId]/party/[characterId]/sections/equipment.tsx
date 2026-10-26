"use client";

import "./equipment.css";

import type { ReactNode } from "react";

import { Label, paperField, SheetBox, Small } from "@/components/party/sheet-ui";
import { derivedDefense } from "@/lib/domain/characters/derived";
import { spellcastTraitOf } from "@/lib/domain/characters/spellcast";
import { tierForLevel } from "@/lib/domain/characters";
import { ACHIEVEMENT_LEVELS } from "@/lib/domain/level-up";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";
import { ikonisDamage, type MotherboardState } from "@/lib/frames/extras/motherboard";
import { ARMOR, getArmor, getWeapon, WEAPONS, type Weapon } from "@/lib/srd";
import { cn } from "@/lib/utils";

import { useMotherboard, useSheet } from "../sheet-context";
import { weaponDamage } from "../sheet-helpers";

// Active Weapons (with the Motherboard Ikonis) and Active Armor of page 1, in the board's 2-column field grids.

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

/**
 * The board's "why" line: 1 base, +1 per achievement tier reached (levels 2, 5, 8), the rest from the Proficiency
 * advancement. Null when the parts don't add up (for example after a GM level correction).
 */
function proficiencyWhy(level: number, proficiency: number): string | null {
  const parts = ["1 base", ...ACHIEVEMENT_LEVELS.filter((l) => level >= l).map((_, i) => `+1 Tier ${i + 2}`)];
  const extra = proficiency - parts.length;
  if (extra < 0) return null;
  if (extra > 0) parts.push(`+${extra} advancement${extra > 1 ? "s" : ""}`);
  return parts.join(" ");
}

/** One read-only cell of the field grid: label over a locked (derived) value. */
function Locked({ label, children, multi, testId }: { label: string; children: ReactNode; multi?: boolean; testId?: string }) {
  return (
    <div className="eq-field">
      <Label>{label}</Label>
      <div className={cn(paperField.locked, multi && "eq-multi")} data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

function FeatureValue({ feature }: { feature?: { name: string; text: string } | null }) {
  if (!feature) return <>—</>;
  return (
    <span>
      <strong>{feature.name}:</strong> {feature.text}
    </span>
  );
}

const BURDEN: Record<Weapon["burden"], string> = { "two-handed": "Two-handed", barehanded: "Barehanded", "one-handed": "One-handed" };

function WeaponBlock({ label, weaponId, slot }: { label: string; weaponId?: string; slot: Weapon["slot"] }) {
  const { sheet, canEdit, update, hopeAndFear } = useSheet();
  const weapon = weaponId ? getWeapon(weaponId) : undefined;
  // A multiclass can bring the Spellcast trait magic weapons need (CB 111).
  const spellcaster = spellcastTraitOf(sheet) !== null;
  const primary = getWeapon(sheet.primaryWeaponId);
  const blocked = slot === "secondary" && primary?.burden === "two-handed";
  const options = weaponOptions(slot, sheet.level, sheet.classId, spellcaster, hopeAndFear, weaponId);
  const traitText = weapon ? (weapon.trait === "choice" ? "Trait of your choice" : weapon.trait[0].toUpperCase() + weapon.trait.slice(1)) : "";
  return (
    <div className="eq-block">
      <h4 className="eq-title">{label}</h4>
      <div className="eq-grid">
        {canEdit && !(blocked && !weapon) ? (
          <label className="eq-field">
            <Label>Name</Label>
            <select
              className={paperField.input}
              aria-label={`${label} weapon`}
              value={weaponId ?? ""}
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
          <Locked label="Name">{weapon?.name ?? (blocked ? "Both hands on the primary weapon" : "None")}</Locked>
        )}
        <Locked label="Trait & Range">{weapon ? `${traitText} · ${weapon.range}` : "—"}</Locked>
        <Locked label="Damage dice" testId={weapon ? `${slot}-damage` : undefined}>
          {weapon ? weaponDamage(weapon.damage, sheet.proficiency) : "—"}
        </Locked>
        <Locked label="Feature" multi>
          <FeatureValue feature={weapon?.feature} />
          {weapon ? <span className="eq-burden">{BURDEN[weapon.burden]}</span> : null}
        </Locked>
      </div>
    </div>
  );
}

/** The Ikonis in place of the weapon blocks (CB 301: no normal weapons; edited in the Motherboard panel). */
function IkonisBlock({ state }: { state: MotherboardState | null }) {
  const { sheet } = useSheet();
  const ikonis = state?.ikonis;
  return (
    <div className="eq-block" data-testid="ikonis-weapon">
      <h4 className="eq-title eq-ikonis-title">Ikonis</h4>
      <div className="eq-grid">
        <Locked label="Name">{ikonis?.name || "Ikonis"}</Locked>
        <Locked label="Trait & Range">
          {ikonis ? `${ikonis.trait ? TRAIT_LABEL[ikonis.trait] : "—"} · ${ikonis.range ?? "—"}` : "—"}
        </Locked>
        <Locked label="Damage dice">{(ikonis && ikonisDamage(ikonis, sheet.level)) ?? "—"}</Locked>
        <Locked label="Feature" multi>
          {ikonis?.description.trim() || "—"}
          <span className="eq-burden">Two-handed</span>
        </Locked>
      </div>
      <Small className="eq-note">Edit it and its augments in the Motherboard panel below.</Small>
    </div>
  );
}

export function ActiveWeaponsBox() {
  const { sheet } = useSheet();
  const motherboard = useMotherboard();
  const why = proficiencyWhy(sheet.level, sheet.proficiency);
  return (
    <SheetBox title="Active Weapons">
      <div className="eq-prof">
        <Label>Proficiency</Label>
        <span className="eq-swords" role="img" aria-label={`Proficiency ${sheet.proficiency}`} title={why ?? undefined}>
          {Array.from({ length: Math.max(6, sheet.proficiency) }, (_, k) => (
            <span key={k} className={cn("eq-sword", k < sheet.proficiency && "on")} />
          ))}
        </span>
        {why ? <Small className="eq-why">{why}</Small> : null}
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

/** The board's cracked split field: Major top-left, Severe bottom-right. */
function ThresholdSplit({ major, severe }: { major?: number; severe?: number }) {
  return (
    <span className="eq-thr">
      <span className={cn("eq-thr-a", major === undefined && "eq-thr-empty")}>
        {major === undefined ? "Major" : <><span className="sr-only">Major </span>{major}</>}
      </span>
      <span className={cn("eq-thr-b", severe === undefined && "eq-thr-empty")}>
        {severe === undefined ? "Severe" : <><span className="sr-only">Severe </span>{severe}</>}
      </span>
      <svg className="eq-crack" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M 8.0 62 L 23.8 50 L 19.8 44 L 35.6 38 L 43.4 30 L 39.5 24 L 57.9 20 L 68.4 12 L 65.8 6 L 81.5 4 L 92.0 -2"
          fill="none"
          stroke="rgba(255, 250, 235, 0.9)"
          strokeWidth="2.6"
          vectorEffect="non-scaling-stroke"
          transform="translate(0.6 0.8)"
        />
        <path
          d="M 8.0 62 L 23.8 50 L 19.8 44 L 35.6 38 L 43.4 30 L 39.5 24 L 57.9 20 L 68.4 12 L 65.8 6 L 81.5 4 L 92.0 -2"
          fill="none"
          stroke="#4a3624"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="bevel"
        />
        <path d="M 35.6 38 L 29.0 33 M 57.9 20 L 61.8 27 M 19.8 44 L 11.9 42 M 68.4 12 L 74.9 15" fill="none" stroke="#6a523a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}

export function ActiveArmorBox() {
  const { sheet, canEdit, update, hopeAndFear } = useSheet();
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const tier = tierForLevel(sheet.level);
  const options = ARMOR.filter((a) => a.id === sheet.armorId || (a.tier <= tier && (hopeAndFear || a.source === "core")));
  return (
    <SheetBox title="Active Armor">
      <div className="eq-grid">
        {canEdit ? (
          <label className="eq-field">
            <Label>Name</Label>
            <select className={paperField.input} aria-label="Active armor" value={sheet.armorId ?? ""} onChange={(e) => e.target.value && void update({ armorId: e.target.value })}>
              {sheet.armorId ? null : <option value="">Unarmored</option>}
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (Tier {a.tier})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Locked label="Name">{armor?.name ?? "Unarmored"}</Locked>
        )}
        <div className="eq-field">
          <Label>Base score</Label>
          <div className={paperField.locked}>{derivedDefense(sheet).armorScore}</div>
          <Small className="eq-hint">Sets your Armor Score</Small>
        </div>
        <div className="eq-field">
          <Label>Base thresholds</Label>
          <ThresholdSplit major={armor?.baseThresholds.major} severe={armor?.baseThresholds.severe} />
        </div>
        <Locked label="Feature" multi>
          <FeatureValue feature={armor?.feature} />
        </Locked>
      </div>
    </SheetBox>
  );
}
