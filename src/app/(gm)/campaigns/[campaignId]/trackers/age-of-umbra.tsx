"use client";

import { useQuery } from "convex/react";
import { Flame } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BrandButton, brandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { MAX_VICINITY_KM, MAX_WATCHERS, MIN_VICINITY_KM, SETTLEMENT_MAX, type Pyre } from "@/lib/frames/trackers/age-of-umbra";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import type { LurkingResult, PyreMapView, UmbraView } from "../../../../../../convex/trackers/ageOfUmbra";
import { TrackerCard } from "./tracker-card";

type Props = { campaign: CampaignSummary };

const INPUT = "min-h-10 rounded-[9px] border border-[#33444a] bg-[#10181b] px-2 text-[14px] text-parchment";

/** The Age of Umbra (Core pp.288-289): Sacred Pyres, Blessed Branches and the Lurking Darkness. */
export function AgeOfUmbraTracker({ campaign }: Props) {
  const view = useQuery(api.trackers.ageOfUmbra.get, { campaignId: campaign._id });
  if (view === undefined) return null;
  return (
    <div className="flex flex-col gap-4">
      <PyresCard campaign={campaign} view={view} />
      {view.gm ? <LurkingCard campaign={campaign} view={view} log={view.gm.log} /> : null}
    </div>
  );
}

type Marker = { id: number; name: string };

