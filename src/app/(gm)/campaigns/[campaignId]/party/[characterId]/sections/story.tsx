"use client";

import "./story.css";

import { useState } from "react";

import { SheetBox } from "@/components/party/sheet-ui";
import type { ClassDef } from "@/lib/srd";

import { Stepper, TextField } from "../fields";
import { useSheet } from "../sheet-context";

// Story & Advancement boxes (board page 2): Wealth, Inventory, Character Description, Background Questions,
// Connections, and Notes (below the Level Up region). Restyled by S11.

export function WealthBox() {
  const { sheet, canEdit, update } = useSheet();
  const g = sheet.gold;
  return (
    <SheetBox title="Wealth">
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
    </SheetBox>
  );
}

export function InventoryBox({ className }: { className?: string }) {
  const { sheet, canEdit, update } = useSheet();
  const [item, setItem] = useState("");
  return (
    <SheetBox title="Inventory" className={className}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Inventory">
        {sheet.inventory.map((x, i) => (
          <li key={x.id} className="flex min-h-11 items-center gap-2 border-b border-[#e0cfa8] text-[17px]">
            <span className="flex-1">{x.name}</span>
            {canEdit ? (
              <button type="button" className="cs-step" aria-label={`Remove ${x.name}`} onClick={() => void update({ inventory: sheet.inventory.filter((_, j) => j !== i) })}>
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
    </SheetBox>
  );
}

export function DescriptionBox({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, update } = useSheet();
  return (
    <SheetBox title="Character Description">
      {cls && (cls.clothes || cls.attitude) ? (
        <p className="cs-small m-0 italic">
          {cls.clothes ? `Clothes that are ${cls.clothes}. ` : ""}
          {cls.attitude ? `Attitude like ${cls.attitude}.` : ""}
        </p>
      ) : null}
      <TextField label="Description" hideLabel value={sheet.description} multiline rows={3} maxLength={2000} readOnly={!canEdit} onSave={(description) => void update({ description })} />
    </SheetBox>
  );
}

function QuestionList({
  title,
  intro,
  questions,
  answers,
  field,
}: {
  title: string;
  intro: string;
  questions: readonly string[];
  answers: readonly string[];
  field: "background" | "connections";
}) {
  const { canEdit, update } = useSheet();
  const count = Math.max(questions.length, answers.length);
  const save = (i: number, text: string) => {
    const next = Array.from({ length: Math.max(count, i + 1) }, (_, j) => (j === i ? text : (answers[j] ?? "")));
    void update({ [field]: next });
  };
  return (
    <SheetBox title={title}>
      <p className="cs-small m-0 italic">{intro}</p>
      {count === 0 ? <p className="cs-small m-0">No questions for this class.</p> : null}
      {Array.from({ length: count }, (_, i) => (
        <TextField
          key={i}
          label={questions[i] ?? `Your own question ${i + 1}`}
          value={answers[i] ?? ""}
          multiline
          rows={3}
          maxLength={2000}
          labelClassName="text-[17px] font-semibold leading-snug text-[#2a1f14]"
          readOnly={!canEdit}
          onSave={(text) => save(i, text)}
        />
      ))}
    </SheetBox>
  );
}

export function BackgroundBox({ cls }: { cls: ClassDef | undefined }) {
  const { sheet } = useSheet();
  return (
    <QuestionList
      title="Background Questions"
      intro="Answer the background questions or make your own."
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
      intro="Ask these questions of the others in your party, or make your own."
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
      <TextField label="Notes" hideLabel value={sheet.notes} multiline rows={8} maxLength={10000} readOnly={!canEdit} onSave={(notes) => void update({ notes })} />
    </SheetBox>
  );
}
