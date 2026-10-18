"use client";

import "./heritage.css";

import { Lock } from "lucide-react";

import { assetBackground } from "@/lib/design-assets";
import { getClass, getDomain, getSubclass, PORTRAITS, type Feature, type SubclassDef } from "@/lib/srd";

import { useSheet } from "../sheet-context";
import { heritageCards } from "../sheet-helpers";

// Domains > Heritage & Subclass (board page 3): subclass cards with rank locks, multiclass cards, ancestry and
// community cards. Restyled by S12.

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

const spellcastLine = (sub: SubclassDef | undefined) =>
  sub?.spellcastTrait ? `Spellcast trait: ${sub.spellcastTrait[0].toUpperCase()}${sub.spellcastTrait.slice(1)}` : undefined;

/** Multiclass (CB 111): the second class's class feature and chosen domain, and one foundation card. */
function MulticlassCards({ multiclass }: { multiclass: { classId: string; domainId: string; subclassId: string } }) {
  const cls = getClass(multiclass.classId);
  const sub = getSubclass(multiclass.subclassId);
  const domain = getDomain(multiclass.domainId)?.name ?? multiclass.domainId;
  return (
    <>
      <div role="listitem">
        <HeritageCardView kind="Multiclass" name={cls?.name ?? multiclass.classId} sub={`Domain: ${domain}`} features={cls?.classFeatures ?? []} />
      </div>
      <div role="listitem">
        <HeritageCardView
          kind="Multiclass subclass"
          name={sub?.name ?? multiclass.subclassId}
          tier="Foundation"
          sub={spellcastLine(sub)}
          features={sub?.foundation ?? []}
          art={PORTRAITS[`sub-${multiclass.subclassId}`]}
        />
      </div>
    </>
  );
}

/** How many cards the Heritage & Subclass tab shows (its count badge). */
export function heritageCardCount(sheet: ReturnType<typeof useSheet>["sheet"]): number {
  return (getSubclass(sheet.subclassId) ? 3 : 0) + (sheet.multiclass ? 2 : 0) + heritageCards(sheet).length;
}

export function HeritageSection() {
  const { sheet } = useSheet();
  const subclass = getSubclass(sheet.subclassId);
  const subArt = PORTRAITS[`sub-${sheet.subclassId}`];
  const heritage = heritageCards(sheet);
  const spellcast = spellcastLine(subclass);
  // Upgraded subclass cards (CB 110); multiclassing crosses out the mastery card (CB 111).
  const rank = sheet.subclassRank;
  const specializationLock = rank === "foundation" ? "Unlocks with your first upgraded subclass card" : undefined;
  const masteryLock =
    rank === "mastery" ? undefined : sheet.multiclass ? "Crossed out: you multiclassed" : "Unlocks with your second upgraded subclass card";

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
                locked={specializationLock}
              />
            </div>
            <div role="listitem">
              <HeritageCardView
                kind="Subclass"
                name={subclass.name}
                tier="Mastery"
                features={subclass.mastery}
                art={subArt}
                locked={masteryLock}
              />
            </div>
          </>
        ) : null}
        {sheet.multiclass ? <MulticlassCards multiclass={sheet.multiclass} /> : null}
        {heritage.map((c) => (
          <div role="listitem" key={c.key}>
            <HeritageCardView kind={c.kind} name={c.name} features={c.features} art={c.art} note={c.note} />
          </div>
        ))}
      </div>
    </div>
  );
}
