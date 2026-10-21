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
import { DiceTiles, rollHeadline } from "./parts";

const COST = 3;

/** A Tag Team Roll waiting for its pick (`rolls.pendingChoices`): `entryId` is the initiator's roll. */
export type PendingTagTeam = { entryId: Id<"actionLog">; rolls: { characterId: Id<"characters">; entryId: Id<"actionLog">; roll: RollRecord; name: string }[] };

/**
 * Tag Team Roll (CB 97): spend 3 Hope once per session, both PCs roll, then
 * pick the roll that counts for both. The partner's sheet changes only through
 * this action (decision 7), logged on both characters. The pick is offered in
 * both participants' dice boxes (U9: either player, or the GM, chooses).
 */
export function TagTeam({ campaignId, character, disabled, pending }: { campaignId: Id<"campaigns">; character: CharacterView; disabled: boolean; pending: PendingTagTeam | null }) {
  const [open, setOpen] = useState(false);
  const party = useQuery(api.characters.listByCampaign, open ? { campaignId } : "skip");
  const [partnerId, setPartnerId] = useState("");
  const [mine, setMine] = useState<TraitId>("agility");
  const [theirs, setTheirs] = useState<TraitId>("agility");
  const [difficulty, setDifficulty] = useState("");
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
    // The pick shows from `rolls.pendingChoices`, in both participants' boxes.
    if (out) setOpen(true);
  }

  async function pick(entryId: Id<"actionLog">, characterId: Id<"characters">, name: string) {
    const out = await apply.fire({ entryId, pick: characterId });
    if (out) {
      setApplied(`${name}’s roll counts for both${out.fearGained > 0 ? `; the GM gains ${out.fearGained} Fear` : ""}.`);
    }
  }

  // After a pick the confirmation stays until closed, also in a box whose panel was never opened (the partner's,
  // dcm-bxp.67): `pending` empties as soon as the pick lands.
  if (applied !== null && pending === null) {
    return (
      <section aria-label="Tag Team Roll" className="dc-tag">
        <div className="flex items-center justify-between gap-2">
          <span className="sh-lbl">Tag Team Roll</span>
          <button
            type="button"
            className="sh-pill"
            onClick={() => {
              setApplied(null);
              setOpen(false);
            }}
          >
            Close
          </button>
        </div>
        <p role="status" className="sh-small m-0">
          {applied}
        </p>
      </section>
    );
  }

  if (!open && pending === null) {
    return (
      <div>
        <button type="button" className="sh-pill" disabled={disabled} onClick={() => setOpen(true)}>
          Tag Team Roll…
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Tag Team Roll" className="dc-tag">
      <div className="flex items-center justify-between gap-2">
        <span className="sh-lbl">Tag Team Roll ({COST} Hope, once per session)</span>
        {pending === null ? (
          <button type="button" className="sh-pill" onClick={() => setOpen(false)}>
            Close
          </button>
        ) : null}
      </div>
      {used && pending === null ? <p className="sh-small m-0 italic">You already started a Tag Team Roll this session.</p> : null}
      {pending ? (
        <div className="flex flex-col gap-2">
          <p className="sh-small m-0">Choose the roll that counts for both:</p>
          {pending.rolls.map((r) => (
            <div key={r.entryId} className="flex flex-wrap items-center gap-3">
              <span className="dc-tag-name">
                {r.name}: {rollHeadline(r.roll)}
              </span>
              <DiceTiles roll={r.roll} />
              <button type="button" className="sh-pill solid" disabled={apply.pending} onClick={() => void pick(pending.entryId, r.characterId, r.name)}>
                Use {r.name}’s roll
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="dc-tag-grid">
          <label className="dc-field">
            <span className="sh-lbl">Partner</span>
            <select className="dc-in" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">{party === undefined ? "Loading the party…" : "Choose a partner"}</option>
              {partners.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.sheet.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dc-field">
            <span className="sh-lbl">Difficulty</span>
            <input className="dc-in" inputMode="numeric" placeholder="GM’s call" value={difficulty} onChange={(e) => setDifficulty(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
          </label>
          <label className="dc-field">
            <span className="sh-lbl">Your trait</span>
            <select className="dc-in" value={mine} onChange={(e) => setMine(e.target.value as TraitId)}>
              {TRAIT_IDS.map((t) => (
                <option key={t} value={t}>
                  {TRAIT_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="dc-field">
            <span className="sh-lbl">Partner’s trait</span>
            <select className="dc-in" value={theirs} onChange={(e) => setTheirs(e.target.value as TraitId)}>
              {TRAIT_IDS.map((t) => (
                <option key={t} value={t}>
                  {TRAIT_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button type="button" className="sh-pill solid" disabled={disabled || used || !partner || character.sheet.hope < COST || start.pending} onClick={() => void begin()}>
              Roll together ({COST} Hope)
            </button>
          </div>
        </div>
      )}
      <p aria-live="polite" className="sh-small m-0 empty:hidden">
        {start.error ?? apply.error}
      </p>
    </section>
  );
}
