"use client";

import { Lock } from "lucide-react";

import { assetBackground } from "@/lib/design-assets";
import { getSubclass, PORTRAITS, type ClassDef, type Feature } from "@/lib/srd";

import { TextField } from "./fields";
import { useSheet } from "./sheet-context";
import { heritageCards } from "./sheet-helpers";

function Features({ features }: { features: readonly Feature[] }) {
  return (
    <div className="flex flex-col gap-2">
      {features.map((f) => (
        <p key={f.name} className="cs-hc-text">
          <strong>{f.name}</strong>
          {f.text ? `: ${f.text}` : ""}
        </p>
      ))}
    </div>
  );
}

function HeritageCardView({
  kind,
  name,
  tier,
  sub,
  features,
  art,
  note,
  locked,
}: {
  kind: string;
  name: string;
  tier?: string;
  sub?: string;
  features: readonly Feature[];
  art?: { asset: string; position: string };
  note?: string;
  locked?: string;
}) {
  return (
    <article className={`cs-hc${locked ? " locked" : ""}`} aria-label={`${kind}: ${name}${tier ? ` ${tier}` : ""}${locked ? " (locked)" : ""}`}>
      <div
        className="cs-hc-art"
        style={art ? { backgroundImage: assetBackground(art.asset), backgroundPosition: art.position } : undefined}
      >
        <span className="cs-hc-kind">{kind}</span>
      </div>
      <div className="cs-hc-body">
        <div className="cs-hc-head">
          <h4 className="cs-hc-name">{name}</h4>
          {tier ? <span className="cs-hc-tier">{tier}</span> : null}
        </div>
        {sub ? <span className="cs-hc-sub">{sub}</span> : null}
        <Features features={features} />
        {note ? <p className="cs-small m-0 italic">{note}</p> : null}
        {locked ? (
          <span className="cs-hc-lock inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" />
            {locked}
          </span>
        ) : null}
      </div>
    </article>
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
    <section className="cs-box" aria-label={title}>
      <h3 className="cs-h">{title}</h3>
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
    </section>
  );
}

export function PageThree({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, update } = useSheet();
  const subclass = getSubclass(sheet.subclassId);
  const subArt = PORTRAITS[`sub-${sheet.subclassId}`];
  const heritage = heritageCards(sheet);
  const spellcast = subclass?.spellcastTrait ? `Spellcast trait: ${subclass.spellcastTrait[0].toUpperCase()}${subclass.spellcastTrait.slice(1)}` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <p className="cs-small m-0 italic">Your subclass, ancestry and community cards. They’re always active and don’t count toward your domain card limit.</p>
      <div className="cs-cards" role="list" aria-label="Heritage and subclass cards">
        {subclass ? (
          <>
            <div role="listitem">
              <HeritageCardView kind="Subclass" name={subclass.name} tier="Foundation" sub={spellcast} features={subclass.foundation} art={subArt} />
            </div>
            <div role="listitem">
              <HeritageCardView
                kind="Subclass"
                name={subclass.name}
                tier="Specialization"
                features={subclass.specialization}
                art={subArt}
                locked="Unlocks with your first upgraded subclass card"
              />
            </div>
            <div role="listitem">
              <HeritageCardView
                kind="Subclass"
                name={subclass.name}
                tier="Mastery"
                features={subclass.mastery}
                art={subArt}
                locked="Unlocks with your second upgraded subclass card"
              />
            </div>
          </>
        ) : null}
        {heritage.map((c) => (
          <div role="listitem" key={c.key}>
            <HeritageCardView kind={c.kind} name={c.name} features={c.features} art={c.art} note={c.note} />
          </div>
        ))}
      </div>

      <section className="cs-box" aria-label="Character description">
        <h3 className="cs-h">Description</h3>
        {cls && (cls.clothes || cls.attitude) ? (
          <p className="cs-small m-0 italic">
            {cls.clothes ? `Clothes that are ${cls.clothes}. ` : ""}
            {cls.attitude ? `Attitude like ${cls.attitude}.` : ""}
          </p>
        ) : null}
        <TextField label="Description" hideLabel value={sheet.description} multiline rows={3} maxLength={2000} readOnly={!canEdit} onSave={(description) => void update({ description })} />
      </section>

      <div className="cs-grid">
        <QuestionList
          title="Background"
          intro="Answer the background questions or make your own."
          questions={cls?.backgroundQuestions ?? []}
          answers={sheet.background}
          field="background"
        />
        <QuestionList
          title="Connections"
          intro="Ask these questions of the others in your party, or make your own."
          questions={cls?.connectionQuestions ?? []}
          answers={sheet.connections}
          field="connections"
        />
      </div>

      <section className="cs-box" aria-label="Notes">
        <h3 className="cs-h">Notes</h3>
        <TextField label="Notes" hideLabel value={sheet.notes} multiline rows={8} maxLength={10000} readOnly={!canEdit} onSave={(notes) => void update({ notes })} />
      </section>
    </div>
  );
}
