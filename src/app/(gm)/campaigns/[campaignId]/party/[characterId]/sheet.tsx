"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { BackLink } from "@/components/brand/brand";
import { brandButton } from "@/components/brand/buttons";
import { DeathMoveModal } from "@/components/party/death";
import { LevelUpButton } from "@/components/party/level-up";
import { getClass, getDomain } from "@/lib/srd";

import { api } from "../../../../../../../convex/_generated/api";
import { useCampaign } from "../../campaign-shell";

import { PageOne } from "./page-one";
import { PageThree } from "./page-three";
import { PageTwo } from "./page-two";
import { SheetProvider, useSheet } from "./sheet-context";

const PAGES = [
  { id: "sheet", label: "Character Sheet" },
  { id: "domains", label: "Domain Cards" },
  { id: "story", label: "Heritage & Story" },
] as const;

type PageId = (typeof PAGES)[number]["id"];

const STATUS_BADGE = { dead: "Dead", retired: "Retired", away: "Away" } as const;
/** Castle High less-lethal (HF 127): where an `away` character went. */
const AWAY_REASON = { infirmary: "in the infirmary", sentHome: "sent home" } as const;

function bannerBackground(domains: readonly string[]): string {
  const [a, b] = domains.map((d) => getDomain(d)?.color ?? "#5b2b2b");
  const second = b ?? a ?? "#5b2b2b";
  return (
    "radial-gradient(circle at 84% 50%, rgba(255,255,255,0.10) 0 16%, transparent 17%), " +
    "radial-gradient(ellipse at 50% 120%, rgba(0,0,0,0.35), transparent 60%), " +
    `linear-gradient(100deg, ${a ?? "#5b2b2b"} 0%, ${a ?? "#5b2b2b"} 34%, ${second} 66%, ${second} 100%)`
  );
}

function SheetBody({ extras }: { extras?: ReactNode }) {
  const { sheet, character, canEdit, error, slot } = useSheet();
  const [page, setPage] = useState<PageId>("sheet");
  const cls = getClass(sheet.classId);
  const domains = cls?.domains ?? [];

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = PAGES.findIndex((p) => p.id === page);
    const next = e.key === "ArrowRight" ? (i + 1) % PAGES.length : e.key === "ArrowLeft" ? (i + PAGES.length - 1) % PAGES.length : -1;
    if (next < 0) return;
    e.preventDefault();
    setPage(PAGES[next].id);
    document.getElementById(`tab-${PAGES[next].id}`)?.focus();
  }

  return (
    <article className="cs-paper" aria-labelledby="sheet-title">
      <header className="flex flex-wrap items-center gap-3">
        <div className="cs-banner min-w-0 flex-[1_1_280px]" style={{ background: bannerBackground(domains) }}>
          <span className="cs-banner-name">{cls?.name ?? sheet.classId}</span>
          <span className="cs-banner-doms">{domains.map((d) => getDomain(d)?.name ?? d).join(" & ")}</span>
        </div>
        <div className="cs-tabs flex-[1_1_auto]" role="tablist" aria-label="Sheet pages" onKeyDown={onTabKey}>
          {PAGES.map((p) => (
            <button
              key={p.id}
              id={`tab-${p.id}`}
              type="button"
              role="tab"
              className="cs-tab flex-1"
              aria-selected={page === p.id}
              aria-controls={`panel-${p.id}`}
              tabIndex={page === p.id ? 0 : -1}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="cs-lvl" role="img" aria-label={`Level ${sheet.level}`}>
          <strong aria-hidden="true">{sheet.level}</strong>
          <span aria-hidden="true">LEVEL</span>
        </div>
        <LevelUpButton {...slot} />
      </header>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 id="sheet-title" className="m-0 font-display text-[28px] leading-tight font-bold sm:text-[34px]">
          {sheet.name}
        </h1>
        {sheet.pronouns ? <span className="text-[17px] text-[#6a5236] italic">{sheet.pronouns}</span> : null}
        {character.status !== "active" ? (
          <span className={`cs-status ${character.status === "dead" ? "bg-[#5b2b2b] text-[#f6ead2]" : "bg-[#d9c8a8] text-[#3a2a14]"}`} data-testid="character-status">
            {STATUS_BADGE[character.status]}
            {character.status === "away" && character.away ? ` · ${AWAY_REASON[character.away.reason]}` : ""}
          </span>
        ) : null}
        {!canEdit ? (
          <span className="cs-small ml-auto italic" data-testid="read-only-note">
            Read only: only the player and the GM can change this sheet.
          </span>
        ) : null}
      </div>

      <p role="alert" aria-live="assertive" className="m-0 rounded-lg bg-[#5b2b2b] px-3 py-2 text-[15px] text-[#f6ead2] empty:hidden">
        {error}
      </p>

      {PAGES.map((p) => (
        <div key={p.id} id={`panel-${p.id}`} role="tabpanel" aria-labelledby={`tab-${p.id}`} hidden={page !== p.id}>
          {page === p.id ? (
            p.id === "sheet" ? (
              <PageOne cls={cls} extras={extras} />
            ) : p.id === "domains" ? (
              <PageTwo cls={cls} />
            ) : (
              <PageThree cls={cls} />
            )
          ) : null}
        </div>
      ))}

      <p className="cs-small m-0 border-t border-[#d1b98b] pt-3 text-right italic">
        {canEdit ? "All changes save automatically." : "Updates live as the table plays."}
      </p>
      <DeathMoveModal {...slot} />
    </article>
  );
}

/** The 3-page character sheet; owner and GM edit, everyone else in the campaign reads. */
export function CharacterSheetView({ characterId, extras }: { characterId: string; extras?: ReactNode }) {
  const campaign = useCampaign();
  const character = useQuery(api.characters.get, { characterId });
  const rosterHref = `/campaigns/${campaign._id}/party`;

  if (character === undefined) {
    return <main className="mx-auto max-w-[1180px] px-4 py-12 text-muted-text sm:px-6">Loading character…</main>;
  }
  if (character === null) {
    return (
      <main className="mx-auto flex max-w-[1180px] flex-col items-center gap-5 px-4 py-16 text-center text-parchment">
        <h1 className="font-display text-[32px] font-bold">Character not found</h1>
        <p className="text-muted-text">It may have been deleted, or it belongs to another campaign.</p>
        <Link href={rosterHref} className={brandButton({ variant: "solid", size: "lg" })}>
          Back to the party
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-[1236px] flex-col gap-4 px-2 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center gap-3 px-2">
        <BackLink href={rosterHref} label="Back to the party" className="border-white/25 bg-black/30" />
        <span className="text-[13px] tracking-[0.3em] text-[#c9d2cf] uppercase">Party · Character sheet</span>
      </div>
      <SheetProvider character={character} campaignId={campaign._id} isGm={campaign.role === "gm"} hopeAndFear={Boolean(campaign.options.hopeAndFear)}>
        <SheetBody extras={extras} />
      </SheetProvider>
    </main>
  );
}
