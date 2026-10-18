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

import type { Id } from "../../../../convex/_generated/dataModel";

export type Owner = { userId: Id<"users">; name: string };

const ALL_WEAPONS = [...WEAPONS, ...TIERED_WEAPONS];
const ALL_ARMOR = [...ARMOR, ...TIERED_ARMOR];

const control = "min-h-10 w-full rounded-lg border border-line-2 bg-[#0f0d15] px-3 text-[15px] text-parchment";

/** Whole numbers from a text field; anything else becomes NaN, which the draft check refuses. */
const toInt = (value: string) => (/^-?\d+$/.test(value.trim()) ? Number.parseInt(value, 10) : Number.NaN);

/** The draft with an optional item set, or removed when `id` is empty ("None"). */
function withOptional(draft: ImportDraft, key: "secondaryWeaponId" | "armorId", id: string): ImportDraft {
  const next = { ...draft };
  if (id) next[key] = id;
  else delete next[key];
  return next;
}

type Props = {
  initial: ImportDraft;
  unreadable: string[];
  unmatched: Unmatched[];
  hopeAndFear: boolean;
  owners: Owner[];
  defaultOwner?: Id<"users">;
  saving: boolean;
  error: string | null;
  onSave: (draft: ImportDraft, ownerId: Id<"users">) => void;
};

/**
 * The review screen: every field of the read draft is editable, fields Claude
 * couldn't read or match are highlighted, the GM picks the owner, and Save
 * stays disabled until the draft passes the same checks the server runs.
 */