function PyresCard({ campaign, view }: Props & { view: UmbraView }) {
  const readOnly = campaign.role !== "gm";
  const campaignId = campaign._id;
  // dcm-bxp.18: the pyres' World map links, and the GM's markers to link them to.
  const pyreMap = useQuery(api.trackers.ageOfUmbra.pyreMap, { campaignId });
  const map = useQuery(api.maps.get, readOnly ? "skip" : { campaignId });
  const markers: Marker[] = map ? map.state.tokens.map((t) => ({ id: t.id, name: t.name || `Marker ${t.id}` })) : [];
  const addPyre = useIntent(api.trackers.ageOfUmbra.addPyre);
  const setLit = useIntent(api.trackers.ageOfUmbra.setLit);
  const branches = useIntent(api.trackers.ageOfUmbra.adjustBranches);
  const atPyre = useIntent(api.trackers.ageOfUmbra.setAtPyre);
  const [name, setName] = useState("");
  const [igniting, setIgniting] = useState(false);
  const [reminder, setReminder] = useState<string | null>(null);
  const error = addPyre.error ?? setLit.error ?? branches.error ?? atPyre.error;

  return (
    <TrackerCard title="Sacred Pyres" subtitle="Where a Sacred Pyre burns, the Enduring find safety.">
      <label className="flex items-center gap-2 text-[14px] text-[#e6ecea]">
        <input
          type="checkbox"
          checked={view.atPyre}
          disabled={readOnly || atPyre.pending}
          onChange={(e) => void atPyre.fire({ campaignId, atPyre: e.target.checked })}
          className="size-4 accent-[#e0905a]"
        />
        The party is at a Sacred Pyre
      </label>
      {pyreMap ? <VicinityControls campaignId={campaignId} readOnly={readOnly} pyreMap={pyreMap} /> : null}

      {view.pyres.length ? (
        <ul aria-label="Sacred Pyres" className="m-0 flex list-none flex-col gap-2 p-0">
          {view.pyres.map((pyre) => (
            <PyreRow
              key={pyre.id}
              pyre={pyre}
              tokenId={pyreMap?.links.find((l) => l.pyreId === pyre.id)?.tokenId ?? null}
              markers={markers}
              readOnly={readOnly}
              campaignId={campaignId}
              onToggle={() => void setLit.fire({ campaignId, pyreId: pyre.id, lit: !pyre.lit })}
              toggling={setLit.pending}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-[#9fb2b6]">No Sacred Pyres recorded yet.</p>
      )}

      {readOnly ? null : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            if (await addPyre.fire({ campaignId, settlement: name })) setName("");
          }}
        >
          <input
            aria-label="Settlement"
            placeholder="Settlement"
            maxLength={SETTLEMENT_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(INPUT, "min-w-0 flex-1")}
          />
          <BrandButton type="submit" variant="neutral" size="sm" disabled={!name.trim() || addPyre.pending}>
            Add pyre
          </BrandButton>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-[#e6ecea]">
          Blessed Branches: <span data-testid="blessed-branches" className="font-display text-[18px]">{view.blessedBranches}</span>
        </span>
        {readOnly ? null : (
          <>
            <BrandButton
              variant="neutral"
              size="sm"
              icon
              aria-label="Remove a Blessed Branch"
              disabled={view.blessedBranches < 1 || branches.pending}
              onClick={() => void branches.fire({ campaignId, delta: -1 })}
            >
              −
            </BrandButton>
            <BrandButton
              variant="neutral"
              size="sm"
              icon
              aria-label="Add a Blessed Branch"
              disabled={branches.pending}
              onClick={() => void branches.fire({ campaignId, delta: 1 })}
            >
              +
            </BrandButton>
            <BrandButton variant="confirm" size="sm" disabled={view.blessedBranches < 1} onClick={() => setIgniting(true)}>
              Ignite a Blessed Branch
            </BrandButton>
          </>
        )}
      </div>
      {reminder ? (
        <p role="status" className="m-0 rounded-lg border border-[#5b4a2a] bg-[#2a2010] px-3 py-2 text-[14px] text-[#f4e3bd]">
          {reminder}
        </p>
      ) : null}
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
      {readOnly ? null : (
        <IgniteDialog
          open={igniting}
          onClose={() => setIgniting(false)}
          campaignId={campaignId}
          pyres={view.pyres}
          onIgnited={(text) => setReminder(text)}
        />
      )}
    </TrackerCard>
  );
}

/**
 * dcm-bxp.18 (user 2026-10-30): with a pyre linked to a World marker, "at a
 * Sacred Pyre" follows the map (the party marker within N km of a lit linked
 * pyre) until the GM ticks or clears the box; "Follow the map" hands it back.
 */
function VicinityControls({ campaignId, readOnly, pyreMap }: { campaignId: CampaignSummary["_id"]; readOnly: boolean; pyreMap: PyreMapView }) {
  const setVicinity = useIntent(api.trackers.ageOfUmbra.setVicinity);
  const atPyre = useIntent(api.trackers.ageOfUmbra.setAtPyre);
  const [draft, setDraft] = useState<string | null>(null);
  const km = Number(draft);
  const valid = draft !== null && draft.trim() !== "" && Number.isFinite(km) && km >= MIN_VICINITY_KM && km <= MAX_VICINITY_KM;
  const auto = pyreMap.mode === "auto";
  return (
    <div className="flex flex-col gap-2 text-[13px] text-[#9fb2b6]">
      <p className="m-0" data-testid="pyre-mode">
        {auto
          ? `Follows the map: the party marker within ${pyreMap.vicinityKm} km of a burning pyre linked to a World marker${pyreMap.nearLitPyre ? " (it is)." : "."}`
          : `Set by the GM${pyreMap.nearLitPyre ? " (the map puts the party at a burning pyre)." : "."}`}
      </p>
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {auto ? null : (
            <BrandButton variant="neutral" size="sm" disabled={atPyre.pending} onClick={() => void atPyre.fire({ campaignId, atPyre: null })}>
              Follow the map
            </BrandButton>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!valid) return;
              if (await setVicinity.fire({ campaignId, km })) setDraft(null);
            }}
          >
            <label className="flex items-center gap-2">
              Vicinity (km)
              <input
                inputMode="decimal"
                value={draft ?? String(pyreMap.vicinityKm)}
                onChange={(e) => setDraft(e.target.value)}
                className={cn(INPUT, "w-20")}
              />
            </label>
            <BrandButton type="submit" variant="confirm" size="sm" disabled={!valid || setVicinity.pending}>
              Save
            </BrandButton>
          </form>
        </div>
      )}
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {setVicinity.error ?? atPyre.error}
      </p>
    </div>
  );
}

function PyreRow({
  pyre,
  tokenId,
  markers,
  readOnly,
  campaignId,
  onToggle,
  toggling,
}: {
  pyre: Pyre;
  tokenId: number | null;
  markers: Marker[];
  readOnly: boolean;
  campaignId: CampaignSummary["_id"];
  onToggle: () => void;
  toggling: boolean;
}) {
  const rename = useIntent(api.trackers.ageOfUmbra.renamePyre);
  const remove = useIntent(api.trackers.ageOfUmbra.removePyre);
  const link = useIntent(api.trackers.ageOfUmbra.linkPyre);
  const [editing, setEditing] = useState<string | null>(null);
  const error = rename.error ?? remove.error ?? link.error;

  return (
    <li aria-label={pyre.settlement} data-lit={pyre.lit} className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#10181b] px-3 py-2">
      <button
        type="button"
        aria-label={`${pyre.settlement}: ${pyre.lit ? "burning" : "extinguished"}`}
        aria-pressed={pyre.lit}
        disabled={readOnly || toggling}
        onClick={onToggle}
        className={cn(
          "flex size-10 flex-none items-center justify-center rounded-full border disabled:cursor-default",
          pyre.lit ? "border-[#e0905a] bg-[#3a2410] text-[#ffb060]" : "border-[#33444a] text-[#4a5a60]",
          !readOnly && "cursor-pointer",
        )}
      >
        <Flame className="size-5" aria-hidden="true" />
      </button>
      {editing !== null ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await rename.fire({ campaignId, pyreId: pyre.id, settlement: editing }) !== undefined) setEditing(null);
          }}
        >
          <input
            aria-label="Settlement name"
            maxLength={SETTLEMENT_MAX}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            className={cn(INPUT, "min-w-0 flex-1")}
          />
          <BrandButton type="submit" variant="confirm" size="sm" disabled={!editing.trim() || rename.pending}>
            Save
          </BrandButton>
          <BrandButton variant="cancel" size="sm" onClick={() => setEditing(null)}>
            Cancel
          </BrandButton>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[15px] text-[#e6ecea]">{pyre.settlement}</span>
          <span className="text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">{pyre.lit ? "Burning" : "Out"}</span>
          {tokenId !== null ? (
            <Link className={brandButton({ variant: "neutral", size: "sm", className: "no-underline" })} href={`/campaigns/${campaignId}/world?token=${tokenId}`} aria-label={`Show ${pyre.settlement} on the map`}>
              Show on map
            </Link>
          ) : null}
          {readOnly ? null : (
            <>
              <select
                aria-label={`World marker for ${pyre.settlement}`}
                value={tokenId === null ? "" : String(tokenId)}
                disabled={link.pending}
                onChange={(e) => void link.fire({ campaignId, pyreId: pyre.id, tokenId: e.target.value === "" ? null : Number(e.target.value) })}
                className={cn(INPUT, "max-w-[12rem]")}
              >
                <option value="">No World marker</option>
                {tokenId !== null && !markers.some((m) => m.id === tokenId) ? <option value={String(tokenId)}>Marker {tokenId}</option> : null}
                {markers.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name}
                  </option>
                ))}
              </select>
              <BrandButton variant="neutral" size="sm" aria-label={`Rename ${pyre.settlement}`} onClick={() => setEditing(pyre.settlement)}>
                Rename
              </BrandButton>
              <BrandButton
                variant="danger"
                size="sm"
                aria-label={`Remove ${pyre.settlement}`}
                disabled={remove.pending}
                onClick={() => void remove.fire({ campaignId, pyreId: pyre.id })}
              >
                Remove
              </BrandButton>
            </>
          )}
        </>
      )}
      <p aria-live="polite" className="m-0 w-full text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </li>
  );
}

