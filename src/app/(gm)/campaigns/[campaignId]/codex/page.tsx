"use client";

import "./codex.css";

import { useQuery } from "convex/react";
import { useState } from "react";

import { frameName } from "@/lib/campaign-display";
import { factionsFor, regionsFor, type CodexKind } from "@/lib/codex/schema";
import { groupOf, matchesSearch, previewForPlayers, unknownGroupLabel, type GmEntry, type PlayerEntry } from "@/lib/codex/view";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../convex/_generated/api";
import { useCampaign } from "../campaign-shell";

import { GmDetail, PlayerDetail } from "./entry-detail";
import { EntryList, type ListEntry } from "./entry-list";
import { Lightbox, type LightboxState } from "./gallery";
import { PinPicker } from "./pin-picker";

const KIND_LABEL: Record<CodexKind, string> = { character: "Characters", location: "Locations" };

/** Characters & Locations (the Codex board): the GM's people and places, and what the party knows of them. */
export default function CodexPage() {
  const campaign = useCampaign();
  const data = useQuery(api.codex.list, { campaignId: campaign._id });
  const create = useIntent(api.codex.create);
  const importPins = useIntent(api.codex.importPins);

  const [kind, setKind] = useState<CodexKind>("character");
  const [groups, setGroups] = useState<Record<CodexKind, string>>({ character: "all", location: "all" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);

  const isGmUser = campaign.role === "gm";

  const frameId = campaign.frameId;
  const gmData = data?.role === "gm" ? data : null;
  const gm = gmData !== null && !preview;
  const pins = gmData?.pins ?? [];

  // Entries as the current viewer sees them: the GM's full entries, or the player view (real or previewed).
  const all: (GmEntry | PlayerEntry)[] =
    data === undefined
      ? []
      : data.role === "gm"
        ? preview
          ? data.entries.map((e) => previewForPlayers(frameId, e, pins)).filter((e): e is PlayerEntry => e !== null)
          : data.entries
        : data.entries;

  const ofKind = all.filter((e) => e.kind === kind);
  const base = ofKind.filter((e) => matchesSearch({ name: e.name, role: "role" in e ? e.role : undefined }, search));
  const grp = groups[kind];
  const groupKey = (e: GmEntry | PlayerEntry) =>
    groupOf({ kind: e.kind, region: e.region, allegiance: "allegiance" in e ? e.allegiance : undefined, allegianceShown: e.allegianceShown }, gm);
  const shown = base.filter((e) => grp === "all" || groupKey(e) === grp);
  const regions = regionsFor(frameId);
  const groupNames = kind === "location" ? regions : factionsFor(frameId);
  const groupTabs =
    kind === "character" || regions.length
      ? [
          { key: "all", label: "All" },
          ...groupNames.map((g) => ({ key: g, label: g })),
          { key: "", label: unknownGroupLabel(kind, gm) },
        ]
          .map((t) => ({ ...t, count: t.key === "all" ? base.length : base.filter((e) => groupKey(e) === t.key).length }))
          .filter((t) => !(t.key === "" && t.count === 0 && grp !== ""))
      : [];

  const selectedId = shown.some((e) => e._id === selected) ? selected : (shown[0]?._id ?? null);
  const current = shown.find((e) => e._id === selectedId) ?? null;

  const listEntries: ListEntry[] = shown.map((e) => {
    const g = groupKey(e);
    const cover = e.images.find((i) => i.key === e.cover)?.url ?? null;
    return {
      _id: e._id,
      name: e.name || (e.kind === "location" ? "Unnamed location" : "Unnamed character"),
      subtitle: ("role" in e && e.role) || (e.kind === "location" ? "Location" : "Character"),
      coverUrl: cover,
      initial: (e.name || "?").charAt(0).toUpperCase(),
      group: g,
      groupText: g || (e.kind === "location" ? "" : unknownGroupLabel(e.kind, gm)),
      known: "known" in e ? e.known : true,
      imageText:
        "known" in e
          ? e.images.length
            ? `${e.images.filter((i) => i.shown).length}/${e.images.length} shown`
            : "No images"
          : "",
    };
  });

  const counts = (k: CodexKind) => all.filter((e) => e.kind === k).length;
  const gmEntries = gmData?.entries ?? [];
  const knownCount = gmEntries.filter((e) => e.known).length;
  const headerLine = gm
    ? `${gmEntries.filter((e) => e.kind === "character").length} characters · ${gmEntries.filter((e) => e.kind === "location").length} locations · ${knownCount} known to the players`
    : "What your party knows";

  const pickKind = (k: CodexKind) => {
    setKind(k);
    setSelected(null);
    setImportMsg("");
  };

  async function addEntry() {
    const result = await create.fire({ campaignId: campaign._id, kind });
    if (result) {
      setSearch("");
      setGroups((g) => ({ ...g, [kind]: "all" }));
      setSelected(result.entryId);
    }
  }

  async function fromMap() {
    const result = await importPins.fire({ campaignId: campaign._id });
    if (result) setImportMsg(result.added ? `Added ${result.added} location${result.added === 1 ? "" : "s"} from the map.` : "Every map pin is already in the list.");
  }

  const lightboxEntry = lightbox ? all.find((e) => e._id === lightbox.entryId) : undefined;
  const pickEntry = pickFor ? gmEntries.find((e) => e._id === pickFor) : undefined;
  const actionError = create.error ?? importPins.error;

  const emptyText = search.trim()
    ? "Nothing matches that search."
    : gm
      ? kind === "location"
        ? "No locations yet. Add one, or pull in the pins you placed on the World map."
        : "No characters yet. Add the people your party meets."
      : "The party has not met anyone here yet.";

  return (
    <>
      <div className="mx-auto flex max-w-[1344px] flex-wrap items-end justify-between gap-4 px-4 pt-7 sm:px-12">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] tracking-[0.24em] text-[#c8d3d0] uppercase">
            {campaign.name} · {frameName(frameId)}
          </span>
          <h1 className="m-0 font-display text-[32px] leading-[1.05] font-black text-parchment sm:text-[44px]">Characters &amp; Locations</h1>
          <span className="text-[15px] text-[#d6dfdc]">{headerLine}</span>
        </div>
        {isGmUser ? (
          <button
            type="button"
            onClick={() => {
              setPreview((p) => !p);
              setLightbox(null);
            }}
            aria-pressed={preview}
            className={cn(
              "min-h-12 cursor-pointer rounded-full px-[22px] text-[15px] font-semibold",
              preview ? "border-none bg-brand text-brand-ink" : "border border-white/30 bg-black/35 text-[#ece6d6]",
            )}
          >
            {preview ? "← Back to GM view" : "👁 Player view"}
          </button>
        ) : null}
      </div>

      {preview ? (
        <div role="note" className="mt-5 border-y border-[#5a4a2a] bg-[#2a2416] px-4 py-2.5 text-center text-[14px] text-[#f0dfb8] sm:px-12">
          Player view: only characters and locations the party knows, and only the images you have revealed. GM notes are hidden.
        </div>
      ) : null}

      <main className="mx-auto box-border grid w-full max-w-[1344px] grid-cols-1 items-start gap-6 px-4 pt-6 pb-12 sm:px-12 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside aria-label="Entries" className="flex min-w-0 flex-col gap-2.5">
          <div role="tablist" aria-label="Kind" className="flex gap-1.5 rounded-xl border border-[#253338] bg-[#141e22] p-1">
            {(["character", "location"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => pickKind(k)}
                className={cn(
                  "min-h-10 flex-1 cursor-pointer rounded-lg border-none px-3.5 text-[14px]",
                  kind === k ? "bg-brand text-brand-ink" : "bg-transparent text-[#e6ecea]",
                )}
              >
                {KIND_LABEL[k]} · {counts(k)}
              </button>
            ))}
          </div>

          {groupTabs.length ? (
            <div role="tablist" aria-label={kind === "location" ? "Regions" : "Allegiances"} className="flex flex-wrap gap-1.5">
              {groupTabs.map((t) => (
                <button
                  key={t.key || "none"}
                  type="button"
                  role="tab"
                  aria-selected={grp === t.key}
                  onClick={() => {
                    setGroups((g) => ({ ...g, [kind]: t.key }));
                    setSelected(null);
                  }}
                  className={cn(
                    "min-h-8 cursor-pointer rounded-full border px-3 text-[13px]",
                    grp === t.key ? "border-brand bg-brand text-brand-ink" : "border-[#33444a] bg-transparent text-[#e6ecea]",
                  )}
                >
                  {t.label} · {t.count}
                </button>
              ))}
            </div>
          ) : null}

          <input
            className="cx-in"
            type="search"
            placeholder={kind === "location" ? "Search locations" : "Search characters"}
            aria-label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {gm ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void addEntry()}
                disabled={create.pending}
                className="min-h-11 flex-1 cursor-pointer rounded-[10px] border-none bg-brand px-4 font-display text-[14px] font-bold tracking-[0.06em] text-brand-ink disabled:opacity-60"
              >
                {kind === "location" ? "+ New location" : "+ New character"}
              </button>
              {kind === "location" ? (
                <button
                  type="button"
                  className="cx-ghost"
                  onClick={() => void fromMap()}
                  disabled={importPins.pending}
                  title="Create entries for map pins that are not in the list yet"
                >
                  📍 From map
                </button>
              ) : null}
            </div>
          ) : null}
          {gm && kind === "location" && importMsg ? (
            <div className="cx-muted text-[13px]!" role="status">
              {importMsg}
            </div>
          ) : null}
          {actionError ? (
            <div role="alert" className="text-[14px] text-[#ffb4a8]">
              {actionError}
            </div>
          ) : null}

          {data === undefined ? (
            <p className="cx-muted m-0">Loading…</p>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#33444a] p-[18px] text-[14px] leading-normal text-[#9fb2b6]">{emptyText}</div>
          ) : (
            <EntryList entries={listEntries} selectedId={selectedId} gm={gm} onPick={setSelected} />
          )}
        </aside>

        <section aria-label="Entry detail" className="min-w-0">
          {data === undefined ? null : current === null ? (
            <div className="cx-card">
              <h2 className="cx-h">{gm ? "Nothing selected" : "Nothing to show yet"}</h2>
              <p className="cx-muted m-0">
                {gm ? "Pick an entry on the left or create a new one." : "When the GM reveals characters and locations, they appear here."}
              </p>
            </div>
          ) : gm ? (
            <GmDetail
              key={current._id}
              campaignId={campaign._id}
              frameId={frameId}
              entry={current as GmEntry}
              hasPins={pins.length > 0}
              onOpenImage={(key) => setLightbox({ entryId: current._id, key })}
              onPickPin={() => setPickFor(current._id)}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <PlayerDetail
              key={current._id}
              campaignId={campaign._id}
              frameId={frameId}
              entry={current as PlayerEntry}
              onOpenImage={(key) => setLightbox({ entryId: current._id, key })}
            />
          )}
        </section>
      </main>

      {lightbox && lightboxEntry ? (
        <Lightbox
          title={lightboxEntry.name}
          images={lightboxEntry.images.filter((i) => gm || !("shown" in i) || i.shown)}
          state={lightbox}
          onChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
      {pickEntry ? <PinPicker frameId={frameId} entry={pickEntry} entries={gmEntries} pins={pins} onClose={() => setPickFor(null)} /> : null}
    </>
  );
}