export function ReviewForm({ initial, unreadable, unmatched, hopeAndFear, owners, defaultOwner, saving, error, onSave }: Props) {
  const [draft, setDraft] = useState<ImportDraft>(initial);
  const [inventoryText, setInventoryText] = useState(initial.inventory.join("\n"));
  const [ownerId, setOwnerId] = useState<Id<"users"> | "">(defaultOwner ?? "");
  const problemId = useId();
  const sources: Source[] = hopeAndFear ? ["core", "hope-and-fear"] : ["core"];
  const usable = <T extends { source: Source }>(list: readonly T[]) => list.filter((item) => sources.includes(item.source));
  const set = <K extends keyof ImportDraft>(key: K, value: ImportDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const note = (path: string): string | null => {
    const miss = unmatched.find((u) => u.field === path);
    if (miss) return `Read as “${miss.text}”, which matched nothing. Check it.`;
    return unreadable.includes(path) ? "Couldn't be read. Check it." : null;
  };

  const tier = tierForLevel(Number.isInteger(draft.level) ? Math.min(10, Math.max(1, draft.level)) : 1);
  const cls = CLASSES.find((c) => c.id === draft.classId);
  const weapons = usable(ALL_WEAPONS).filter((w) => w.tier <= tier && (!w.classId || w.classId === draft.classId));
  const cards = usable(DOMAIN_CARDS)
    .filter((c) => cls?.domains.includes(c.domain) && c.level <= draft.level)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const missedCards = unmatched.filter((u) => u.field.startsWith("domainCards."));
  const problem = importProblem(draft, hopeAndFear) ?? (ownerId === "" ? "Choose who owns the character." : null);

  const number = (label: string, key: "level" | "evasion" | "hpMax" | "hp" | "stressMax" | "stress" | "hope" | "armorMarked" | "proficiency") => (
    <Field label={label} note={note(key)}>
      {(id, flagged) => (
        <input id={id} inputMode="numeric" className={cn(control, flagged)} value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={(e) => set(key, toInt(e.target.value))} />
      )}
    </Field>
  );

  const select = (label: string, path: string, value: string, options: { id: string; name: string }[], onChange: (id: string) => void, none?: string) => (
    <Field label={label} note={note(path)}>
      {(id, flagged) => (
        <select id={id} className={cn(control, flagged)} value={value} onChange={(e) => onChange(e.target.value)}>
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

  return (
    <form
      className="flex flex-col gap-5"
      aria-label="Review the imported character"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem === null && ownerId !== "") onSave(draft, ownerId);
      }}
    >
      <p className="m-0 text-[14px] text-[#c9d2cf]">Check every field against the paper sheet. Highlighted fields need a look.</p>

      <Section title="Character">
        <Field label="Name" note={note("name")}>
          {(id, flagged) => <input id={id} className={cn(control, flagged)} value={draft.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="Pronouns" note={null}>
          {(id) => <input id={id} className={control} value={draft.pronouns} onChange={(e) => set("pronouns", e.target.value)} />}
        </Field>
        {number("Level", "level")}
        {select("Class", "classId", draft.classId, usable(CLASSES), (id) => setDraft((d) => ({ ...d, classId: id, subclassId: "" })))}
        {select("Subclass", "subclassId", draft.subclassId, usable(SUBCLASSES).filter((s) => s.classId === draft.classId), (id) => set("subclassId", id))}
        {select("Community", "communityId", draft.communityId, usable(COMMUNITIES), (id) => set("communityId", id))}
        <Field label="Ancestry type" note={null}>
          {(id) => (
            <select
              id={id}
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
            {(id, flagged) => (
              <input
                id={id}
                inputMode="numeric"
                className={cn(control, flagged)}
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
          {(id, flagged) => (
            <input id={id} inputMode="numeric" className={cn(control, flagged)} value={Number.isNaN(draft.gold.handfuls) ? "" : draft.gold.handfuls} onChange={(e) => set("gold", { ...draft.gold, handfuls: toInt(e.target.value) })} />
          )}
        </Field>
        <Field label="Bags of gold" note={note("gold.bags")}>
          {(id, flagged) => (
            <input id={id} inputMode="numeric" className={cn(control, flagged)} value={Number.isNaN(draft.gold.bags) ? "" : draft.gold.bags} onChange={(e) => set("gold", { ...draft.gold, bags: toInt(e.target.value) })} />
          )}
        </Field>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={draft.gold.chest} onChange={(e) => set("gold", { ...draft.gold, chest: e.target.checked })} />
          Chest of gold
        </label>
      </Section>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 font-display text-[18px] font-bold">Domain cards</legend>
        {missedCards.length > 0 ? (
          <p className="m-0 rounded-lg border border-[#c9a227] px-3 py-2 text-[14px]">Couldn&apos;t match: {missedCards.map((m) => `“${m.text}”`).join(", ")}. Tick the right cards below.</p>
        ) : null}
        {cards.length === 0 ? <p className="m-0 text-[14px] text-[#9fb2b6]">Choose a class to list its domain cards.</p> : null}
        <div className="grid max-h-[240px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1 overflow-y-auto">
          {cards.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={draft.domainCards.includes(c.id)}
                onChange={(e) => set("domainCards", e.target.checked ? [...draft.domainCards, c.id] : draft.domainCards.filter((id) => id !== c.id))}
              />
              {c.name} <span className="text-[#9fb2b6]">(level {c.level})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 font-display text-[18px] font-bold">Experiences</legend>
        {draft.experiences.map((exp, i) => (
          // Rows get ids only when saved; the position is the row's identity while editing.
          <div key={i} className="flex items-end gap-2">
            <Field label={`Experience ${i + 1}`} note={note(`experiences.${i}.name`)}>
              {(id, flagged) => (
                <input id={id} className={cn(control, flagged)} value={exp.name} onChange={(e) => set("experiences", draft.experiences.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              )}
            </Field>
            <Field label={`Experience ${i + 1} modifier`} note={note(`experiences.${i}.value`)}>
              {(id, flagged) => (
                <input
                  id={id}
                  inputMode="numeric"
                  className={cn(control, "w-20", flagged)}
                  value={Number.isNaN(exp.value) ? "" : exp.value}
                  onChange={(e) => set("experiences", draft.experiences.map((x, j) => (j === i ? { ...x, value: toInt(e.target.value) } : x)))}
                />
              )}
            </Field>
            <BrandButton size="sm" onClick={() => set("experiences", draft.experiences.filter((_, j) => j !== i))} aria-label={`Remove Experience ${i + 1}`}>
              Remove
            </BrandButton>
          </div>
        ))}
        <BrandButton size="sm" className="self-start" disabled={draft.experiences.length >= 12} onClick={() => set("experiences", [...draft.experiences, { name: "", value: 2 }])}>
          Add Experience
        </BrandButton>
      </fieldset>

      <Field label="Inventory (one item per line)" note={null}>
        {(id) => (
          <textarea
            id={id}
            rows={4}
            className={cn(control, "py-2")}
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
      <Field label="Description" note={null}>
        {(id) => <textarea id={id} rows={2} className={cn(control, "py-2")} value={draft.description} onChange={(e) => set("description", e.target.value)} />}
      </Field>

      <Field label="Owner" note={null}>
        {(id) => (
          <select id={id} className={control} value={ownerId} onChange={(e) => setOwnerId(e.target.value as Id<"users"> | "")}>
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
      <BrandButton type="submit" variant="primary" size="lg" className="self-start" disabled={problem !== null || saving} aria-describedby={problemId}>
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

/** A labelled control; a flagged field gets an amber border and its note. */
function Field({ label, note, children }: { label: string; note: string | null; children: (id: string, flaggedClass: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[13px] text-[#c9d2cf]">
        {label}
      </label>
      {children(id, note ? "border-[#c9a227] ring-1 ring-[#c9a227]" : "")}
      {note ? <span className="text-[12px] text-[#e0b84a]">{note}</span> : null}
    </div>
  );
}
