"use client";

import "./identity.css";

import { useState } from "react";

import { PortraitUpload } from "@/components/party/portrait";
import { Label, Pill, SheetBox, Small, paperField } from "@/components/party/sheet-ui";
import { assetBackground } from "@/lib/design-assets";
import type { SheetPatch } from "@/lib/validation/characters";
import { getCommunity, getSubclass, getTransformation, portraitFor, TRAIT_IDS, type ClassDef, type TraitId } from "@/lib/srd";
import { cn } from "@/lib/utils";

import { TextField } from "../fields";
import { useSheet } from "../sheet-context";
import { ancestryArtId, ancestryLabel, signed } from "../sheet-helpers";

// Top of page 1, as on the board (Party.dc.html): portrait arch + Experiences | identity grid + traits.

const TRAITS: Record<TraitId, { label: string; verbs: string }> = {
  agility: { label: "Agility", verbs: "Sprint · Leap · Maneuver" },
  strength: { label: "Strength", verbs: "Lift · Smash · Grapple" },
  finesse: { label: "Finesse", verbs: "Control · Hide · Tinker" },
  instinct: { label: "Instinct", verbs: "Perceive · Sense · Navigate" },
  presence: { label: "Presence", verbs: "Charm · Perform · Deceive" },
  knowledge: { label: "Knowledge", verbs: "Recall · Analyze · Comprehend" },
};

const MOD_MIN = -5;
const MOD_MAX = 10;

/** "+2", "2", "-1" or "−1" to a number in range; null when it isn't one. */
function parseModifier(text: string): number | null {
  const m = /^\s*([+\-−]?)(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[2]) * (m[1] === "-" || m[1] === "−" ? -1 : 1);
  return Math.min(MOD_MAX, Math.max(MOD_MIN, n));
}

/** The board's trait card: green Cinzel head, ringed number, trait-mark dot, italic verbs; paper steppers for editors. */
function TraitsGrid() {
  const { sheet, canEdit, update } = useSheet();
  const epoch = sheet.level >= 8 ? 3 : sheet.level >= 5 ? 2 : 1;
  return (
    <div className="id-traits" role="list" aria-label="Traits">
      {TRAIT_IDS.map((t) => {
        const { label, verbs } = TRAITS[t];
        const value = sheet.traits[t];
        const marked = (sheet.traitMarks[t] ?? 0) === epoch;
        const set = (v: number) => void update({ traits: { ...sheet.traits, [t]: v } });
        return (
          <div key={t} role="listitem" className="id-trait">
            <span className="id-trait-head">{label}</span>
            <span className="id-trait-ring">
              <span className={cn(paperField.number, "id-trait-circle")} aria-label={`${label} ${signed(value)}`}>
                {signed(value)}
              </span>
              {/* Marks change only through level-up, so the dot is shown, not toggled. */}
              {marked ? (
                <span className="id-trait-mark on" role="img" aria-label={`${label} marked this tier`} title={`${label} marked this tier`} />
              ) : (
                <span className="id-trait-mark" aria-hidden="true" />
              )}
            </span>
            {canEdit ? (
              <div className="id-steps" role="group" aria-label={label}>
                <button type="button" className="id-step" aria-label={`Decrease ${label}`} disabled={value <= MOD_MIN} onClick={() => set(value - 1)}>
                  −
                </button>
                <span className="sr-only" aria-live="polite">
                  {signed(value)}
                </span>
                <button type="button" className="id-step" aria-label={`Increase ${label}`} disabled={value >= MOD_MAX} onClick={() => set(value + 1)}>
                  +
                </button>
              </div>
            ) : null}
            <Small className="italic">{verbs}</Small>
          </div>
        );
      })}
    </div>
  );
}