function IgniteDialog({
  open,
  onClose,
  campaignId,
  pyres,
  onIgnited,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: CampaignSummary["_id"];
  pyres: Pyre[];
  onIgnited: (reminder: string) => void;
}) {
  const ignite = useIntent(api.trackers.ageOfUmbra.igniteBranch);
  const unlit = pyres.filter((p) => !p.lit);
  const [target, setTarget] = useState<string>("new");
  const [name, setName] = useState("");
  const relight = target !== "new" && unlit.some((p) => p.id === target);
  const ready = relight || (target === "new" && name.trim() !== "");

  return (
    <Modal open={open} onClose={onClose} title="Ignite a Blessed Branch">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          const result = await ignite.fire(relight ? { campaignId, pyreId: target } : { campaignId, settlement: name });
          if (result) {
            onIgnited(result.reminder);
            setName("");
            setTarget("new");
            onClose();
          }
        }}
      >
        <label className="flex flex-col gap-1 text-[14px]">
          Kindle
          <select aria-label="Kindle" value={target} onChange={(e) => setTarget(e.target.value)} className={INPUT}>
            <option value="new">Found a new Sacred Pyre</option>
            {unlit.map((p) => (
              <option key={p.id} value={p.id}>
                Relight {p.settlement}
              </option>
            ))}
          </select>
        </label>
        {target === "new" ? (
          <label className="flex flex-col gap-1 text-[14px]">
            New settlement
            <input maxLength={SETTLEMENT_MAX} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </label>
        ) : null}
        <p className="m-0 text-[14px] text-[#9fb2b6]">When ignited, all Enduring present gain 3 Hope.</p>
        <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
          {ignite.error}
        </p>
        <BrandButton type="submit" variant="confirm" disabled={!ready || ignite.pending}>
          Ignite
        </BrandButton>
      </form>
    </Modal>
  );
}

