"use client";

import "./header.css";

import { DeathMoveModal } from "@/components/party/death";
import { DOMAIN_ICONS } from "@/components/party/party-display";
import { assetBackground } from "@/lib/design-assets";
import { getDomain, type ClassDef } from "@/lib/srd";

import { useSheet } from "../sheet-context";

// Header pieces of the sheet: the domain banner (status badge, name heading, class, domain emblems) and the
// death-move strip under the header row. The tabs, level circle and close button belong to the shell (sheet.tsx).
// Restyled by S9 (badges in the banner, parchment death-move dialog).

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

/** The domain banner: status badge, the character's name (the page's h1, which names the sheet), class and domains. */
export function SheetBanner({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, character } = useSheet();
  const domains = cls?.domains ?? [];
  return (
    <div className="cs-banner min-w-0 flex-[0_1_auto]" style={{ background: bannerBackground(domains) }}>
      {character.status !== "active" ? (
        <span className={`cs-status ${character.status === "dead" ? "bg-[#0a0606] text-[#c9bdb5]" : "bg-[#d9c8a8] text-[#3a2a14]"}`} data-testid="character-status">
          {STATUS_BADGE[character.status]}
          {character.status === "away" && character.away ? ` · ${AWAY_REASON[character.away.reason]}` : ""}
        </span>
      ) : null}
      <h1 id="sheet-title" className="cs-banner-name">
        {sheet.name}
      </h1>
      <span className="cs-banner-class">{cls?.name ?? sheet.classId}</span>
      <span className="cs-banner-doms">
        {domains.map((d) => (
          <span key={d} className="cs-dom-ic" role="img" aria-label={getDomain(d)?.name ?? d} style={{ backgroundImage: assetBackground(DOMAIN_ICONS[d] ?? "") }} />
        ))}
        <span aria-hidden="true">{domains.map((d) => getDomain(d)?.name ?? d).join(" & ")}</span>
      </span>
    </div>
  );
}

/** Death-move badges and the death-move modal (CB 106), under the header row. */
export function SheetDeathMoves() {
  const { slot } = useSheet();
  return <DeathMoveModal {...slot} />;
}
