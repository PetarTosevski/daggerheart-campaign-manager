"use client";

import "./story.css";

import { useState } from "react";

import { Label, PaperInput, PaperTextarea, Pill, SheetBox, Small, paperField } from "@/components/party/sheet-ui";
import type { ClassDef } from "@/lib/srd";
import { CLASSES } from "@/lib/srd/classes";
import { cn } from "@/lib/utils";

import { Stepper } from "../fields";
import { useSheet } from "../sheet-context";

// Story & Advancement boxes (board page 2): Wealth, Inventory, Character Description, Background Questions,
// Connections, and Notes (below the Level Up region).

/** Pips shown per coin kind (the board's 10); larger counts still go through the stepper. */
const WEALTH_PIPS = 10;

/** One row of handful or bag pips. Tapping a pip sets the count to it; tapping the last marked one clears it. */
function CoinPips({ kind, name, value, onSet }: { kind: "gold-hand" | "gold-bag"; name: string; value: number; onSet?: (next: number) => void }) {
  return (
    <div className="st-pips" aria-hidden={onSet ? undefined : true}>
      {Array.from({ length: WEALTH_PIPS }, (_, k) => {
        const on = k < value;
        if (!onSet) return <span key={k} className={cn(kind, on && "on")} />;
        return (
          <button
            key={k}
            type="button"
            className={cn(kind, on && "on")}
            aria-label={`${name} ${k + 1} of ${WEALTH_PIPS}`}
            aria-pressed={on}
            onClick={() => onSet(k + 1 === value ? k : k + 1)}
          />
        );
      })}
    </div>
  );
}

export function WealthBox() {
  const { sheet, canEdit, update } = useSheet();
  const g = sheet.gold;
  const set = (patch: Partial<typeof g>) => void update({ gold: { ...g, ...patch } });
  return (
    <SheetBox title="Wealth">
      <div className="st-wealth-head">
        <Label>Handfuls of coins</Label>
        <Stepper label="Handfuls of gold" value={g.handfuls} min={0} max={99} readOnly={!canEdit} onChange={(handfuls) => set({ handfuls })} />
      </div>
      <CoinPips kind="gold-hand" name="Handfuls" value={g.handfuls} onSet={canEdit ? (handfuls) => set({ handfuls }) : undefined} />
      <div className="st-wealth-head">
        <Label>Bags of coins</Label>
        <Stepper label="Bags of gold" value={g.bags} min={0} max={99} readOnly={!canEdit} onChange={(bags) => set({ bags })} />
      </div>
      <CoinPips kind="gold-bag" name="Bags" value={g.bags} onSet={canEdit ? (bags) => set({ bags }) : undefined} />
      {canEdit ? (
        <button type="button" className={cn("gold-chest", g.chest && "on")} aria-pressed={g.chest} onClick={() => set({ chest: !g.chest })}>
          <span className="gc-img" aria-hidden="true" />
          <span>Chest of coins</span>
        </button>
      ) : (
        <div className={cn("gold-chest", g.chest && "on")} role="img" aria-label={g.chest ? "Has a chest of coins" : "No chest of coins"}>
          <span className="gc-img" aria-hidden="true" />
          <span aria-hidden="true">{g.chest ? "Chest of coins" : "No chest"}</span>
        </div>
      )}
    </SheetBox>
  );
}

/** The board's starting inventory line, with the class's "take either ... OR ..." items. */
function startingInventory(cls: ClassDef) {
  const base = "Take a torch, 50ft of rope, basic supplies, and a handful of gold. Then choose between a minor health potion OR a minor stamina potion.";
  return cls.classItems ? `${base} And either ${cls.classItems}` : base;
}

export function InventoryBox({ className }: { className?: string }) {
  const { sheet, canEdit, update } = useSheet();
  // page-two.tsx passes no class here, so look it up from the leaf module (CL9).
  const cls = CLASSES.find((c) => c.id === sheet.classId);
  const [item, setItem] = useState("");
  return (
    <SheetBox title="Inventory" className={className}>
      {cls ? (
        <Small as="div" className="st-start">
          <strong>Starting inventory:</strong> {startingInventory(cls)}
        </Small>
      ) : null}
      <ul className="st-inv" aria-label="Inventory">
        {sheet.inventory.map((x, i) => (
          <li key={x.id} className="st-inv-row">
            <span className={paperField.locked}>{x.name}</span>
            {canEdit ? (
              <button type="button" className="st-inv-x" aria-label={`Remove ${x.name}`} onClick={() => void update({ inventory: sheet.inventory.filter((_, j) => j !== i) })}>
                ×
              </button>
            ) : null}
          </li>
        ))}
        {sheet.inventory.length === 0 ? (
          <li>
            <Small className="italic">Nothing carried.</Small>
          </li>
        ) : null}
      </ul>
      {canEdit && sheet.inventory.length < 60 ? (
        <form
          className="st-add"
          onSubmit={(e) => {
            e.preventDefault();
            const name = item.trim();
            if (!name) return;
            void update({ inventory: [...sheet.inventory, name] });
            setItem("");
          }}
        >
          <label>
            <span className="sr-only">New item</span>
            <PaperInput placeholder="Add an item" maxLength={200} value={item} onChange={(e) => setItem(e.target.value)} />
          </label>
          <Pill type="submit" variant="solid">
            Add
          </Pill>
        </form>
      ) : null}
    </SheetBox>
  );
}

