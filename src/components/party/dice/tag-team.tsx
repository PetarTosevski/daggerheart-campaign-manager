"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import type { RollRecord } from "@/lib/domain/duality";
import { TRAIT_LABEL } from "@/lib/frames/extras/common";
import { TRAIT_IDS, type TraitId } from "@/lib/srd/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../convex/characters";
import { DiceFaces, rollHeadline } from "./parts";

const COST = 3;

type Pending = { rolls: { characterId: Id<"characters">; entryId: Id<"actionLog">; roll: RollRecord; name: string }[] };

/**
 * Tag Team Roll (CB 97): spend 3 Hope once per session, both PCs roll, then
 * pick the roll that counts for both. The partner's sheet changes only through
 * this action (decision 7), logged on both characters.
 */
export function TagTeam({ campaignId, character, disabled }: { campaignId: Id<"campaigns">; character: CharacterView; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const party = useQuery(api.characters.listByCampaign, open ? { campaignId } : "skip");
  const [partnerId, setPartnerId] = useState("");
  const [mine, setMine] = useState<TraitId>("agility");
  const [theirs, setTheirs] = useState<TraitId>("agility");
  const [difficulty, setDifficulty] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const start = useIntent(api.rolls.tagTeam);
  const apply = useIntent(api.rolls.tagTeamApply);

  const used = (character.sheet.featureUses ?? []).some((u) => u.key === "tagTeam");
  const partners = (party ?? []).filter(
    (c) => c._id !== character._id && c.status === "active" && !(c.sheet.conditions ?? []).includes("unconscious") && !c.corrupt,
  );
  const partner = partners.find((c) => c._id === partnerId);

  async function begin() {
    if (!partner) return;
    setApplied(null);
    const diff = Number.parseInt(difficulty, 10);
    const out = await start.fire({
      characterId: character._id,
      partnerId: partner._id,
      ...(Number.isFinite(diff) ? { difficulty: diff } : {}),
      initiator: { trait: mine, modifier: 0 },
      partner: { trait: theirs, modifier: 0 },
    });
    if (out) {
      const names = new Map([
        [character._id, character.sheet.name],
        [partner._id, partner.sheet.name],
      ]);
      setPending({ rolls: out.rolls.map((r) => ({ ...r, name: names.get(r.characterId) ?? "" })) });
    }
  }

  async function pick(entryId: Id<"actionLog">, characterId: Id<"characters">, name: string) {
    const out = await apply.fire({ entryId, pick: characterId });
    if (out) {
      setPending(null);
      setApplied(`${name}’s roll counts for both${out.fearGained > 0 ? `; the GM gains ${out.fearGained} Fear` : ""}.`);
    }
  }

  if (!open) {
    return (
      <div>
        <button type="button" className="cs-pill" disabled={disabled} onClick={() => setOpen(true)}>
          Tag Team Roll…
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Tag Team Roll" className="flex flex-col gap-3 rounded-[10px] border border-[#d1b98b] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="cs-lbl">Tag Team Roll ({COST} Hope, once per session)</span>
        <button type="button" className="cs-pill !min-h-9" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {used ? <p className="cs-small m-0 italic">You already started a Tag Team Roll this session.</p> : null}
      {pending ? (
        <div className="flex flex-col gap-2">
          <p className="cs-small m-0">Choose the roll that counts for both:</p>
          {pending.rolls.map((r) => (
            <div key={r.entryId} className="flex flex-wrap items-center gap-3">
              <span className="font-display text-[18px]">
                {r.name}: {rollHeadline(r.roll)}
              </span>
              <DiceFaces dice={r.roll.dice} />
              <button type="button" className="cs-pill cs-solid" disabled={apply.pending} onClick={() => void pick(pending.rolls[0]!.entryId, r.characterId, r.name)}>
                Use {r.name}’s roll
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="cs-lbl">Partner</span>
            <select className="cs-in" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">{party === undefined ? "Loading the party…" : "Choose a partner"}</option>
              {partners.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.sheet.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cs-lbl">Difficulty</span>
            <input className="cs-in text-center" inputMode="numeric" placeholder="GM’s call" value={difficulty} onChange={(e) => setDifficulty(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="cs-lbl">Your trait</span>
            <select className="cs-in" value={mine} onChange={(e) => setMine(e.target.value as TraitId)}>
              {TRAIT_IDS.map((t) => (
                <option key={t} value={t}>
                  {TRAIT_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cs-lbl">Partner’s trait</span>
            <select className="cs-in" value={theirs} onChange={(e) => setTheirs(e.target.value as TraitId)}>
              {TRAIT_IDS.map((t) => (
                <option key={t} value={t}>
                  {TRAIT_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button type="button" className="cs-pill cs-solid" disabled={disabled || used || !partner || character.sheet.hope < COST || start.pending} onClick={() => void begin()}>
              Roll together ({COST} Hope)
            </button>
          </div>
        </div>
      )}
      <p aria-live="polite" className="cs-small m-0 empty:hidden">
        {start.error ?? apply.error ?? applied}
      </p>
    </section>
  );
}