const OUTCOME_LABEL: Record<LurkingResult["outcome"], string> = {
  conflict: "An adversary initiates conflict",
  fear2: "+2 Fear",
  fear1: "+1 Fear",
  none: "No effect",
  hope: "Each PC gains a Hope",
};

function LurkingCard({ campaign, view, log }: Props & { view: UmbraView; log: NonNullable<UmbraView["gm"]>["log"] }) {
  const [open, setOpen] = useState(false);
  return (
    <TrackerCard
      title="Lurking Darkness"
      subtitle="Roll after a short or long rest away from a Sacred Pyre."
      gmOnly
      actions={
        <BrandButton variant="confirm" size="sm" disabled={view.atPyre} onClick={() => setOpen(true)}>
          Roll Lurking Darkness
        </BrandButton>
      }
    >
      {view.atPyre ? <p className="m-0 text-[14px] text-[#9fb2b6]">The party rests at a Sacred Pyre: no roll.</p> : null}
      {log.length ? (
        <ol aria-label="Last Lurking Darkness rolls" className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-[#c9d2cf]">
          {log.map((entry) => (
            <li key={entry.at}>
              {entry.result}
              {entry.watchRoll !== null && entry.result !== entry.gmRoll ? ` (watch replaced GM ${entry.gmRoll})` : ""}:{" "}
              {OUTCOME_LABEL[entry.outcome]}
            </li>
          ))}
        </ol>
      ) : null}
      <LurkingDialog open={open} onClose={() => setOpen(false)} campaignId={campaign._id} />
    </TrackerCard>
  );
}

function LurkingDialog({ open, onClose, campaignId }: { open: boolean; onClose: () => void; campaignId: CampaignSummary["_id"] }) {
  const roll = useIntent(api.trackers.ageOfUmbra.rollLurkingDarkness);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [result, setResult] = useState<LurkingResult | null>(null);
  const values = watchers.map(Number);
  const valid = values.every((n) => Number.isInteger(n) && n >= 1 && n <= 12) && watchers.every((w) => w.trim() !== "");

  const close = () => {
    setResult(null);
    setWatchers([]);
    roll.clearError();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Lurking Darkness">
      {result ? (
        <div role="status" className="flex flex-col gap-3">
          <p className="m-0 font-display text-[40px] leading-none font-black" data-testid="lurking-result">
            {result.result}
          </p>
          <p className="m-0 text-[14px] text-[#9fb2b6]">
            GM rolled {result.gmRoll}
            {result.watchRoll !== null
              ? result.result !== result.gmRoll
                ? `; Keep Watch replaced it with ${result.watchRoll}.`
                : `; the best watch roll (${result.watchRoll}) did not beat it.`
              : "."}
          </p>
          <p className="m-0 text-[15px]">{result.text}</p>
          {result.fear ? (
            <p className="m-0 text-[14px] text-fear">
              Fear is now {result.fear.newValue}
              {result.fear.lost ? ` (${result.fear.lost} lost at the cap)` : ""}.
            </p>
          ) : null}
          <BrandButton variant="cancel" onClick={close}>
            Done
          </BrandButton>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid) return;
            const r = await roll.fire({ campaignId, watchers: values });
            if (r) setResult(r);
          }}
        >
          <p className="m-0 text-[14px] text-[#9fb2b6]">
            Keep Watch: each watcher rolls their Hope Die. The party can replace your roll with the highest.
          </p>
          {watchers.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2 text-[14px]">
                Watcher {i + 1} Hope Die
                <input
                  inputMode="numeric"
                  value={w}
                  onChange={(e) => setWatchers(watchers.map((x, j) => (j === i ? e.target.value : x)))}
                  className={cn(INPUT, "w-20")}
                />
              </label>
              <BrandButton
                variant="danger"
                size="sm"
                aria-label={`Remove watcher ${i + 1}`}
                onClick={() => setWatchers(watchers.filter((_, j) => j !== i))}
              >
                Remove
              </BrandButton>
            </div>
          ))}
          <BrandButton variant="neutral" size="sm" disabled={watchers.length >= MAX_WATCHERS} onClick={() => setWatchers([...watchers, ""])}>
            + Add watcher
          </BrandButton>
          <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
            {roll.error}
          </p>
          <BrandButton type="submit" variant="confirm" disabled={!valid || roll.pending}>
            Roll d12
          </BrandButton>
        </form>
      )}
    </Modal>
  );
}
