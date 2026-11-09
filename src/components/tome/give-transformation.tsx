"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { transformationConfirm, transformationName } from "@/lib/domain/transformations";
import type { TomeRule } from "@/lib/frames/tomes";
import { TRANSFORMATIONS } from "@/lib/srd";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Colours from the Tome* boards (tome-book.tsx).
const RUBRIC = "#8e2b2b";

/** The transformation a tome rule is about ("Transformations: Reanimated" → "reanimated"), or null. */
export function transformationOfRule(rule: Pick<TomeRule, "head">): string | null {
  const name = /^Transformations:\s*(.+)$/.exec(rule.head)?.[1]?.trim();
  return TRANSFORMATIONS.find((t) => t.name === name)?.id ?? null;
}

/**
 * The GM's "Give to…" under a transformation rule of the Dark Heart of Andaluria's tome (bead dcm-psg9): opens the party
 * (read only while open), and a click gives that PC the transformation through `characters.setTransformation`. A PC who
 * already has another one, and Reanimated's loadout cut (HF p.153), ask first. The picked PC shows "Giving…" at once.
 */
export function GiveTransformation({
  campaignId,
  transformationId,
  andaluriaReanimated,
}: {
  campaignId: Id<"campaigns">;
  transformationId: string;
  andaluriaReanimated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Id<"characters"> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const party = useQuery(api.charactersReads.partySummary, open ? { campaignId } : "skip");
  const give = useMutation(api.characters.setTransformation);
  const listId = useId();
  const name = transformationName(transformationId);

  const pick = async (characterId: Id<"characters">, pcName: string, current: string | null) => {
    const question = transformationConfirm(pcName, current, transformationId, andaluriaReanimated);
    if (question !== null && !window.confirm(question)) return;
    setBusy(characterId);
    setStatus(null);
    try {
      const result = await give({ characterId, transformationId });
      const cut = result.vaulted.length > 0 ? ` Maximum loadout ${result.loadoutMax}; ${result.vaulted.length} to the vault.` : "";
      setStatus(`${pcName} is now ${name}.${cut}`);
      setOpen(false);
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="min-h-11 cursor-pointer self-start rounded border-2 bg-transparent px-3.5 font-display text-[14px] font-bold tracking-[0.06em]"
        style={{ borderColor: RUBRIC, color: RUBRIC }}
      >
        Give {name} to…
      </button>
      {open ? (
        <ul id={listId} aria-label={`Give ${name} to`} className="m-0 flex list-none flex-col gap-1 p-0">
          {party === undefined ? (
            <li className="text-[16px] italic">Opening the party…</li>
          ) : party.length === 0 ? (
            <li className="text-[16px] italic">No characters in this campaign yet.</li>
          ) : (
            party.map((pc) => {
              const current = pc.sheet.transformationId ?? (pc.sheet.ancestry.kind === "shapeshifter" ? "shapeshifter" : null);
              const has = current === transformationId;
              // A Shapeshifter ancestry is a form of that transformation and keeps it (the server refuses, INVALID).
              const form = pc.sheet.ancestry.kind === "shapeshifter";
              return (
                <li key={pc._id}>
                  <button
                    type="button"
                    disabled={has || form || busy !== null}
                    onClick={() => void pick(pc._id, pc.sheet.name, current)}
                    className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded border border-[#cdb88f] bg-[#efe3c8] px-3 py-1.5 text-left text-[16px] disabled:cursor-default disabled:opacity-70"
                  >
                    <span className="font-medium">{pc.sheet.name}</span>
                    <span className="text-[14px] text-[#6a5236]">
                      {busy === pc._id ? "Giving…" : has ? `Already ${name}` : form ? "Shapeshifter form" : current ? `Now ${transformationName(current)}` : pc.status === "active" ? "" : pc.status}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
      <p aria-live="polite" className="m-0 text-[15px] text-[#4a3a26]">
        {status ?? ""}
      </p>
    </div>
  );
}
