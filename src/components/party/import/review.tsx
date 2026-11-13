"use client";

import { useId, useState, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { tierForLevel } from "@/lib/domain/characters";
import type { ImportDraft, Unmatched } from "@/lib/import/draft";
import { importProblem } from "@/lib/import/sheet";
import { CLASSES } from "@/lib/srd/classes";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { ARMOR, WEAPONS } from "@/lib/srd/equipment";
import { TIERED_ARMOR, TIERED_WEAPONS } from "@/lib/srd/equipment-tiers";
import { ANCESTRIES, COMMUNITIES } from "@/lib/srd/heritage";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { TRAIT_IDS, type Source } from "@/lib/srd/types";
import { cn } from "@/lib/utils";
import { pronounsFieldLabel } from "@/lib/validation/characters";

import type { Id } from "../../../../convex/_generated/dataModel";

export type Owner = { userId: Id<"users">; name: string };

const ALL_WEAPONS = [...WEAPONS, ...TIERED_WEAPONS];
const ALL_ARMOR = [...ARMOR, ...TIERED_ARMOR];

const control = "min-h-10 w-full rounded-lg border border-line-2 bg-[#0f0d15] px-3 text-[15px] text-parchment";
/** A flagged control (PS2): the app's danger red, border and ring. */
const flaggedControl = "border-danger ring-1 ring-danger";

/** Whole numbers from a text field; anything else becomes NaN, which the draft check refuses. */
const toInt = (value: string) => (/^-?\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : Number.NaN);

/** The draft with an optional item set, or removed when `id` is empty ("None"). */
function withOptional(draft: ImportDraft, key: "secondaryWeaponId" | "armorId", id: string): ImportDraft {
  const next = { ...draft };
  if (id) next[key] = id;
  else delete next[key];
  return next;
}

const NUMBER_KEYS = ["level", "evasion", "hpMax", "hp", "stressMax", "stress", "hope", "armorMarked", "proficiency"] as const;

/**
 * The draft as the form opens it: every number Claude couldn't read is empty (NaN), so the GM must fill it in rather
 * than keep a default (PS2, "Couldn't read this: fill it in"). Text and selects are already empty.
 */
function withUnreadableEmpty(draft: ImportDraft, unreadable: string[]): ImportDraft {
  const has = (path: string) => unreadable.includes(path);
  const next: ImportDraft = { ...draft, traits: { ...draft.traits }, gold: { ...draft.gold } };
  for (const key of NUMBER_KEYS) if (has(key)) next[key] = Number.NaN;
  for (const t of TRAIT_IDS) if (has(`traits.${t}`)) next.traits[t] = Number.NaN;
  if (has("gold.handfuls")) next.gold.handfuls = Number.NaN;
  if (has("gold.bags")) next.gold.bags = Number.NaN;
  next.experiences = draft.experiences.map((e, i) => (has(`experiences.${i}.value`) ? { ...e, value: Number.NaN } : e));
  return next;
}

/** The note of a flagged field: what is wrong, in the words the GM reads (PS2, user 2026-11-13). */
type Note = string | null;

type Props = {
  initial: ImportDraft;
  unreadable: string[];
  uncertain?: string[];
  unmatched: Unmatched[];
  /** Nothing usable came back: every field is flagged and the form says so at the top. */
  blank?: boolean;
  hopeAndFear: boolean;
  owners: Owner[];
  defaultOwner?: Id<"users">;
  saving: boolean;
  error: string | null;
  onSave: (draft: ImportDraft, ownerId: Id<"users">) => void;
};

/**
 * The review screen: every field of the read draft is editable. Fields Claude couldn't read (empty), wasn't sure of
 * (its guess kept) or couldn't match are red, each with a note asking for the GM's input (PS2). The GM picks the
 * owner, and Save stays disabled until the draft passes the same checks the server runs.
 */
export function ReviewForm({ initial, unreadable, uncertain = [], unmatched, blank = false, hopeAndFear, owners, defaultOwner, saving, error, onSave }: Props) {
  const [draft, setDraft] = useState<ImportDraft>(() => withUnreadableEmpty(initial, unreadable));
  const [inventoryText, setInventoryText] = useState(initial.inventory.join("\n"));
  const [ownerId, setOwnerId] = useState<Id<"users"> | "">(defaultOwner ?? "");
  const problemId = useId();
  const cardsNoteId = useId();
  const experiencesNoteId = useId();
  const sources: Source[] = hopeAndFear ? ["core", "hope-and-fear"] : ["core"];
  const usable = <T extends { source: Source }>(list: readonly T[]) => list.filter((item) => sources.includes(item.source));
  const set = <K extends keyof ImportDraft>(key: K, value: ImportDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const note = (path: string): Note => {
    const miss = unmatched.find((u) => u.field === path);
    if (miss) return `Read as “${miss.text}”, which matched nothing: choose it.`;
    if (unreadable.includes(path)) return "Couldn't read this: fill it in.";
    if (uncertain.includes(path)) return "Not sure this is right: check it against the sheet.";
    return null;
  };
  const flagged = unreadable.length > 0 || uncertain.length > 0 || unmatched.length > 0;

  const tier = tierForLevel(Number.isInteger(draft.level) ? Math.min(10, Math.max(1, draft.level)) : 1);
  const cls = CLASSES.find((c) => c.id === draft.classId);
  const weapons = usable(ALL_WEAPONS).filter((w) => w.tier <= tier && (!w.classId || w.classId === draft.classId));
  const cards = usable(DOMAIN_CARDS)
    .filter((c) => cls?.domains.includes(c.domain) && c.level <= draft.level)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const missedCards = unmatched.filter((u) => u.field.startsWith("domainCards."));
  const cardsNote = note("domainCards");
  const cardsFlagged = cardsNote !== null || missedCards.length > 0;
  const experiencesNote = note("experiences");
  const problem = importProblem(draft, hopeAndFear) ?? (ownerId === "" ? "Choose who owns the character." : null);

  const number = (label: string, key: (typeof NUMBER_KEYS)[number]) => (
    <Field label={label} note={note(key)}>
      {(p, red) => <input {...p} inputMode="numeric" className={cn(control, red)} value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={(e) => set(key, toInt(e.target.value))} />}
    </Field>
  );

  const select = (label: string, path: string, value: string, options: { id: string; name: string }[], onChange: (id: string) => void, none?: string) => (
    <Field label={label} note={note(path)}>
      {(p, red) => (
        <select {...p} className={cn(control, red)} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{none ?? "Choose…"}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const ancestries = usable(ANCESTRIES);
  const a = draft.ancestry;
  const chestNote = note("gold.chest");
  const chestNoteId = useId();

  return (
    <form
      className="flex flex-col gap-5"
      aria-label="Review the imported character"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem === null && ownerId !== "") onSave(draft, ownerId);
      }}
    >
      {blank ? (
        <p role="status" className="m-0 rounded-lg border border-danger bg-danger-bg px-3 py-2 text-[15px] text-danger">
          Claude couldn&apos;t read anything from these photos. Fill in the sheet by hand.
        </p>
      ) : null}
      <p className="m-0 text-[14px] text-[#c9d2cf]">
        {flagged ? "Check every field against the paper sheet. Fields in red need your input." : "Check every field against the paper sheet."}
      </p>

      <Section title="Character">
        <Field label="Name" note={note("name")}>
          {(p, red) => <input {...p} className={cn(control, red)} value={draft.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        {/* The default label (dcm-bxp.35); the sheet's switch relabels it "Pronouns" once the character is saved. */}
        <Field label={pronounsFieldLabel(undefined)} note={note("pronouns")}>
          {(p, red) => <input {...p} className={cn(control, red)} value={draft.pronouns} onChange={(e) => set("pronouns", e.target.value)} />}
        </Field>
        {number("Level", "level")}
        {select("Class", "classId", draft.classId, usable(CLASSES), (id) => setDraft((d) => ({ ...d, classId: id, subclassId: "" })))}
        {select("Subclass", "subclassId", draft.subclassId, usable(SUBCLASSES).filter((s) => s.classId === draft.classId), (id) => set("subclassId", id))}
        {select("Community", "communityId", draft.communityId, usable(COMMUNITIES), (id) => set("communityId", id))}
        <Field label="Ancestry type" note={null}>
          {(p) => (
            <select
              {...p}
              className={control}
              value={a.kind === "mixed" ? "mixed" : "single"}
              onChange={(e) => set("ancestry", e.target.value === "mixed" ? { kind: "mixed", first: "", second: "", name: "" } : { kind: "single", id: "" })}
            >
              <option value="single">Single ancestry</option>
              <option value="mixed">Mixed ancestry</option>
            </select>
          )}
        </Field>
        {a.kind === "mixed" ? (
          <>
            {select("First ancestry", "ancestry.first", a.first, ancestries, (id) => set("ancestry", { ...a, first: id }))}
            {select("Second ancestry", "ancestry.second", a.second, ancestries, (id) => set("ancestry", { ...a, second: id }))}
          </>
        ) : a.kind === "single" ? (
          select("Ancestry", "ancestry.id", a.id, ancestries, (id) => set("ancestry", { kind: "single", id }))
        ) : null}
      </Section>

      <Section title="Traits">
        {TRAIT_IDS.map((t) => (
          <Field key={t} label={t[0]!.toUpperCase() + t.slice(1)} note={note(`traits.${t}`)}>
            {(p, red) => (
              <input
                {...p}
                inputMode="numeric"
                className={cn(control, red)}
                value={Number.isNaN(draft.traits[t]) ? "" : draft.traits[t]}
                onChange={(e) => set("traits", { ...draft.traits, [t]: toInt(e.target.value) })}
              />
            )}
          </Field>
        ))}
      </Section>

      <Section title="Defense and resources">
        {number("Base Evasion", "evasion")}
        {number("Proficiency", "proficiency")}
        {number("Hit Points (max)", "hpMax")}
        {number("Hit Points marked", "hp")}
        {number("Stress (max)", "stressMax")}
        {number("Stress marked", "stress")}
        {number("Hope", "hope")}
        {number("Armor slots marked", "armorMarked")}
      </Section>

      <Section title="Equipment">
        {select("Primary weapon", "primaryWeaponId", draft.primaryWeaponId, weapons.filter((w) => w.slot === "primary"), (id) => set("primaryWeaponId", id))}
        {select(
          "Secondary weapon",
          "secondaryWeaponId",
          draft.secondaryWeaponId ?? "",
          weapons.filter((w) => w.slot === "secondary"),
          (id) => setDraft((d) => withOptional(d, "secondaryWeaponId", id)),
          "None",
        )}
        {select(
          "Armor",
          "armorId",
          draft.armorId ?? "",
          usable(ALL_ARMOR).filter((x) => x.tier <= tier),
          (id) => setDraft((d) => withOptional(d, "armorId", id)),
          "None",
        )}
        <Field label="Handfuls of gold" note={note("gold.handfuls")}>
          {(p, red) => (
            <input {...p} inputMode="numeric" className={cn(control, red)} value={Number.isNaN(draft.gold.handfuls) ? "" : draft.gold.handfuls} onChange={(e) => set("gold", { ...draft.gold, handfuls: toInt(e.target.value) })} />
          )}
        </Field>
        <Field label="Bags of gold" note={note("gold.bags")}>
          {(p, red) => (
            <input {...p} inputMode="numeric" className={cn(control, red)} value={Number.isNaN(draft.gold.bags) ? "" : draft.gold.bags} onChange={(e) => set("gold", { ...draft.gold, bags: toInt(e.target.value) })} />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <label className={cn("flex items-center gap-2 text-[14px]", chestNote && "text-danger")}>
            <input
              type="checkbox"
              checked={draft.gold.chest}
              aria-invalid={chestNote ? true : undefined}
              aria-describedby={chestNote ? chestNoteId : undefined}
              onChange={(e) => set("gold", { ...draft.gold, chest: e.target.checked })}
            />
            Chest of gold
          </label>
          {chestNote ? (
            <span id={chestNoteId} className="text-[12px] text-danger">
              {chestNote}
            </span>
          ) : null}
        </div>
      </Section>

      <fieldset
        className={cn("m-0 flex flex-col gap-2 border-0 p-0", cardsFlagged && "rounded-lg border border-danger p-3")}
        aria-describedby={cardsFlagged ? cardsNoteId : undefined}
      >
        <legend className="mb-2 font-display text-[18px] font-bold">Domain cards</legend>
        {cardsFlagged ? (
          <div id={cardsNoteId} className="flex flex-col gap-1 text-[14px] text-danger">
            {cardsNote ? <p className="m-0">{cardsNote}</p> : null}
            {missedCards.map((m) => (
              <p key={m.field} className="m-0">
                Read as “{m.text}”, which matched nothing: choose it.
              </p>
            ))}
          </div>
        ) : null}
        {cards.length === 0 ? <p className="m-0 text-[14px] text-[#9fb2b6]">Choose a class to list its domain cards.</p> : null}
        <div className="grid max-h-[240px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1 overflow-y-auto">
          {cards.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={draft.domainCards.includes(c.id)}
                aria-invalid={cardsFlagged ? true : undefined}
                onChange={(e) => set("domainCards", e.target.checked ? [...draft.domainCards, c.id] : draft.domainCards.filter((id) => id !== c.id))}
              />
              {c.name} <span className="text-[#9fb2b6]">(level {c.level})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset
        className={cn("m-0 flex flex-col gap-2 border-0 p-0", experiencesNote && "rounded-lg border border-danger p-3")}
        aria-describedby={experiencesNote ? experiencesNoteId : undefined}
      >
        <legend className="mb-2 font-display text-[18px] font-bold">Experiences</legend>
        {experiencesNote ? (
          <p id={experiencesNoteId} className="m-0 text-[14px] text-danger">
            {experiencesNote}
          </p>
        ) : null}
        {draft.experiences.map((exp, i) => (
          // Rows get ids only when saved; the position is the row's identity while editing.
          <div key={i} className="flex items-end gap-2">
            <Field label={`Experience ${i + 1}`} note={note(`experiences.${i}.name`)}>
              {(p, red) => (
                <input {...p} className={cn(control, red)} value={exp.name} onChange={(e) => set("experiences", draft.experiences.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              )}
            </Field>
            <Field label={`Experience ${i + 1} modifier`} note={note(`experiences.${i}.value`)}>
              {(p, red) => (
                <input
                  {...p}
                  inputMode="numeric"
                  className={cn(control, "w-20", red)}
                  value={Number.isNaN(exp.value) ? "" : exp.value}
                  onChange={(e) => set("experiences", draft.experiences.map((x, j) => (j === i ? { ...x, value: toInt(e.target.value) } : x)))}
                />
              )}
            </Field>
            <BrandButton variant="danger" size="sm" onClick={() => set("experiences", draft.experiences.filter((_, j) => j !== i))} aria-label={`Remove Experience ${i + 1}`}>
              Remove
            </BrandButton>
          </div>
        ))}
        <BrandButton variant="neutral" size="sm" className="self-start" disabled={draft.experiences.length >= 12} onClick={() => set("experiences", [...draft.experiences, { name: "", value: 2 }])}>
          Add Experience
        </BrandButton>
      </fieldset>

      <Field label="Inventory (one item per line)" note={note("inventory")}>
        {(p, red) => (
          <textarea
            {...p}
            rows={4}
            className={cn(control, "py-2", red)}
            value={inventoryText}
            onChange={(e) => {
              setInventoryText(e.target.value);
              set(
                "inventory",
                e.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line !== ""),
              );
            }}
          />
        )}
      </Field>
      <Field label="Description" note={note("description")}>
        {(p, red) => <textarea {...p} rows={2} className={cn(control, "py-2", red)} value={draft.description} onChange={(e) => set("description", e.target.value)} />}
      </Field>

      <Field label="Owner" note={null}>
        {(p) => (
          <select {...p} className={control} value={ownerId} onChange={(e) => setOwnerId(e.target.value as Id<"users"> | "")}>
            <option value="">Choose…</option>
            {owners.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <p id={problemId} role="status" aria-live="polite" className="m-0 text-[14px] text-[#e0b84a] empty:hidden">
        {problem}
      </p>
      <p role="alert" className="m-0 text-[14px] text-danger empty:hidden">
        {error}
      </p>
      <BrandButton type="submit" variant="confirm" size="lg" className="self-start" disabled={problem !== null || saving} aria-describedby={problemId}>
        {saving ? "Saving…" : "Save character"}
      </BrandButton>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 font-display text-[18px] font-bold">{title}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{children}</div>
    </fieldset>
  );
}

/** The props a field's control spreads: its id and, when flagged, `aria-invalid` and the note as its description. */
type ControlProps = { id: string; "aria-invalid"?: true; "aria-describedby"?: string };

/** A labelled control; a flagged field gets a red border and its note, which describes the control (PS2). */
function Field({ label, note, children }: { label: string; note: Note; children: (props: ControlProps, flaggedClass: string) => ReactNode }) {
  const id = useId();
  const noteId = useId();
  const props: ControlProps = note ? { id, "aria-invalid": true, "aria-describedby": noteId } : { id };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[13px] text-[#c9d2cf]">
        {label}
      </label>
      {children(props, note ? flaggedControl : "")}
      {note ? (
        <span id={noteId} className="text-[12px] text-danger">
          {note}
        </span>
      ) : null}
    </div>
  );
}
