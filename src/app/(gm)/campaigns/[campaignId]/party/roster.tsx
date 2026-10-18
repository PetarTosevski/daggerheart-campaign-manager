"use client";

import { derivedDefense } from "@/lib/domain/characters/derived";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { LevelUpRosterBadge } from "@/components/party/level-up";
import { BenchButton, FallenOverlay } from "@/components/party/party-card";
import { domainBanner, DOMAIN_ICONS, heritageLine, ownerLabel, type Table } from "@/components/party/party-display";
import { CharacterPortrait, PortraitUpload } from "@/components/party/portrait";
import type { SlotProps } from "@/components/party/slots";
import { errorMessage } from "@/lib/convex-errors";
import { hopeMax } from "@/lib/domain/characters";
import { assetBackground } from "@/lib/design-assets";
import { FRAME_OF } from "@/lib/frames/extras/common";
import { getClass, getDomain, getSubclass } from "@/lib/srd";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../../../convex/characters";
import { useCampaign } from "../campaign-shell";

const SMALL_BTN =
  "inline-flex min-h-10 cursor-pointer items-center rounded-[9px] border border-[#33444a] bg-transparent px-3 text-[14px] text-[#e6ecea] hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50";

function Stat({ label, children, hope = false }: { label: string; children: React.ReactNode; hope?: boolean }) {
  return (
    <div className={cn("rounded-lg p-2", hope ? "bg-[#2a2416]" : "bg-[#1b282d]")}>
      <div className={cn("text-[12px] tracking-[0.08em] uppercase", hope ? "text-hope" : "text-[#9fb2b6]")}>{label}</div>
      <div className={cn("font-display text-[18px]", hope && "text-hope")}>{children}</div>
    </div>
  );
}

