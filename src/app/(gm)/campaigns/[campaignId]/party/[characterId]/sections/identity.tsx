"use client";

import "./identity.css";

import { useMutation } from "convex/react";
import { useState } from "react";

import { PortraitUpload } from "@/components/party/portrait";
import { Label, Pill, SheetBox, Small, paperField } from "@/components/party/sheet-ui";
import { errorMessage } from "@/lib/convex-errors";
import { assetBackground } from "@/lib/design-assets";
import { experienceValue, holdsPurposefulDesign } from "@/lib/domain/dice";
import { ACHIEVEMENT_LEVELS } from "@/lib/domain/level-up";
import { pronounsFieldLabel, type PronounsLabel } from "@/lib/validation/characters";
import { getCommunity, getSubclass, getTransformation, portraitFor, TRAIT_IDS, type ClassDef, type TraitId } from "@/lib/srd";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";
import { TextField } from "../fields";
import { advancementsChosen, cardsChosen, useLevelUpDraft } from "../level-up-draft";
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

/**
 * "+2", "2", "-1" or "−1" to a number in range; null when it isn't one. `bonus` shifts the range for a field that shows
 * a total with a bonus (Purposeful Design's +1), so a typed +11 stays +11 (DA16).
 */
function parseModifier(text: string, bonus = 0): number | null {
  const m = /^\s*([+\-−]?)(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[2]) * (m[1] === "-" || m[1] === "−" ? -1 : 1);
  return Math.min(MOD_MAX + bonus, Math.max(MOD_MIN + bonus, n));
}

/**
 * The board's trait card: green Cinzel head, ringed number, trait-mark dot, italic verbs; paper steppers for the GM.
 * A stepper click sends a delta (dcm-bxp.28), so two quick clicks add up instead of the second overwriting the first.
 */
function TraitsGrid() {
  const { character, sheet, canEdit, slot } = useSheet();
  const step = useMutation(api.characters.setTrait);
  const [error, setError] = useState<string | null>(null);
  const isGm = slot.isGm;
  const epoch = sheet.level >= 8 ? 3 : sheet.level >= 5 ? 2 : 1;
  return (
    <>
      <div className="id-traits" role="list" aria-label="Traits">
        {TRAIT_IDS.map((t) => {
          const { label, verbs } = TRAITS[t];
          const value = sheet.traits[t];
          const marked = (sheet.traitMarks[t] ?? 0) === epoch;
          const move = (delta: number) => {
            setError(null);
            step({ characterId: character._id, trait: t, delta }).catch((e: unknown) => setError(errorMessage(e)));
          };
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
              {/* Players change traits only through level-up; the GM keeps the steppers to correct them. */}
              {canEdit && isGm ? (
                <div className="id-steps" role="group" aria-label={label}>
                  <button type="button" className="id-step" aria-label={`Decrease ${label}`} disabled={value <= MOD_MIN} onClick={() => move(-1)}>
                    −
                  </button>
                  <span className="sr-only" aria-live="polite">
                    {signed(value)}
                  </span>
                  <button type="button" className="id-step" aria-label={`Increase ${label}`} disabled={value >= MOD_MAX} onClick={() => move(1)}>
                    +
                  </button>
                </div>
              ) : null}
              <Small className="italic">{verbs}</Small>
            </div>
          );
        })}
      </div>
      {error ? (
        <Small role="alert" className="italic">
          {error}
        </Small>
      ) : null}
    </>
  );
}

/**
 * The board's 50 px "+2" field. Shows the saved value while unfocused; saves a valid number on blur. `bonus` (Purposeful
 * Design's +1, DA11) is shown and typed on top of the stored value, which is saved without it.
 */
