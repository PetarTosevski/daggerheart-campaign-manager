"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { ALLEGIANCE_UNKNOWN, factionsFor, regionsFor, type CodexPatch } from "@/lib/codex/schema";
import { allegianceNote, type GmEntry, type PlayerEntry } from "@/lib/codex/view";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

import { Gallery } from "./gallery";

const mapHref = (campaignId: string, tokenId: number) => `/campaigns/${campaignId}/world?token=${tokenId}`;

/** The big picture on the left of the detail card; opens the lightbox. */
function Cover({ url, name, gm, onOpen }: { url: string | null; name: string; gm: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={() => url && onOpen()}
      aria-label={url ? `Open picture of ${name || "this entry"}` : "No picture yet"}
      className={cn(
        "box-border min-h-[240px] w-full flex-none rounded-xl border border-[#3a4d54] bg-[#0b1214] bg-cover bg-no-repeat font-sans text-[13px] text-[#7f9297] sm:w-[220px]",
        url ? "cursor-zoom-in" : "cursor-default",
      )}
      style={url ? { backgroundImage: `url(${url})`, backgroundPosition: "center 25%" } : undefined}
    >
      {url ? "" : gm ? "No picture yet" : ""}
    </button>
  );
}

/** The GM's editor for one entry: identity, allegiance or region, known, map pin, images, notes. */
export function GmDetail({
  campaignId,
  frameId,
  entry,
  hasPins,
  onOpenImage,
  onPickPin,
  onDeleted,
}: {
  campaignId: string;
  frameId: string;
  entry: GmEntry;
  hasPins: boolean;
  onOpenImage: (storageId: string) => void;
  onPickPin: () => void;
  onDeleted: () => void;
}) {
  const update = useMutation(api.codex.update);
  const setPin = useMutation(api.codex.setPin);
  const remove = useMutation(api.codex.remove);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const entryId = entry._id as Id<"codexEntries">;
  const isLoc = entry.kind === "location";
  const factions = factionsFor(frameId);
  const regions = regionsFor(frameId);
  const coverUrl = entry.images.find((i) => i.storageId === entry.cover)?.url ?? null;

  const run = async (op: () => Promise<unknown>) => {
    setError(null);
    try {
      await op();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const save = (patch: CodexPatch) => run(() => update({ entryId, patch }));
  const commit = (field: "name" | "role" | "pdesc" | "gmn") => (ev: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (ev.target.value !== entry[field]) void save({ [field]: ev.target.value });
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="cx-card flex-row! flex-wrap items-stretch gap-5">
        <Cover url={coverUrl} name={entry.name} gm onOpen={() => entry.cover && onOpenImage(entry.cover)} />
        <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="cx-lbl">Name</span>
            <input
              className="cx-in font-display text-[20px]! font-bold"
              type="text"
              maxLength={120}
              defaultValue={entry.name}
              onBlur={commit("name")}
              placeholder={isLoc ? "e.g. The Sunken Abbey" : "e.g. Kreil Dirn"}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="cx-lbl">{isLoc ? "Kind of place" : "Role"}</span>
            <input
              className="cx-in"
              type="text"
              maxLength={160}
              defaultValue={entry.role}
              onBlur={commit("role")}
              placeholder={isLoc ? "e.g. Ruined temple, Haven district" : "e.g. Haven’s spymaster"}
            />
          </label>

          {!isLoc ? (
            <div className="grid grid-cols-1 gap-2.5 rounded-[10px] border border-[#253338] bg-[#0f181b] p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="cx-lbl">True allegiance</span>
                <select className="cx-in" value={entry.allegiance} onChange={(e) => void save({ allegiance: e.target.value })} aria-label="True allegiance">
                  <option value="">Unassigned</option>
                  {factions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="cx-lbl">Players see</span>
                <select
                  className="cx-in"
                  value={entry.allegianceShown}
                  onChange={(e) => void save({ allegianceShown: e.target.value })}
                  aria-label="Allegiance the players see"
                >
                  <option value={ALLEGIANCE_UNKNOWN}>Allegiance unknown</option>
                  {factions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <div className="col-span-full flex flex-wrap items-center gap-2.5">
                <span className="cx-muted flex-1 text-[13px]!">{allegianceNote(entry.allegiance, entry.allegianceShown)}</span>
                {entry.allegiance && entry.allegianceShown !== entry.allegiance ? (
                  <button type="button" className="cx-ghost min-h-[34px]! text-[13px]!" onClick={() => void save({ allegianceShown: entry.allegiance })}>
                    👁 Reveal true allegiance
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {isLoc && regions.length ? (
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-[#253338] bg-[#0f181b] p-3">
              <span className="cx-lbl">Region</span>
              {entry.regionAuto ? (
                <span className="font-display text-[18px] font-bold">
                  {entry.region || "Unsorted"} <span className="font-sans text-[12px] font-normal text-[#9fb2b6]">· 📍 from map pin</span>
                </span>
              ) : (
                <select className="cx-in" value={entry.region} onChange={(e) => void save({ region: e.target.value })} aria-label="Region">
                  <option value="">Unsorted</option>
                  {regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
              <span className="cx-muted text-[13px]!">
                {entry.regionAuto
                  ? "Set automatically from where its pin sits on the World map."
                  : "Pick a region, or link this place to a map pin to set it automatically."}
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save({ known: !entry.known })}
              aria-pressed={entry.known}
              className={cn(
                "min-h-10 cursor-pointer rounded-lg border px-3.5 text-[14px] font-semibold",
                entry.known ? "border-[#3d7a55] bg-[#20352b] text-[#c8f0d6]" : "border-[#6a3a44] bg-[#2a1f24] text-[#f0c2cc]",
              )}
            >
              {entry.known ? "👁 Known to players" : "🔒 Secret from players"}
            </button>
            {isLoc ? (
              <button
                type="button"
                className="cx-ghost"
                onClick={onPickPin}
                disabled={!hasPins}
                title={hasPins ? undefined : "Place pins on the World map first"}
              >
                {entry.tokenId !== null ? "📍 Change pin" : "📍 Link to map pin"}
              </button>
            ) : null}
            {entry.tokenId !== null ? (
              <>
                <Link href={mapHref(campaignId, entry.tokenId)} className="cx-ghost">
                  🗺 Show on map
                </Link>
                <button
                  type="button"
                  className="cx-ghost text-[#9fb2b6]!"
                  onClick={() => void run(() => setPin({ entryId, tokenId: null }))}
                  title="Keep the map pin but stop linking it to this location"
                >
                  Unlink
                </button>
              </>
            ) : null}
            <span className="flex-1" />
            <button
              type="button"
              className="cx-ghost border-[#5a3330]! text-[#ffb4a8]!"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                void run(async () => {
                  await remove({ entryId });
                  onDeleted();
                });
              }}
            >
              {confirmDelete ? "Click again to delete" : "Delete"}
            </button>
          </div>
          {error ? (
            <div role="alert" className="text-[14px] text-[#ffb4a8]">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <Gallery entry={entry} gm onOpen={onOpenImage} />

      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
        <div className="cx-card">
          <h2 className="cx-h">What the players know</h2>
          <p className="cx-muted m-0">Shown in Player view once this entry is known.</p>
          <textarea
            className="cx-ta"
            rows={7}
            maxLength={8000}
            aria-label="What the players know"
            defaultValue={entry.pdesc}
            onBlur={commit("pdesc")}
            placeholder={isLoc ? "What the party has seen or heard about this place…" : "What the party knows about this person…"}
          />
        </div>
        <div className="cx-card">
          <h2 className="cx-h">GM notes</h2>
          <p className="cx-muted m-0">Never shown to players.</p>
          <textarea
            className="cx-ta"
            rows={7}
            maxLength={8000}
            aria-label="GM notes"
            defaultValue={entry.gmn}
            onBlur={commit("gmn")}
            placeholder="Secrets, motives, stats, hooks…"
          />
        </div>
      </div>
    </div>
  );
}

/** What a player (or the GM's preview) sees of a known entry. */
export function PlayerDetail({
  campaignId,
  frameId,
  entry,
  onOpenImage,
}: {
  campaignId: string;
  frameId: string;
  entry: PlayerEntry;
  onOpenImage: (storageId: string) => void;
}) {
  const coverUrl = entry.images.find((i) => i.storageId === entry.cover)?.url ?? null;
  const badge = "cx-badge self-start bg-[#1b282d] text-[12px]! text-[#e6ecea]";
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="cx-card flex-row! flex-wrap items-stretch gap-5">
        <Cover url={coverUrl} name={entry.name} gm={false} onOpen={() => entry.cover && onOpenImage(entry.cover)} />
        <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-3">
          <h2 className="m-0 font-display text-[30px] leading-[1.1] font-black">{entry.name}</h2>
          <div className="text-[16px] text-[#c8d3d0]">{entry.kind === "location" ? "Location" : "Character"}</div>
          {entry.kind === "character" ? (
            <span className={badge}>⚑ {entry.allegianceShown !== ALLEGIANCE_UNKNOWN ? entry.allegianceShown : "Allegiance unknown"}</span>
          ) : regionsFor(frameId).length ? (
            <span className={badge}>⌂ {entry.region || "Unsorted"}</span>
          ) : null}
          {entry.pdesc.trim() ? <p className="m-0 font-serif text-[19px] leading-[1.6] whitespace-pre-line">{entry.pdesc}</p> : null}
          {entry.tokenId !== null ? (
            <Link href={mapHref(campaignId, entry.tokenId)} className="cx-ghost self-start">
              📍 Show on map
            </Link>
          ) : null}
        </div>
      </div>
      <Gallery entry={entry} gm={false} onOpen={onOpenImage} />
    </div>
  );
}