/** A hero on the roster (Party board): class banner, portrait, heritage, HP/Evasion/Hope, owner, Send away/Bring back, and the D5 level-up badge slot. */
export function RosterCard({
  campaignId,
  character,
  table,
  isGm,
  hopeAndFear = false,
}: {
  campaignId: Id<"campaigns">;
  character: CharacterView;
  table: Table | undefined;
  isGm: boolean;
  hopeAndFear?: boolean;
}) {
  const setStatus = useMutation(api.characters.setStatus);
  const assignOwner = useMutation(api.characters.assignOwner);
  const remove = useMutation(api.characters.remove);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { sheet, canEdit } = character;
  const name = sheet.name;
  const dead = character.status === "dead";
  const cls = getClass(sheet.classId);
  const domains = cls?.domains ?? [];
  const banner = domainBanner(domains);
  const maxHope = hopeMax(sheet.scars, sheet.hopeSlotBonus ?? 0);
  const owner = ownerLabel(character, table);
  const slot: SlotProps = { campaignId, character, canEdit, isGm, hopeAndFear };
  // Motherboard: installed Ikonis augments change Evasion (Block, CB 301-303), as on the server.
  const motherboard = useCampaign().frameId === FRAME_OF.motherboard && !character.corrupt;
  const extras = useQuery(api.characterExtras.get, motherboard ? { characterId: character._id } : "skip");
  const augments = motherboard ? (extras?.motherboard?.installed ?? []) : [];
  // XC1: extras made active while the GM allowed them stay active; warn until the player sends some away. Same args as the page's query, so no extra fetch.
  const party = useQuery(api.characters.listByCampaign, { campaignId });
  const activeOfOwner =
    character.status === "active" && owner !== "Unassigned" ? (party ?? []).filter((c) => c.ownerId === character.ownerId && c.status === "active").length : 0;

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await op();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      aria-label={name + (dead ? " (fallen)" : "")}
      className={cn("group/card relative flex flex-col overflow-hidden rounded-[14px] border bg-[#141e22]", dead ? "border-[#3a2a2a]" : "border-[#253338]")}
    >
      {canEdit && !dead ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => setStatus({ characterId: character._id, status: "dead" }))}
          aria-label={`Kill ${name}`}
          className="absolute top-2.5 right-2.5 z-[5] min-h-7 cursor-pointer rounded-full border border-[#8e2b2b] bg-[rgb(10_2_2/0.85)] px-2.5 font-display text-[11px] font-bold tracking-[0.08em] text-[#ff9a92] opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
        >
          Kill
        </button>
      ) : null}
      {dead ? (
        <FallenOverlay name={name} canEdit={isGm} busy={busy} onRevive={() => void run(() => setStatus({ characterId: character._id, status: "active" }))} />
      ) : null}

      <div className="flex items-baseline justify-between gap-2.5 px-4 py-3 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]" style={{ background: banner }}>
        <span className="font-display text-[20px] font-bold text-[#f6ead2]">{cls?.name ?? sheet.classId}</span>
        <span className="flex items-center gap-1.5 text-[13px] text-[#e6cfc0]">
          {domains.map((d) => (
            <span
              key={d}
              role="img"
              aria-label={getDomain(d)?.name ?? d}
              title={getDomain(d)?.name ?? d}
              className="inline-block size-[30px] flex-none bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: assetBackground(DOMAIN_ICONS[d] ?? "") }}
            />
          ))}
          {domains.map((d) => getDomain(d)?.name ?? d).join(" & ")}
        </span>
      </div>

      <div className="relative">
        <CharacterPortrait character={character} size="banner" fallback={banner} />
        {cls?.source === "hope-and-fear" ? (
          <span className="absolute bottom-3 left-3 z-[2] inline-flex items-center gap-1 rounded-full border border-[#5b4a8f] bg-[rgb(20_15_36/0.85)] px-[11px] py-1 font-display text-[12px] font-bold tracking-[0.06em] shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
            <span className="text-hope">Hope</span>
            <span className="text-[#9a8cc4]">&amp;</span>
            <span className="text-[#c6b6f2]">Fear</span>
          </span>
        ) : null}
        <span
          data-testid="owner-badge"
          className={cn(
            "absolute top-3 left-3 z-[2] rounded-full px-2.5 py-1 text-[12px] font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.45)]",
            owner === "Yours" ? "bg-brand text-brand-ink" : owner === "Unassigned" ? "border border-[#3a4d54] bg-black/70 text-[#c8d3d0]" : "bg-[#233a2b] text-[#e9f2e4]",
          )}
        >
          {owner}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-[22px] font-bold text-parchment">{name}</span>
          <span className="text-[14px] text-[#9fb2b6]">{heritageLine(sheet)}</span>
          <span className="text-[14px] text-[#9fb2b6]">
            {getSubclass(sheet.subclassId)?.name ? `${getSubclass(sheet.subclassId)?.name} · ` : ""}Level {sheet.level}
          </span>
          <LevelUpRosterBadge {...slot} />
          {activeOfOwner > 1 ? (
            <span data-testid="extra-active-warning" className="mt-1 self-start rounded-full border border-[#7a5a1e] bg-[#2a2416] px-2.5 py-0.5 text-[13px] text-[#f1d08a]">
              {activeOfOwner} active: send one away
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="HP">
            <span aria-label={`${sheet.hp} of ${sheet.hpMax} Hit Points marked`}>
              {sheet.hp} / {sheet.hpMax}
            </span>
          </Stat>
          <Stat label="Evasion">
            <span data-testid="roster-evasion">{derivedDefense(sheet, augments).evasion}</span>
          </Stat>
          <Stat label="Hope" hope>
            {Math.min(sheet.hope, maxHope)}
            <span className={cn("text-[12px]", sheet.scars ? "font-black text-[#ff5a4f]" : "font-normal text-[#b39a6a]")}> / {maxHope}</span>
            {sheet.scars ? (
              <div className="font-sans text-[11px] text-[#ff8d84]">
                {sheet.scars} scar{sheet.scars > 1 ? "s" : ""}
              </div>
            ) : null}
          </Stat>
        </div>
        <Link
          href={`/campaigns/${campaignId}/party/${character._id}`}
          className="flex min-h-[46px] items-center justify-center rounded-[10px] border border-ok-line bg-ok-bg text-[15px] font-semibold text-[#e9f2e4] hover:brightness-110"
        >
          Open character sheet
        </Link>

        {canEdit || isGm ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#253338] pt-2.5">
            <PortraitUpload character={character} />
            <BenchButton character={character} busy={busy} onSet={(status) => void run(() => setStatus({ characterId: character._id, status }))} />
            {isGm && table ? (
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-[#9fb2b6]">
                <span className="sr-only sm:not-sr-only">Player</span>
                <select
                  aria-label={`Assign ${name} to`}
                  value={character.ownerId}
                  disabled={busy}
                  onChange={(e) => void run(() => assignOwner({ characterId: character._id, ownerId: e.target.value as Id<"users"> }))}
                  className="min-h-10 min-w-0 flex-1 rounded-[9px] border border-[#3a4d54] bg-[#0b1214] px-2 text-[14px] text-[#e6ecea]"
                >
                  <option value={table.gm.userId}>Unassigned (GM)</option>
                  {table.players.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {isGm ? (
              <button type="button" className={cn(SMALL_BTN, "border-[#6a2a2a] text-danger")} onClick={() => setConfirmDelete(true)} aria-label={`Delete ${name}`}>
                Delete
              </button>
            ) : null}
          </div>
        ) : null}

        {confirmDelete ? (
          <div
            role="alertdialog"
            aria-label={`Delete ${name}`}
            className="flex flex-wrap items-center gap-2 rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2 text-[14px] text-[#ffd9d6]"
          >
            <span className="flex-1">Delete {name} for good? This can’t be undone.</span>
            <button type="button" className={SMALL_BTN} onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
            <button
              type="button"
              disabled={busy}
              className="min-h-10 cursor-pointer rounded-[9px] bg-danger-solid px-3 text-[14px] font-semibold text-white disabled:opacity-50"
              onClick={() => void run(() => remove({ characterId: character._id }))}
            >
              Delete character
            </button>
          </div>
        ) : null}

        <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
          {error}
        </p>
      </div>
    </article>
  );
}

/** The dashed "Create Character" tile at the end of the roster. */
export function CreateCard({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed border-brand bg-[#121b1f] text-[#e6ecea] hover:bg-[#16222a]"
    >
      <span className="flex size-[60px] items-center justify-center rounded-full border-[1.5px] border-brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-brand" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className="font-display text-[22px] font-bold">Create Character</span>
      <span className="text-[14px] text-[#9fb2b6]">Pick a class, ancestry &amp; community</span>
    </Link>
  );
}
