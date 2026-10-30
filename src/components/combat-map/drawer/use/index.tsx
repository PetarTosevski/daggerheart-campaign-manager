"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { FeatureUseProps } from "../../slots";
import { DrawerBoundary } from "../boundary";
import { DifficultyRequests, useWaitingDifficulty } from "../../requests";
import { chargeLine, serverUseOf, squareLabels, targetLabel, validAllies } from "./model";
import "./use.css";

/**
 * One feature's Use flow inside the sheet drawer. The general flow (plan sheet-drawer, SD7: the Hand's choices and
 * targets dialog) is not built; this renders the server-decided uses (plan lanes, B1; dcm-bxp.99.19.56) and nothing for
 * the others:
 *
 * - Warden's Protection (CB p.31: "Once per long rest, spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close
 *   range."; user 2026-10-29, dcm-d95): Roll 1d4 (`featurePrompts.rollCount`; the roll holds until it is used or the
 *   scene ends), then pick up to that many allies in range and Use (`combatFeatures.useFeature`).
 * - Charge (CB p.59: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or
 *   more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."; user
 *   2026-10-29 / 2026-10-30): the target at Far or Very Far range, the square in Melee range of it, the Stress, then the
 *   roll (`featurePrompts.charge`). The Agility Roll's Difficulty is the GM's (CB p.104): the GM playing for the
 *   character types it; a player's Charge goes to the GM as a request (plan lanes B2, dcm-bxp.99.19.61), and the drawer
 *   shows it waiting until the GM answers (the GM's drawer lists it with a Difficulty box, `DifficultyRequests`).
 */
export function FeatureUse({ campaignId, role, map, characterId, featureId, useId, onClose }: FeatureUseProps) {
  const server = serverUseOf(featureId, useId);
  if (server === null) return null;
  const mapId = map?.live ? map._id : undefined;
  return (
    <section className="sdu-panel" aria-label={server.name} data-testid="sheet-drawer-use">
      <div className="sdu-head">
        <h3 className="sdu-title">{server.name}</h3>
        <button type="button" className="cm-btn cm-sm" aria-label={`Close ${server.name}`} onClick={onClose}>
          ✕
        </button>
      </div>
      <DrawerBoundary label={server.name}>
        {mapId === undefined ? (
          <p className="cm-muted">Needs the live map.</p>
        ) : server.kind === "count" ? (
          <CountUse campaignId={campaignId} characterId={characterId} mapId={mapId} featureId={featureId} useId={server.use.id} name={server.name} range={server.range} />
        ) : (
          <ChargeUse campaignId={campaignId} characterId={characterId} mapId={mapId} gm={role === "gm"} />
        )}
      </DrawerBoundary>
    </section>
  );
}

type Here = { campaignId: Id<"campaigns">; characterId: Id<"characters">; mapId: Id<"combatMaps"> };