function ModifierInput({ label, value, bonus = 0, onSave }: { label: string; value: number; bonus?: number; onSave: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value + bonus;
  return (
    <input
      className={cn(paperField.input, "id-exp-mod")}
      inputMode="numeric"
      aria-label={label}
      maxLength={3}
      value={draft ?? signed(shown)}
      onFocus={() => setDraft(signed(shown))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const typed = draft === null ? null : parseModifier(draft, bonus);
        setDraft(null);
        const next = typed === null ? null : Math.min(MOD_MAX, Math.max(MOD_MIN, typed - bonus));
        if (next !== null && next !== value) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** Most Experiences a sheet holds (the engine's limit). */
const MAX_EXPERIENCES = 12;
/** Highest Experience modifier (the engine's limit). */
const MAX_EXPERIENCE_VALUE = 10;

/**
 * Guided level-up (GL2), shown only while the draft is on: the achievement Experience at levels 2/5/8 and the
 * targets of the "+1 to two Experiences" advancement. Green "Level N" panels mark them as not saved yet.
 */
function ExperiencesLevelUp() {
  const lu = useLevelUpDraft();
  const { sheet } = useSheet();
  if (!lu.active) return null;
  const achievement = ACHIEVEMENT_LEVELS.includes(lu.level);
  const pick = lu.draft.picks.find((p) => p.option === "experiences");
  const targets = pick?.targets ?? [];
  const tag = (
    <span className="id-lu-tag" aria-hidden="true">
      Level {lu.level}
    </span>
  );
  return (
    <>
      {achievement ? (
        <div className="id-lu">
          <label className="id-lu-field">
            <span className="id-lu-label">
              New Experience (+2) {tag}
              <span className="sr-only"> for level {lu.level}</span>
            </span>
            <input
              className={paperField.input}
              placeholder="Name the new Experience"
              maxLength={80}
              value={lu.draft.experienceName}
              onChange={(e) => lu.setExperienceName(e.target.value)}
              onKeyDown={(e) => {
                // Enter moves on to the next unfinished step: the tier boxes, then the deck, then the summary.
                if (e.key !== "Enter" || !lu.draft.experienceName.trim()) return;
                e.preventDefault();
                lu.goTo(!advancementsChosen(lu.draft) ? "advancements" : !cardsChosen(lu.draft) ? "deck" : "finish");
              }}
            />
          </label>
          {sheet.experiences.length >= MAX_EXPERIENCES ? <Small className="italic">A sheet holds at most {MAX_EXPERIENCES} Experiences.</Small> : null}
        </div>
      ) : null}
      {pick ? (
        <fieldset className="id-lu">
          <legend className="id-lu-label">
            +1 to two Experiences {tag}
            <span className="sr-only"> for level {lu.level}</span>
          </legend>
          <Small className="italic">Choose two ({targets.length}/2).</Small>
          <ul className="id-lu-list">
            {sheet.experiences.map((x) => {
              const checked = targets.includes(x.id);
              const capped = x.value >= MAX_EXPERIENCE_VALUE;
              return (
                <li key={x.id}>
                  <label className="id-lu-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && (targets.length >= 2 || capped)}
                      onChange={() => lu.setPickTargets(pick.option, pick.tier, checked ? targets.filter((t) => t !== x.id) : [...targets, x.id])}
                    />
                    <span>+1 to {x.name}</span>
                    <span className="id-lu-preview" aria-hidden="true">
                      {signed(experienceValue(x))} → {signed(experienceValue(x) + 1)}
                    </span>
                    {capped ? <span className="sr-only"> (already at +{MAX_EXPERIENCE_VALUE})</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
    </>
  );
}

/**
 * Purposeful Design (Clank, CB p.53: "At character creation, choose one of your Experiences that best aligns with this
 * purpose and gain a permanent +1 bonus to it."): a Clank created without the choice picks it once here (DA11), and so
 * does one whose chosen Experience was removed. The GM can move the +1 to another Experience later as a correction
 * (DA16, user 2026-10-30). Shown to editors of a sheet that holds the feature: to the owner while no Experience is
 * chosen, to the GM also after (the server decides through permissionFor; this only hides the form).
 */
function PurposefulDesignPick() {
  const { character, sheet, canEdit, hopeAndFear, slot } = useSheet();
  const choose = useMutation(api.characters.choosePurposefulDesign);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = sheet.experiences.find((x) => x.purposefulDesign);
  const options = sheet.experiences.filter((x) => x.id !== chosen?.id);
  if (!canEdit || options.length === 0 || (chosen && !slot.isGm)) return null;
  if (!holdsPurposefulDesign(sheet.ancestry, { hopeAndFear })) return null;
  const experienceId = options.some((x) => x.id === picked) ? picked : options[0]!.id;
  return (
    <form
      className="id-exp-row"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        // One key per click, so the client's retries record it once.
        choose({ characterId: character._id, experienceId, idempotencyKey: crypto.randomUUID() })
          .catch((err: unknown) => setError(errorMessage(err)))
          .finally(() => setBusy(false));
      }}
    >
      <label className="id-exp-name">
        <Small>
          {chosen ? `Correction: move Purposeful Design's +1 from ${chosen.name} to` : "Purposeful Design: +1 to the Experience that best aligns with your purpose"}
        </Small>
        <select className={paperField.input} aria-label="Purposeful Design Experience" value={experienceId} onChange={(e) => setPicked(e.target.value)}>
          {options.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <Pill type="submit" className="id-exp-add" disabled={busy}>
        {chosen ? "Move" : "Choose"}
      </Pill>
      {error ? (
        <Small role="alert" className="italic">
          {error}
        </Small>
      ) : null}
    </form>
  );
}

/**
 * The Experience mutations as intents (dcm-bxp.28, CL3): one field of one Experience by id, never the whole list, so an
 * edit can't undo a concurrent one (a level-up, Purposeful Design, another tab).
 */
function useExperienceEdits(characterId: Id<"characters">) {
  const set = useMutation(api.characters.setExperience);
  const add = useMutation(api.characters.addExperience);
  const remove = useMutation(api.characters.removeExperience);
  const [error, setError] = useState<string | null>(null);
  /** Resolves to whether the edit saved; a refusal shows below the list. */
  const run = (p: Promise<unknown>): Promise<boolean> => {
    setError(null);
    return p.then(
      () => true,
      (e: unknown) => {
        setError(errorMessage(e));
        return false;
      },
    );
  };
  return {
    error,
    rename: (experienceId: string, name: string) => run(set({ characterId, experienceId, name })),
    setValue: (experienceId: string, value: number) => run(set({ characterId, experienceId, value })),
    add: (name: string) => run(add({ characterId, name })),
    remove: (experienceId: string) => run(remove({ characterId, experienceId })),
  };
}

function Experiences() {
  const { character, sheet, canEdit } = useSheet();
  const leveling = useLevelUpDraft().active;
  const [draft, setDraft] = useState("");
  const list = sheet.experiences;
  const edits = useExperienceEdits(character._id);
  return (
    <SheetBox title="Experiences" className="id-exp" id="lu-target-experiences">
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
                onSave={(name) => name && edits.rename(x.id, name)}
              />
            </div>
            {canEdit ? (
              <>
                <ModifierInput
                  label={`Experience ${i + 1} modifier`}
                  value={x.value}
                  bonus={experienceValue(x) - x.value}
                  onSave={(value) => void edits.setValue(x.id, value)}
                />
                <button type="button" className="id-step id-exp-remove" aria-label={`Remove ${x.name}`} onClick={() => void edits.remove(x.id)}>
                  ×
                </button>
              </>
            ) : (
              <span className={cn(paperField.locked, "id-exp-mod")} aria-label={`Experience ${i + 1} modifier ${signed(experienceValue(x))}`}>
                {signed(experienceValue(x))}
              </span>
            )}
          </li>
        ))}
        {list.some((x) => x.purposefulDesign) ? (
          <li>
            <Small className="italic" data-testid="purposeful-design">
              Purposeful Design: +1 to {list.find((x) => x.purposefulDesign)!.name} (included above)
            </Small>
          </li>
        ) : null}
        {list.length === 0 ? (
          <li>
            <Small className="italic">No Experiences yet.</Small>
          </li>
        ) : null}
      </ul>
      <PurposefulDesignPick />
      <ExperiencesLevelUp />
      {/* While levelling, the new Experience comes from the draft above, so the direct Add form steps aside. */}
      {canEdit && !leveling && list.length < MAX_EXPERIENCES ? (
        <form
          className="id-exp-row"
          onSubmit={(e) => {
            e.preventDefault();
            const name = draft.trim();
            if (!name) return;
            void edits.add(name);
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
      {edits.error ? (
        <Small role="alert" className="italic">
          {edits.error}
        </Small>
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

/**
 * The pronouns text, labelled "Gender" by default or "Pronouns" when the character chose it (dcm-bxp.35).
 * Everyone who can edit the sheet sees the switch; the label is stored on the sheet so every viewer, read-only
 * players included, sees the same one. The switch sends one field and shows the new label while it saves.
 */
export function PronounsField() {
  const { sheet, canEdit, update } = useSheet();
  const [pending, setPending] = useState<PronounsLabel | null>(null);
  const flag = pending ?? sheet.pronounsLabel ?? "gender";
  const label = pronounsFieldLabel(flag);
  const toggle = async () => {
    const next: PronounsLabel = flag === "pronouns" ? "gender" : "pronouns";
    setPending(next);
    try {
      await update({ pronounsLabel: next });
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="id-field">
      <TextField
        label={label}
        labelClassName="sh-lbl"
        value={sheet.pronouns}
        maxLength={80}
        placeholder={flag === "pronouns" ? "they/them" : undefined}
        readOnly={!canEdit}
        onSave={(pronouns) => void update({ pronouns })}
      />
      {canEdit ? (
        <button
          type="button"
          role="switch"
          aria-checked={flag === "pronouns"}
          aria-label="Label as Pronouns"
          // 44 px tall on phones (S13's touch-target pass); the switch itself keeps its size.
          className="mt-1 flex items-center gap-1.5 self-start bg-transparent p-0 text-[12px] text-[#6b5a3e] max-sm:min-h-11"
          onClick={() => void toggle()}
        >
          <span aria-hidden="true" className={cn("relative inline-block h-3.5 w-6 rounded-full border border-current", flag === "pronouns" && "bg-current")}>
            <span className={cn("absolute top-[2px] left-[2px] h-2 w-2 rounded-full bg-current transition-transform", flag === "pronouns" && "translate-x-2.5 bg-[#f4ead4]")} />
          </span>
          Pronouns
        </button>
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
            <PronounsField />

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
