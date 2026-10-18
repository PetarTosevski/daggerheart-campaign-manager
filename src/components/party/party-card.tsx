"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { assetBackground } from "@/lib/design-assets";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../convex/characters";

import { DeathCardBadge } from "./death";
import { LevelUpCardBadge } from "./level-up";
import { applyResourceDelta, classLines, resourceTiles, segments, TILE_ART, tileLook, type Resource, type Tile } from "./party-display";
import { CharacterPortrait } from "./portrait";
import type { SlotProps } from "./slots";
import { WitherCardBadge } from "./wither";

const STEP_BTN =
  "size-8 cursor-pointer rounded-lg border border-[#33444a] bg-black/25 p-0 text-[17px] text-[#e6ecea] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3d8ff] disabled:cursor-not-allowed disabled:opacity-35";
const PILL =
  "absolute top-[5px] right-[5px] z-[3] min-h-6 cursor-pointer rounded-full px-2 font-display text-[10px] font-bold tracking-[0.08em] opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100";

export function SkullIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8a7f78" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4 2.6 5v2.5c0 .8.6 1.5 1.4 1.5h7c.8 0 1.4-.7 1.4-1.5V15c1.5-1 2.6-2.6 2.6-5 0-4-3.1-7-7.5-7z" />
      <circle cx="9" cy="10.5" r="1.6" />
      <circle cx="15" cy="10.5" r="1.6" />
      <path d="M10 19v2M14 19v2M12 13.5l-1 1.5h2z" />
    </svg>
  );
}

/** The "FALLEN" veil and its Revive button, shared by the dashboard card and the roster. */
export function FallenOverlay({ name, canEdit, onRevive, busy }: { name: string; canEdit: boolean; onRevive: () => void; busy?: boolean }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 flex animate-in flex-col items-center justify-center gap-1.5 rounded-[14px] bg-[radial-gradient(ellipse_at_50%_40%,rgba(0,0,0,0.78),rgba(0,0,0,0.94))] duration-1000 fade-in"
      >
        <SkullIcon />
        <span className="font-display text-[20px] font-bold tracking-[0.2em] text-[#b8aca4]">FALLEN</span>
        <span className="text-[13px] text-[#8a7f78]">{name} has fallen</span>
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={onRevive}
          disabled={busy}
          aria-label={`Revive ${name}`}
          className="absolute top-2.5 right-2.5 z-20 min-h-[30px] cursor-pointer rounded-full border border-[#e3b45a] bg-[rgb(30_22_6/0.92)] px-3 font-display text-[11px] font-bold tracking-[0.08em] text-[#ffe2a3] opacity-0 shadow-[0_0_12px_rgba(227,180,90,0.5)] transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
        >
          Revive
        </button>
      ) : null}
    </>
  );
}

