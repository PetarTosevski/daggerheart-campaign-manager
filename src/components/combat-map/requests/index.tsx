"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DrawerBoundary } from "../drawer/boundary";
import { CloakPrompts } from "./cloak";
import "./requests.css";

/**
 * Rolls waiting for the GM's Difficulty (plan lanes B2; CB p.104: "The GM sets this Difficulty"):
 * - a player's Charge (CB p.59; dcm-bxp.99.19.61): the player picked the target and the square in the drawer;
 * - a Cloaked rogue who ended a move seen only dimly by enemies none of which has a Difficulty (a custom token, an
 *   enemy-side PC or companion; CB p.42; dcm-bxp.99.19.62 (1)).
 * The GM types a Difficulty and presses Roll (`featurePrompts.answerDifficulty`: the server rolls), or Decline. Rows come
 * from `combatRequests.difficulties`; an optimistic update drops the answered row at once.
 */

export type DifficultyRow = FunctionReturnType<typeof api.combatRequests.difficulties>[number];

/** What a row asks for, in a line ("Ash charges at Bear", "Ash is Cloaked in dim light, seen by Shade"). */
export function difficultyText(row: Pick<DifficultyRow, "ask" | "characterName" | "target" | "seers">): string {
  if (row.ask === "charge") return `${row.characterName} charges at ${row.target?.name ?? "a target"}: Agility Roll`;
  const seers = row.seers.map((s) => s.name).join(", ");
  return `${row.characterName} is Cloaked in dim light${seers ? `, seen by ${seers}` : ""}: Finesse Roll`;
}

/** The result line of an answer. */
export function answerLine(out: FunctionReturnType<typeof api.featurePrompts.answerDifficulty>): string {
  switch (out.status) {
    case "declined":
      return "Declined.";
    case "stale":
      return "The move no longer stands: nothing rolled.";
    case "rolled":
      return out.cloaked ? "Finesse Roll succeeded: stays Cloaked." : "Finesse Roll failed: no longer Cloaked.";
    case "charged":
      return `${out.use.roll ? `Rolled ${out.use.roll.total}` : "Rolled"}: ${out.moved ? "charged into Melee." : "the Agility Roll failed, the token stays."}`;
  }
}

/**
 * The GM's list. `characterId` / `ask` narrow it (the drawer shows a character's waiting Charge); unset, every waiting
 * roll of the campaign (the GM column). Renders nothing while loading or when nothing waits.
 */
export function DifficultyRequests({ campaignId, characterId, ask }: { campaignId: Id<"campaigns">; characterId?: Id<"characters">; ask?: DifficultyRow["ask"] }) {
  // Plan lanes-2 E1.4a (dcm-vx5n): the GM column (no filter) also lists the "Does <name>'s Cloaked end?" prompts.
  const column = characterId === undefined && ask === undefined;
  return (
    <>
      <DrawerBoundary label="Difficulty requests">
        <DifficultyList campaignId={campaignId} {...(characterId === undefined ? {} : { characterId })} {...(ask === undefined ? {} : { ask })} />
      </DrawerBoundary>
      {column ? (
        <DrawerBoundary label="Cloaked prompts">
          <CloakPrompts campaignId={campaignId} />
        </DrawerBoundary>
      ) : null}
    </>
  );
}

function DifficultyList({ campaignId, characterId, ask }: { campaignId: Id<"campaigns">; characterId?: Id<"characters">; ask?: DifficultyRow["ask"] }) {
  const rows = useQuery(api.combatRequests.difficulties, { campaignId });
  const answer = useMutation(api.featurePrompts.answerDifficulty).withOptimisticUpdate((store, { requestId }) => {
    const current = store.getQuery(api.combatRequests.difficulties, { campaignId });
    if (current !== undefined) store.setQuery(api.combatRequests.difficulties, { campaignId }, current.filter((r) => r.requestId !== requestId));
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const waiting = (rows ?? []).filter((r) => (characterId === undefined || r.characterId === characterId) && (ask === undefined || r.ask === ask));
  if (waiting.length === 0 && !error && !result) return null;

  async function send(requestId: Id<"combatRequests">, difficulty: number | null) {
    setError(null);
    setResult(null);
    setPending(true);
    try {
      setResult(answerLine(await answer({ campaignId, requestId, difficulty, idempotencyKey: crypto.randomUUID() })));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="dfr" data-testid="difficulty-requests">
      <span className="cm-lbl">Waiting for your Difficulty</span>
      {waiting.length > 0 ? (
        <ul className="dfr-list" aria-label="Rolls waiting for your Difficulty">
          {waiting.map((r) => {
            const text = difficultyText(r);
            const raw = values[r.requestId] ?? "";
            const n = Number(raw);
            const ok = raw !== "" && Number.isInteger(n) && n > 0;
            return (
              <li key={r.requestId} className="dfr-row" data-testid="difficulty-request">
                <span className="dfr-text">{text}</span>
                <span className="dfr-actions">
                  <input
                    type="number"
                    min={1}
                    className="cm-in dfr-num"
                    aria-label={`Difficulty: ${text}`}
                    value={raw}
                    onChange={(e) => setValues((v) => ({ ...v, [r.requestId]: e.target.value }))}
                  />
                  <button type="button" className="cm-btn cm-sm" disabled={pending || !ok} aria-label={`Roll: ${text}`} onClick={() => void send(r.requestId, n)}>
                    Roll
                  </button>
                  <button type="button" className="cm-btn cm-sm cm-danger" disabled={pending} aria-label={`Decline: ${text}`} onClick={() => void send(r.requestId, null)}>
                    Decline
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {result ? (
        <p role="status" className="dfr-result">
          {result}
        </p>
      ) : null}
      <p aria-live="polite" className="sd-error">
        {error}
      </p>
    </div>
  );
}

/** A player's own waiting roll for one character (the drawer's "waiting for the GM"), or null. */
export function useWaitingDifficulty(campaignId: Id<"campaigns">, characterId: Id<"characters">, ask: DifficultyRow["ask"]): DifficultyRow | null {
  const rows = useQuery(api.combatRequests.difficulties, { campaignId });
  return (rows ?? []).find((r) => r.characterId === characterId && r.ask === ask) ?? null;
}