/** The board's 50 px "+2" field. Shows the saved value while unfocused; saves a valid number on blur. */
function ModifierInput({ label, value, onSave }: { label: string; value: number; onSave: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={cn(paperField.input, "id-exp-mod")}
      inputMode="numeric"
      aria-label={label}
      maxLength={3}
      value={draft ?? signed(value)}
      onFocus={() => setDraft(signed(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft === null ? null : parseModifier(draft);
        setDraft(null);
        if (next !== null && next !== value) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function Experiences() {
  const { sheet, canEdit, update } = useSheet();
  const [draft, setDraft] = useState("");
  const list = sheet.experiences;
  const save = (next: NonNullable<SheetPatch["experiences"]>) => void update({ experiences: next });
  return (
    <SheetBox title="Experiences" className="id-exp">
      <ul className="id-exp-list">
        {list.map((x, i) => (
          <li key={x.id} className="id-exp-row">
            <div className="id-exp-name">
              <TextField
                label={`Experience ${i + 1}`}
                hideLabel
                value={x.name}
                maxLength={80}
                readOnly={!canEdit}
                onSave={(name) => name && save(list.map((e) => (e.id === x.id ? { ...e, name } : e)))}
              />
            </div>
            {canEdit ? (
              <>
                <ModifierInput
                  label={`Experience ${i + 1} modifier`}
                  value={x.value}
                  onSave={(value) => save(list.map((e) => (e.id === x.id ? { ...e, value } : e)))}
                />
                <button type="button" className="id-step id-exp-remove" aria-label={`Remove ${x.name}`} onClick={() => save(list.filter((e) => e.id !== x.id))}>
                  ×
                </button>
              </>
            ) : (
              <span className={cn(paperField.locked, "id-exp-mod")} aria-label={`Experience ${i + 1} modifier ${signed(x.value)}`}>
                {signed(x.value)}
              </span>
            )}
          </li>
        ))}
        {list.length === 0 ? (
          <li>
            <Small className="italic">No Experiences yet.</Small>
          </li>
        ) : null}
      </ul>
      {canEdit && list.length < 12 ? (
        <form
          className="id-exp-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.trim();
            if (!name) return;
            save([...list, { name, value: 2 }]);
            setDraft("");
          }}
        >
          <label className="id-exp-name">
            <span className="sr-only">New Experience</span>
            <input className={paperField.input} placeholder="New Experience" maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <Pill type="submit" className="id-exp-add">
            Add
          </Pill>
        </form>
      ) : null}
    </SheetBox>
  );
}

/** A set-at-creation value in the board's locked field (`sh-in sh-locked`). */
function LockedField({ label, value, title = "Set at character creation", tag }: { label: string; value: string; title?: string; tag?: string }) {
  return (
    <div className="id-field">
      <Label>{label}</Label>
      <div className={paperField.locked} title={title}>
        <span>{value}</span>
        {tag ? <span className="id-hf">{tag}</span> : null}
      </div>
    </div>
  );
}

/** The board's arched portrait frame (`pt-frame`), with the upload button for editors as its `pt-actions` overlay. */
function Portrait() {
  const { sheet, character } = useSheet();
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
  const empty = image === "none";
  return (
    <div className={cn("id-portrait", empty && "id-portrait-empty")}>
      <div
        role="img"
        aria-label={`Portrait of ${sheet.name}`}
        className="id-portrait-art"
        style={{ backgroundImage: image, backgroundPosition: sheet.portrait ? "center 30%" : (art?.position ?? "center 30%") }}
      >
        {empty ? (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
          </svg>
        ) : null}
      </div>
      {character.canEdit ? (
        <div className="id-portrait-actions">
          <PortraitUpload character={character} />
        </div>
      ) : null}
    </div>
  );
}

/** Portrait arch with Experiences under it | identity grid (3 columns) with the six traits under it. */
export function IdentitySection({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, update } = useSheet();
  const subclass = getSubclass(sheet.subclassId);
  const transformationId = sheet.transformationId ?? (sheet.ancestry.kind === "shapeshifter" ? "shapeshifter" : undefined);
  const transformation = transformationId ? (getTransformation(transformationId)?.name ?? transformationId) : "None";
  return (
    <div className="cs-top id-top">
      <div className="cs-col id-col">
        <Portrait />
        <Experiences />
      </div>
      <div className="cs-col id-col">
        <div className="id-head">
          <div className="sh-box id-grid">
            <div className="id-field">
              <TextField label="Name" labelClassName="sh-lbl" value={sheet.name} maxLength={80} readOnly={!canEdit} onSave={(name) => name && void update({ name })} />
            </div>
            <div className="id-field">
              <TextField
                label="Pronouns"
                labelClassName="sh-lbl"
                value={sheet.pronouns}
                maxLength={80}
                placeholder="they/them"
                readOnly={!canEdit}
                onSave={(pronouns) => void update({ pronouns })}
              />
            </div>
            <LockedField label="Ancestry" value={ancestryLabel(sheet.ancestry)} />
            <LockedField label="Community" value={getCommunity(sheet.communityId)?.name ?? sheet.communityId} />
            <LockedField label="Subclass" value={subclass?.name ?? sheet.subclassId} />
            <LockedField label="Class" value={cls?.name ?? sheet.classId} />
            <LockedField label="Transformation" value={transformation} title="Gained through the story, not at will" tag="H&F" />
          </div>
        </div>
        <TraitsGrid />
      </div>
    </div>
  );
}