function ResourceTile({
  tile,
  name,
  canEdit,
  dead,
  onStep,
  onKill,
  onScar,
}: {
  tile: Tile;
  name: string;
  canEdit: boolean;
  dead: boolean;
  onStep: (resource: Resource, delta: number) => void;
  onKill: () => void;
  onScar: (delta: number) => void;
}) {
  const [scarsOpen, setScarsOpen] = useState(false);
  const t = tile.max ? tile.value / tile.max : 0;
  const look = tileLook(tile.key, t);
  const noun = tile.key === "hope" ? "Hope" : tile.label === "HP" ? "Hit Point" : "Stress";
  const plusLabel = tile.key === "hope" ? `Gain one Hope for ${name}` : `Mark one ${noun} for ${name}`;
  const minusLabel = tile.key === "hope" ? `Spend one Hope for ${name}` : `Clear one ${noun} for ${name}`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="group/tile relative">
        {tile.key === "hp" && canEdit && !dead ? (
          <button type="button" onClick={onKill} aria-label={`Kill ${name}`} className={cn(PILL, "border border-[#8e2b2b] bg-[rgb(10_2_2/0.8)] text-[#ff9a92]")}>
            Kill
          </button>
        ) : null}
        {tile.key === "hope" && canEdit ? (
          <>
            <button
              type="button"
              onClick={() => setScarsOpen((o) => !o)}
              aria-expanded={scarsOpen}
              className={cn(PILL, "border bg-[rgb(10_4_4/0.75)] text-[#ffb0a8] aria-expanded:opacity-100", tile.broken ? "border-[#c0261c]" : "border-[#6a2a2a]")}
            >
              Scars{tile.broken ? ` · ${tile.broken}` : ""}
            </button>
            {scarsOpen ? (
              <div
                role="group"
                aria-label={`Scars for ${name}`}
                className="absolute top-[34px] right-[5px] z-[4] flex items-center gap-1.5 rounded-[10px] border border-[#6a1f1f] bg-[#160909] p-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.6)]"
              >
                <button type="button" onClick={() => onScar(-1)} disabled={tile.broken === 0} aria-label={`Heal a scar for ${name}`} className="size-7 cursor-pointer rounded-md border border-[#6a2a2a] bg-transparent text-[#e6ecea] disabled:opacity-35">
                  −
                </button>
                <strong className="min-w-4 text-center text-[16px] text-[#ff8d84]">{tile.broken}</strong>
                <button type="button" onClick={() => onScar(1)} disabled={tile.broken >= 6} aria-label={`Mark a scar for ${name}`} className="size-7 cursor-pointer rounded-md border border-[#6a2a2a] bg-transparent text-[#e6ecea] disabled:opacity-35">
                  +
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        <div
          role="img"
          aria-label={`${name} ${tile.label} ${tile.value} of ${tile.max}`}
          data-testid={`tile-${tile.key}`}
          className="relative block aspect-[3/4] w-full overflow-hidden rounded-[10px] bg-cover bg-center transition-[filter,box-shadow] duration-300"
          style={{ backgroundImage: assetBackground(TILE_ART[tile.key]), ...look.tile }}
        >
          <span aria-hidden="true" className="absolute" style={look.overlay} />
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent px-2 pt-[18px] pb-1.5">
            <span className="flex items-baseline justify-between">
              <span className="font-display text-[12px] font-bold tracking-[0.1em]" style={{ color: tile.color }}>
                {tile.label}
              </span>
              <span className="font-display text-[17px] font-black text-[#f4efe6]">
                {tile.value}
                <span className={cn("text-[11px]", tile.broken ? "font-black text-[#ff5a4f]" : "font-normal text-[#b8b0a4]")}>/{tile.max}</span>
              </span>
            </span>
            <span className="flex gap-0.5">
              {segments(tile.value, tile.max, tile.broken).map((s, k) =>
                s === "broken" ? (
                  <span
                    key={k}
                    className="h-[7px] flex-1 bg-[linear-gradient(90deg,#2a0b0b,#050303_45%,#050303_55%,#2a0b0b)] [clip-path:polygon(0_0,38%_0,50%_100%,62%_0,100%_0,100%_100%,58%_100%,50%_35%,42%_100%,0_100%)] drop-shadow-[0_0_1px_#c0261c]"
                  />
                ) : (
                  <span key={k} className="h-[7px] flex-1 rounded-[2px]" style={{ background: s === "on" ? tile.color : "rgba(255, 255, 255, 0.18)" }} />
                ),
              )}
            </span>
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" className={STEP_BTN} disabled={!canEdit || tile.value <= 0} onClick={() => onStep(tile.key, -1)} aria-label={minusLabel}>
          −
        </button>
        <span className="text-center text-[11px] text-[#8fa3a8]">{tile.hint}</span>
        <button type="button" className={STEP_BTN} disabled={!canEdit || (tile.value >= tile.max && tile.key !== "stress")} onClick={() => onStep(tile.key, 1)} aria-label={plusLabel}>
          +
        </button>
      </div>
    </div>
  );
}

/**
 * A party card on the dashboard (CampaignHub board): portrait, HP/Stress/Hope
 * tiles, Kill/Revive, and the D5 badge slots (level-up, death, Wither).
 */
export function PartyCard({
  campaignId,
  character,
  isGm = false,
  hopeAndFear = false,
}: {
  campaignId: Id<"campaigns">;
  character: CharacterView;
  isGm?: boolean;
  hopeAndFear?: boolean;
}) {
  const adjust = useMutation(api.characters.adjustResource).withOptimisticUpdate((store, { characterId, resource, delta }) => {
    const list = store.getQuery(api.characters.listByCampaign, { campaignId });
    if (!list || resource === "armor") return;
    store.setQuery(
      api.characters.listByCampaign,
      { campaignId },
      list.map((c) => (c._id === characterId ? { ...c, sheet: applyResourceDelta(c.sheet, resource, delta) } : c)),
    );
  });
  const setStatus = useMutation(api.characters.setStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { sheet, canEdit } = character;
  const name = sheet.name;
  const dead = character.status === "dead";
  const { line, sub } = classLines(sheet);
  const slot: SlotProps = { campaignId, character, canEdit, isGm, hopeAndFear };

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    try {
      await op();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const step = (resource: Resource, delta: number) => void run(() => adjust({ characterId: character._id, resource, delta }));
  const status = (next: "active" | "dead") =>
    void (async () => {
      setBusy(true);
      await run(() => setStatus({ characterId: character._id, status: next }));
      setBusy(false);
    })();

  return (
    <article
      aria-label={name + (dead ? " (fallen)" : "")}
      className={cn(
        "group/card relative flex flex-col gap-3 rounded-[14px] border bg-[#141e22] p-[18px]",
        dead ? "border-[#3a2a2a]" : "border-[#253338]",
      )}
    >
      {dead ? <FallenOverlay name={name} canEdit={isGm} busy={busy} onRevive={() => status("active")} /> : null}
      <Link href={`/campaigns/${campaignId}/party/${character._id}`} className="flex items-center gap-3.5 rounded-[10px] hover:bg-white/[0.03]">
        <CharacterPortrait character={character} size={76} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-display text-[19px] font-bold text-parchment">{name}</span>
          <span className="text-[13px] text-[#9fb2b6]">{line}</span>
          {sub ? <span className="text-[13px] text-[#7f9297]">{sub}</span> : null}
        </span>
      </Link>
      <LevelUpCardBadge {...slot} />
      <DeathCardBadge {...slot} />
      <WitherCardBadge {...slot} />
      <div className="grid grid-cols-3 gap-2.5">
        {resourceTiles(sheet).map((tile) => (
          <ResourceTile
            key={tile.key}
            tile={tile}
            name={name}
            canEdit={canEdit && !dead}
            dead={dead}
            onStep={step}
            onKill={() => status("dead")}
            onScar={(delta) => step("scars", delta)}
          />
        ))}
      </div>
      <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </article>
  );
}
