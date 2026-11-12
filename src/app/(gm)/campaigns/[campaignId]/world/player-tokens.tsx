"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Component, type ReactNode } from "react";

import { BrandButton, brandButton } from "@/components/brand/buttons";
import type { MapToken } from "@/lib/world/map-state";
import { tokenType, type TokenType } from "@/lib/world/token-types";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { TokenIcon } from "./palette";

/*
 * The players' World map (dcm-yzxx): the markers they can see, read-only. The board passes only markers the viewer
 * may see (the server's `playerMapView`, or the GM's preview of it), so nothing here filters for secrecy except the
 * Codex link, which comes from `codex.mapLinks` (known locations with a visible marker only).
 */

/** The Codex page opened on one entry (the page selects `?entry=` once it is in the viewer's list). */
export const codexEntryHref = (campaignId: string, entryId: string) => `/campaigns/${campaignId}/codex?entry=${entryId}`;

export type CodexMapLink = { tokenId: number; entryId: string; known: boolean };

/** The Codex entry a marker opens: the first linked one (oldest), only a known one when `knownOnly` (the GM's player preview). */
export function codexEntryFor(links: readonly CodexMapLink[] | undefined, tokenId: number, knownOnly: boolean): string | null {
  return links?.find((l) => l.tokenId === tokenId && (!knownOnly || l.known))?.entryId ?? null;
}

/** The selected marker's details, read-only: a card over the map's bottom-right corner (every width, full screen too). */
export function PlayerTokenDetails({
  token,
  types,
  fromParty,
  distances,
  codexLink,
  onClose,
}: {
  token: MapToken;
  types: TokenType[];
  fromParty: string;
  distances: { name: string; text: string }[];
  codexLink?: ReactNode;
  onClose: () => void;
}) {
  const type = tokenType(types, token.type);
  const name = token.name || type.label;
  return (
    <section aria-label={`About ${name}`} className="w-tokinfo flex flex-col gap-2.5 rounded-[14px] border border-[#3a3020] bg-[#141e22] p-4">
      <div className="flex items-center gap-2.5">
        <TokenIcon type={type} size={34} icon={20} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-[12px] tracking-[0.14em] text-[#c8b48a] uppercase">{type.label}</span>
          <h2 className="m-0 overflow-hidden font-display text-[18px] font-bold text-ellipsis whitespace-nowrap">{name}</h2>
        </div>
        <BrandButton variant="tool" icon size="sm" aria-label="Close details" onClick={onClose}>
          ✕
        </BrandButton>
      </div>
      {token.location ? <span className="text-[13px] text-[#c8b48a]">📍 Location</span> : null}
      {fromParty ? (
        <div className="rounded-[10px] border border-[#5a4a2a] bg-[#2a2416] px-3 py-2.5 text-[13px] text-[#f3dfb0]">
          <strong className="font-display">From the party:</strong> {fromParty}
        </div>
      ) : null}
      {distances.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] tracking-[0.1em] text-[#9fb2b6] uppercase">Distances</span>
          {distances.map((d, i) => (
            <div key={i} className="flex justify-between gap-2 border-b border-[#1f2b30] py-1 text-[13px]">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{d.name}</span>
              <span className="flex-none text-[#c8b48a]">{d.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      {codexLink}
    </section>
  );
}

/** Right column (below the map on narrower screens): every marker the viewer can see; a click selects and centres it. */
export function PlayerTokenPanel({
  tokens,
  types,
  selectedId,
  onSelect,
}: {
  tokens: MapToken[];
  types: TokenType[];
  selectedId: number | null;
  onSelect: (token: MapToken) => void;
}) {
  return (
    <aside aria-label="Markers on the map" className="w-side flex flex-col gap-3.5">
      <section aria-labelledby="onmap-h" className="flex flex-col gap-2 rounded-[14px] border border-[#253338] bg-[#141e22] p-4">
        <div className="flex items-baseline justify-between">
          <h2 id="onmap-h" className="m-0 font-display text-[18px] font-bold">
            On the map
          </h2>
          <span className="text-[13px] text-[#9fb2b6]">
            {tokens.length} {tokens.length === 1 ? "marker" : "markers"}
          </span>
        </div>
        {tokens.length === 0 ? <p className="m-0 text-[14px] text-[#9fb2b6]">No markers have been revealed yet.</p> : null}
        {tokens.map((t) => {
          const ty = tokenType(types, t.type);
          const on = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t)}
              aria-current={on ? "true" : undefined}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-left text-[13px] text-[#e6ecea]"
              style={{ borderColor: on ? "#e3b45a" : "transparent", background: on ? "#2a2416" : "transparent" }}
            >
              <TokenIcon type={ty} size={24} icon={13} />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t.name || ty.label}</span>
              {t.location ? (
                <span aria-label="location" className="flex-none text-[12px] text-[#c8b48a]">
                  📍
                </span>
              ) : null}
            </button>
          );
        })}
      </section>
    </aside>
  );
}

/** "Open in Codex" for a marker linked to a Codex location the viewer may see; nothing otherwise. */
function CodexLinkQuery({ campaignId, tokenId, knownOnly }: { campaignId: Id<"campaigns">; tokenId: number; knownOnly: boolean }) {
  const links = useQuery(api.codex.mapLinks, { campaignId });
  const entryId = codexEntryFor(links, tokenId, knownOnly);
  if (entryId === null) return null;
  return (
    <Link href={codexEntryHref(campaignId, entryId)} className={brandButton({ variant: "neutral", className: "self-start no-underline" })}>
      📖 Open in Codex
    </Link>
  );
}

/** A failing link query hides the link instead of the map (CL1). */
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The Codex link in its own error boundary. */
export function CodexLink(props: { campaignId: Id<"campaigns">; tokenId: number; knownOnly: boolean }) {
  return (
    <QuietBoundary>
      <CodexLinkQuery {...props} />
    </QuietBoundary>
  );
}