function CountUse({ campaignId, characterId, mapId, featureId, useId, name, range }: Here & { featureId: string; useId: string; name: string; range: string }) {
  const view = useQuery(api.featurePrompts.targetCount, { campaignId, characterId, featureId, useId, mapId });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const rollCount = useMutation(api.featurePrompts.rollCount);
  const sendUse = useMutation(api.combatFeatures.useFeature).withOptimisticUpdate((store, args) => {
    // The roll is spent by the use: drop it at once (the server resolves its row).
    const q = { campaignId: args.campaignId, characterId: args.characterId, featureId: args.featureId, useId, mapId };
    const value = store.getQuery(api.featurePrompts.targetCount, q);
    if (value) store.setQuery(api.featurePrompts.targetCount, q, { ...value, roll: null });
  });
  if (view === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading…
      </p>
    );
  }
  async function run(work: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const roll = view.roll;
  const chosen = roll ? validAllies(view, picked, roll.count) : [];
  const names = new Map(view.allies.map((a) => [a.tokenId as string, a.name]));
  return (
    <div className="sdu-body">
      {result ? (
        <p role="status" className="sdu-result" data-testid="server-use-result">
          {result}
        </p>
      ) : null}
      {roll === null ? (
        <button
          type="button"
          className="cm-btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const out = await rollCount({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, featureId, useId });
              setPicked([]);
              setResult(`Rolled ${out.count}: pick up to ${out.count} ${out.count === 1 ? "ally" : "allies"}.`);
            })
          }
        >
          Roll the number of allies
        </button>
      ) : (
        <>
          <p className="sdu-note" data-testid="server-use-count">
            Rolled {roll.count}: up to {roll.count} {roll.count === 1 ? "ally" : "allies"} within {range} range. The roll holds until you use it or the scene ends.
          </p>
          {view.allies.length === 0 ? <p className="cm-muted">No ally on the map.</p> : null}
          <fieldset className="sdu-allies">
            <legend className="cm-lbl">Allies</legend>
            {view.allies.map((a) => {
              const on = chosen.includes(a.tokenId);
              const full = chosen.length >= roll.count;
              return (
                <label key={a.tokenId} className="sd-check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!a.inRange || (full && !on)}
                    onChange={(e) => setPicked(e.target.checked ? [...chosen, a.tokenId] : chosen.filter((id) => id !== a.tokenId))}
                  />
                  <span>{a.inRange ? a.name : `${a.name} (out of range)`}</span>
                </label>
              );
            })}
          </fieldset>
          <button
            type="button"
            className="cm-btn"
            disabled={busy || chosen.length === 0}
            onClick={() =>
              void run(async () => {
                const out = await sendUse({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, mapId, featureId, useId, targetTokenIds: chosen as Id<"combatTokens">[], choices: [] });
                if (out.status === "pending") setResult(`${name}: waiting for the GM to approve.`);
                else if (out.status === "needsChoice") setError("This use needs another choice.");
                else {
                  setPicked([]);
                  setResult(`${name} used on ${out.targets.map((t) => names.get(t.tokenId) ?? "an ally").join(", ")}.`);
                }
              })
            }
          >
            Use {name}
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="sd-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ChargeUse({ campaignId, characterId, mapId, gm }: Here & { gm: boolean }) {
  const ids = { target: useId(), square: useId(), stress: useId(), difficulty: useId() };
  const options = useQuery(api.featurePrompts.chargeOptions, { campaignId, characterId, mapId });
  const [targetId, setTargetId] = useState("");
  const [squareIndex, setSquareIndex] = useState("");
  const [stress, setStress] = useState(true);
  const [difficulty, setDifficulty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const charge = useMutation(api.featurePrompts.charge);
  const waiting = useWaitingDifficulty(campaignId, characterId, "charge");
  if (options === undefined) {
    return (
      <p role="status" className="cm-muted">
        Loading…
      </p>
    );
  }
  const target = options.find((t) => t.tokenId === targetId) ?? null;
  const labels = target ? squareLabels(target) : [];
  const square = target ? (target.squares[Number(squareIndex)] ?? null) : null;
  const diff = difficulty === "" ? undefined : Number(difficulty);
  // B2 (dcm-bxp.99.19.61): the GM types the Difficulty; a player's Charge goes to the GM, who sets it and rolls.
  const ready = target !== null && square !== null && (!gm || (diff !== undefined && Number.isInteger(diff) && diff > 0)) && (gm || waiting === null);
  async function go() {
    if (!target || !square || (gm && diff === undefined)) return;
    setError(null);
    setBusy(true);
    try {
      const out = await charge({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, mapId, targetTokenId: target.tokenId, square: { x: square.x, y: square.y }, stress, roll: gm && diff !== undefined ? { difficulty: diff } : {} });
      if (out.status === "needsChoice") setError("Charge needs another choice.");
      else if (out.status === "requested") {
        setResult(`Charge at ${target.name} sent to the GM, who sets the Difficulty and rolls.`);
        setTargetId("");
        setSquareIndex("");
      } else {
        // Every enemy in Melee range of the square may be hit, seen or not: name the ones the drawer knows.
        const names = new Map(options!.map((t) => [t.tokenId as string, t.name]));
        setResult(chargeLine(out.moved, out.use, names));
        setTargetId("");
        setSquareIndex("");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sdu-body">
      {result ? (
        <p role="status" className="sdu-result" data-testid="server-use-result">
          {result}
        </p>
      ) : null}
      {options.length === 0 ? (
        <p className="cm-muted">No enemy in sight at Far or Very Far range.</p>
      ) : (
        <>
          <div className="sdu-row">
            <label htmlFor={ids.target} className="cm-lbl">
              Charge at
            </label>
            <select
              id={ids.target}
              value={target ? targetId : ""}
              onChange={(e) => {
                setTargetId(e.target.value);
                setSquareIndex("");
              }}
            >
              <option value="">Pick a target</option>
              {options.map((t) => (
                <option key={t.tokenId} value={t.tokenId}>
                  {targetLabel(t)}
                </option>
              ))}
            </select>
          </div>
          {target ? (
            target.squares.length === 0 ? (
              <p className="cm-muted">No free square next to {target.name} that you can reach.</p>
            ) : (
              <div className="sdu-row">
                <label htmlFor={ids.square} className="cm-lbl">
                  Square in Melee range
                </label>
                <select id={ids.square} value={square ? squareIndex : ""} onChange={(e) => setSquareIndex(e.target.value)}>
                  <option value="">Pick a square</option>
                  {target.squares.map((q, i) => (
                    <option key={`${q.x}:${q.y}`} value={String(i)}>
                      {labels[i]}
                    </option>
                  ))}
                </select>
              </div>
            )
          ) : null}
          <label htmlFor={ids.stress} className="sd-check">
            <input id={ids.stress} type="checkbox" checked={stress} onChange={(e) => setStress(e.target.checked)} />
            <span>On a success, mark a Stress to deal 1d12 physical damage to every enemy within Melee range</span>
          </label>
          {gm ? (
            <div className="sdu-row">
              <label htmlFor={ids.difficulty} className="cm-lbl">
                Difficulty of the Agility Roll
              </label>
              <input id={ids.difficulty} type="number" min={1} className="cm-in sdu-num" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
            </div>
          ) : waiting !== null ? (
            <p className="sdu-note" data-testid="charge-waiting">
              Waiting for the GM: Charge at {waiting.target?.name ?? "the target"}. The GM sets the Difficulty of the Agility Roll and rolls it.
            </p>
          ) : (
            <p className="sdu-note">The GM sets the Difficulty of the Agility Roll: your Charge goes to the GM, who rolls it.</p>
          )}
          <button type="button" className="cm-btn" disabled={busy || !ready} onClick={() => void go()}>
            Roll Agility and charge
          </button>
          {gm ? <DifficultyRequests campaignId={campaignId} characterId={characterId} ask="charge" /> : null}
        </>
      )}
      {error ? (
        <p role="alert" className="sd-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
