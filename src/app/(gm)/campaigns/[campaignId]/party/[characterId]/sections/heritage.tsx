"use client";

import "./heritage.css";

import { HeroCard } from "@/components/party/hero-card";
import { getClass, getDomain, getSubclass, PORTRAITS, type SubclassDef } from "@/lib/srd";

import { useSheet } from "../sheet-context";
import { heritageCards } from "../sheet-helpers";

// Domains > Heritage & Subclass (board page 3): subclass cards with rank locks, multiclass cards, ancestry and
// community cards, as the board's hero cards (HeroCard, src/components/party/hero-card.tsx).

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
        <HeroCard
          kind="Multiclass"
          name={cls?.name ?? multiclass.classId}
          sub={`Domain: ${domain}`}
          features={cls?.classFeatures ?? []}
          art={PORTRAITS[`sub-${multiclass.subclassId}`]}
        />
      </div>
      <div role="listitem">
        <HeroCard
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
      <p className="sh-small m-0 italic">Your subclass, ancestry and community cards. They’re always active and don’t count toward your domain card limit.</p>
      <div className="hc-grid" role="list" aria-label="Heritage and subclass cards">
        {subclass ? (
          <>
            <div role="listitem">
              <HeroCard kind="Subclass" name={subclass.name} tier="Foundation" sub={spellcast} features={subclass.foundation} art={subArt} />
            </div>
            <div role="listitem">
              <HeroCard
                kind="Subclass"
                name={subclass.name}
                tier="Specialization"
                features={subclass.specialization}
                art={subArt}
                locked={specializationLock}
              />
            </div>
            <div role="listitem">
              <HeroCard
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
            <HeroCard kind={c.kind} name={c.name} features={c.features} art={c.art} note={c.note} />
          </div>
        ))}
      </div>
    </div>
  );
}
