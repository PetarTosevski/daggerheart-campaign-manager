"use client";

import "./identity.css";

import { useState } from "react";

import { SheetBox } from "@/components/party/sheet-ui";
import { assetBackground } from "@/lib/design-assets";
import type { SheetPatch } from "@/lib/validation/characters";
import { getCommunity, getSubclass, portraitFor, TRAIT_IDS, type ClassDef, type TraitId } from "@/lib/srd";

import { Stepper, TextField } from "../fields";
import { useSheet } from "../sheet-context";
import { ancestryArtId, ancestryLabel, signed } from "../sheet-helpers";

// Top of page 1 (board: portrait arch + Experiences | identity grid + traits). Restyled by S1.

const TRAITS: Record<TraitId, { label: string; verbs: string }> = {
  agility: { label: "Agility", verbs: "Sprint · Leap · Maneuver" },
  strength: { label: "Strength", verbs: "Lift · Smash · Grapple" },
  finesse: { label: "Finesse", verbs: "Control · Hide · Tinker" },
  instinct: { label: "Instinct", verbs: "Perceive · Sense · Navigate" },
  presence: { label: "Presence", verbs: "Charm · Perform · Deceive" },
  knowledge: { label: "Knowledge", verbs: "Recall · Analyze · Comprehend" },
};

function TraitsGrid() {
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
    <SheetBox title="Experiences">
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
    </SheetBox>
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
  return (
    <div
      role="img"
      aria-label={`Portrait of ${sheet.name}`}
      className="mx-auto aspect-[4/5] w-full max-w-[240px] rounded-t-full border-[3px] border-double border-[#a8865a] bg-[#e8d9b6] bg-cover bg-no-repeat shadow-[inset_0_0_30px_rgba(40,25,8,.3)]"
      style={{ backgroundImage: image, backgroundPosition: sheet.portrait ? "center" : (art?.position ?? "center") }}
    />
  );
}

/** Portrait arch with Experiences under it | identity grid (3 columns) with the six traits under it. */
export function IdentitySection({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, update } = useSheet();
  const subclass = getSubclass(sheet.subclassId);
  return (
    <div className="cs-top">
      <div className="cs-col">
        <Portrait />
        <Experiences />
      </div>
      <div className="cs-col">
        <div className="cs-box !grid grid-cols-1 content-start !gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <TextField label="Name" value={sheet.name} maxLength={80} readOnly={!canEdit} onSave={(name) => name && void update({ name })} />
          <TextField label="Pronouns" value={sheet.pronouns} maxLength={80} placeholder="they/them" readOnly={!canEdit} onSave={(pronouns) => void update({ pronouns })} />
          <ReadOnlyField label="Class" value={cls?.name ?? sheet.classId} />
          <ReadOnlyField label="Subclass" value={subclass?.name ?? sheet.subclassId} />
          <ReadOnlyField label="Ancestry" value={ancestryLabel(sheet.ancestry)} />
          <ReadOnlyField label="Community" value={getCommunity(sheet.communityId)?.name ?? sheet.communityId} />
        </div>
        <TraitsGrid />
      </div>
    </div>
  );
}