/**
 * A lined paper textarea saved on blur. It shows the saved value while unfocused (CL7); after a save it keeps
 * the typed text until the live value catches up, and drops it if the save fails. Read-only viewers get text.
 */
function PaperText({
  label,
  labelClassName = "sh-lbl",
  hideLabel = false,
  value,
  maxLength,
  className,
  readOnly,
  onSave,
}: {
  label: string;
  labelClassName?: string;
  hideLabel?: boolean;
  value: string;
  maxLength: number;
  className?: string;
  readOnly: boolean;
  onSave: (next: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<{ text: string; base: string; editing: boolean } | null>(null);
  const labelEl = <span className={hideLabel ? "sr-only" : labelClassName}>{label}</span>;
  if (readOnly) {
    return (
      <div className="st-field">
        {labelEl}
        <p className={cn(paperField.textarea, "st-ro", className)}>{value || <span className="st-empty">—</span>}</p>
      </div>
    );
  }
  const shown = draft && (draft.editing || draft.base === value) ? draft.text : value;
  return (
    <label className="st-field">
      {labelEl}
      <PaperTextarea
        className={className}
        value={shown}
        maxLength={maxLength}
        onFocus={() => setDraft((d) => (d && !d.editing && d.base === value ? { ...d, editing: true } : { text: value, base: value, editing: true }))}
        onChange={(e) => {
          const text = e.target.value;
          setDraft((d) => ({ text, base: d?.base ?? value, editing: true }));
        }}
        onBlur={(e) => {
          const text = e.currentTarget.value;
          if (text === value) {
            setDraft(null);
            return;
          }
          setDraft({ text, base: draft?.base ?? value, editing: false });
          void onSave(text).then((ok) => {
            if (!ok) setDraft(null);
          });
        }}
      />
    </label>
  );
}

export function DescriptionBox({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, update } = useSheet();
  const prompts = [
    { label: "Clothes that are", text: cls?.clothes },
    { label: "Attitude like", text: cls?.attitude },
  ].filter((p) => p.text);
  return (
    <SheetBox title="Character Description">
      <Small className="italic">Choose one (or more) from each line, or make your own.</Small>
      {prompts.length > 0 ? (
        <ul className="st-prompts">
          {prompts.map((p) => (
            <li key={p.label}>
              <Label>{p.label}</Label>
              <Small className="italic">{p.text}</Small>
            </li>
          ))}
        </ul>
      ) : null}
      <PaperText label="Description" hideLabel value={sheet.description} maxLength={2000} readOnly={!canEdit} onSave={(description) => update({ description })} />
    </SheetBox>
  );
}

function QuestionList({
  title,
  intro,
  outro,
  questions,
  answers,
  field,
}: {
  title: string;
  intro: string;
  outro?: string;
  questions: readonly string[];
  answers: readonly string[];
  field: "background" | "connections";
}) {
  const { canEdit, update } = useSheet();
  const count = Math.max(questions.length, answers.length);
  const save = (i: number, text: string) => {
    const next = Array.from({ length: Math.max(count, i + 1) }, (_, j) => (j === i ? text : (answers[j] ?? "")));
    return update({ [field]: next });
  };
  return (
    <SheetBox title={title}>
      <Small className="italic">{intro}</Small>
      {count === 0 ? <Small as="p">No questions for this class.</Small> : null}
      {Array.from({ length: count }, (_, i) => (
        <PaperText
          key={i}
          label={questions[i] ?? `Your own question ${i + 1}`}
          labelClassName="st-q"
          className="st-q-ta"
          value={answers[i] ?? ""}
          maxLength={2000}
          readOnly={!canEdit}
          onSave={(text) => save(i, text)}
        />
      ))}
      {outro ? <Small className="italic">{outro}</Small> : null}
    </SheetBox>
  );
}

export function BackgroundBox({ cls }: { cls: ClassDef | undefined }) {
  const { sheet } = useSheet();
  return (
    <QuestionList
      title="Background Questions"
      intro="Answer the following background questions or make your own."
      outro="Then work with the GM to generate two starting Experiences for your character."
      questions={cls?.backgroundQuestions ?? []}
      answers={sheet.background}
      field="background"
    />
  );
}

export function ConnectionsBox({ cls }: { cls: ClassDef | undefined }) {
  const { sheet } = useSheet();
  return (
    <QuestionList
      title="Connections"
      intro="After sharing your characters, ask any of these questions to the others in your party or make your own."
      questions={cls?.connectionQuestions ?? []}
      answers={sheet.connections}
      field="connections"
    />
  );
}

export function NotesBox() {
  const { sheet, canEdit, update } = useSheet();
  return (
    <SheetBox title="Notes">
      <PaperText label="Notes" hideLabel className="st-notes" value={sheet.notes} maxLength={10000} readOnly={!canEdit} onSave={(notes) => update({ notes })} />
    </SheetBox>
  );
}
