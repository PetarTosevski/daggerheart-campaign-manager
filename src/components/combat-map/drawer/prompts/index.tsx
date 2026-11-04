"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CombatMapSummary, CombatRole } from "../../slots";
import type { Drawer } from "../list/model";
import { resultLine, secondCandidates, throwFeatures, type AllyAsk, type AllyRolls } from "./model";
import "./prompts.css";

/**
 * Prompts in the sheet drawer (plan drawer-answers, DA13): a use another PC rolls (CB p.33 Cannonball: "Mark a Stress to
 * allow an ally to throw or launch you at an adversary. To do so, the ally makes an attack roll using Agility or Strength
 * (their choice) against a target within Close range."; user 2026-10-29 / 2026-10-30, dcm-bxp.99.19.21).
 *
 * - The druid (their drawer, in the form): pick the ally on the map and "Ask to throw" (`combatFeatures.useFeature`: the
 *   Stress is paid, the ally gets the prompt); then "Waiting for <ally>".
 * - The throwing ally (their drawer): Agility or Strength, the target within Close range, the druid's Hope for a second
 *   target within Very Close range of the first (half damage), Roll (`featurePrompts.allyRoll`); the result says Hit /
 *   Miss / Defeated only (U1).
 * - The GM: every open throw with Cancel (`featurePrompts.cancelAllyRoll`).
 */
export function DrawerPrompts({
  campaignId,
  role,
  map,
  characterId,
  drawer,
  canAct,
}: {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  map: CombatMapSummary | null;
  characterId: Id<"characters">;
  drawer: Drawer;
  canAct: boolean;
}) {
  const mapId = map?.live ? map._id : undefined;
  const view = useQuery(api.featurePrompts.allyRolls, { campaignId, characterId, ...(mapId ? { mapId } : {}) });
  const [result, setResult] = useState<string | null>(null);
  const throws = throwFeatures(drawer);
  if (view === undefined) {
    return throws.length > 0 ? (
      <p role="status" className="cm-muted">
        Loading prompts…
      </p>
    ) : null;
  }
  const empty = view.asks.length === 0 && view.waiting.length === 0 && throws.length === 0 && view.pending.length === 0 && result === null;
  if (empty) return null;
  return (
    <section className="sdp-prompts" aria-label="Prompts" data-testid="sheet-drawer-prompts">
      {view.asks.map((ask) => (
        <AskCard key={ask.requestId} campaignId={campaignId} ask={ask} canAct={canAct} onResult={setResult} />
      ))}
      {result ? (
        <p role="status" className="sdp-result" data-testid="ally-roll-result">
          {result}
        </p>
      ) : null}
      {view.waiting.map((w) => (
        <p key={w.requestId} className="sdp-waiting" data-testid="ally-roll-waiting">
          {w.featureName}: waiting for {w.rollerName} to make the roll.
        </p>
      ))}
      {view.waiting.length === 0
        ? throws.map((t) => (
            <ThrowStart key={t.feature.featureId} campaignId={campaignId} characterId={characterId} mapId={mapId} featureId={t.feature.featureId} featureUseId={t.useId} name={t.feature.name} ready={t.ready} allies={view.allies} canAct={canAct} />
          ))
        : null}
      {role === "gm" && view.pending.length > 0 ? <GmPending campaignId={campaignId} pending={view.pending} /> : null}
    </section>
  );
}

function ThrowStart({
  campaignId,
  characterId,
  mapId,
  featureId,
  featureUseId,
  name,
  ready,
  allies,
  canAct,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  mapId: Id<"combatMaps"> | undefined;
  featureId: string;
  featureUseId: string;
  name: string;
  ready: boolean;
  allies: AllyRolls["allies"];
  canAct: boolean;
}) {
  const selectId = useId();
  const [ally, setAlly] = useState<Id<"combatTokens"> | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sendUse = useMutation(api.combatFeatures.useFeature);
  const picked = allies.some((a) => a.tokenId === ally) ? ally : "";
  async function ask() {
    if (!mapId || picked === "") return;
    setError(null);
    setBusy(true);
    try {
      const out = await sendUse({ campaignId, idempotencyKey: crypto.randomUUID(), characterId, mapId, featureId, useId: featureUseId, targetTokenIds: [picked], choices: [] });
      if (out.status === "pending") setError("Waiting for the GM to approve.");
      else if (out.status === "needsChoice") setError("This use needs another choice.");
      else setAlly("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sdp-card" data-testid="ally-roll-start">
      <p className="sdp-title">{name}: an ally throws you</p>
      {mapId === undefined ? (
        <p className="cm-muted">Needs the live map.</p>
      ) : allies.length === 0 ? (
        <p className="cm-muted">No ally on the map to throw you.</p>
      ) : (
        <div className="sdp-row">
          <label htmlFor={selectId} className="cm-lbl">
            Ally who throws you
          </label>
          <select id={selectId} value={picked} disabled={!canAct} onChange={(e) => setAlly(e.target.value as Id<"combatTokens"> | "")}>
            <option value="">Pick an ally</option>
            {allies.map((a) => (
              <option key={a.tokenId} value={a.tokenId}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="button" className="cm-btn cm-sm" disabled={!canAct || !ready || picked === "" || busy} onClick={() => void ask()}>
            Ask to throw · 1 Stress
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="sd-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AskCard({ campaignId, ask, canAct, onResult }: { campaignId: Id<"campaigns">; ask: AllyAsk; canAct: boolean; onResult: (line: string) => void }) {
  const ids = { trait: useId(), target: useId(), second: useId(), secondTarget: useId() };
  const [trait, setTrait] = useState<"agility" | "strength">("strength");
  const [target, setTarget] = useState<Id<"combatTokens"> | "">("");
  const [useSecond, setUseSecond] = useState(false);
  const [second, setSecond] = useState<Id<"combatTokens"> | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roll = useMutation(api.featurePrompts.allyRoll).withOptimisticUpdate((store, args) => {
    for (const q of store.getAllQueries(api.featurePrompts.allyRolls)) {
      if (q.value === undefined) continue;
      store.setQuery(api.featurePrompts.allyRolls, q.args, { ...q.value, asks: q.value.asks.filter((a) => a.requestId !== args.requestId) });
    }
  });
  const first = ask.enemies.some((e) => e.tokenId === target && e.inRange) ? (target as Id<"combatTokens">) : null;
  const candidates = secondCandidates(ask, first);
  const secondPick = useSecond && candidates.some((c) => c.tokenId === second) ? (second as Id<"combatTokens">) : null;
  const names = new Map(ask.enemies.map((e) => [e.tokenId as string, e.name]));
  async function go() {
    if (first === null) return;
    setError(null);
    setBusy(true);
    try {
      const out = await roll({ campaignId, idempotencyKey: crypto.randomUUID(), requestId: ask.requestId, trait, targetTokenId: first, ...(secondPick ? { secondTokenId: secondPick } : {}) });
      onResult(out.status === "closed" ? `${ask.featureName}: that throw was withdrawn.` : `${ask.characterName} thrown. ${resultLine(out, names)}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sdp-card" data-testid="ally-roll-ask">
      <p className="sdp-title">
        {ask.characterName}&apos;s {ask.featureName}: throw them at an adversary
      </p>
      <fieldset className="sdp-traits" disabled={!canAct}>
        <legend className="cm-lbl" id={ids.trait}>
          Roll with
        </legend>
        {(["agility", "strength"] as const).map((t) => (
          <label key={t} className="sd-check">
            <input type="radio" name={ids.trait} value={t} checked={trait === t} onChange={() => setTrait(t)} />
            <span>{t === "agility" ? "Agility" : "Strength"}</span>
          </label>
        ))}
      </fieldset>
      <div className="sdp-row">
        <label htmlFor={ids.target} className="cm-lbl">
          Target within Close range
        </label>
        <select id={ids.target} value={target} disabled={!canAct} onChange={(e) => setTarget(e.target.value as Id<"combatTokens"> | "")}>
          <option value="">Pick a target</option>
          {ask.enemies.map((e) => (
            <option key={e.tokenId} value={e.tokenId} disabled={!e.inRange}>
              {e.inRange ? e.name : `${e.name} (out of range)`}
            </option>
          ))}
        </select>
      </div>
      {ask.secondLabel ? (
        <div className="sdp-row">
          <label htmlFor={ids.second} className="sd-check">
            <input id={ids.second} type="checkbox" checked={useSecond} disabled={!canAct || ask.hope < 1 || candidates.length === 0} onChange={(e) => setUseSecond(e.target.checked)} />
            <span>
              Second target: spend 1 of {ask.characterName}&apos;s Hope ({ask.hope}); it takes half damage
            </span>
          </label>
          {useSecond && candidates.length > 0 ? (
            <>
              <label htmlFor={ids.secondTarget} className="cm-lbl">
                Second target within Very Close range
              </label>
              <select id={ids.secondTarget} value={second} disabled={!canAct} onChange={(e) => setSecond(e.target.value as Id<"combatTokens"> | "")}>
                <option value="">Pick a second target</option>
                {candidates.map((c) => (
                  <option key={c.tokenId} value={c.tokenId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="cm-btn" disabled={!canAct || first === null || busy || (useSecond && secondPick === null)} onClick={() => void go()}>
        Roll the throw
      </button>
      {error ? (
        <p role="alert" className="sd-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function GmPending({ campaignId, pending }: { campaignId: Id<"campaigns">; pending: AllyRolls["pending"] }) {
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation(api.featurePrompts.cancelAllyRoll).withOptimisticUpdate((store, args) => {
    for (const q of store.getAllQueries(api.featurePrompts.allyRolls)) {
      if (q.value === undefined) continue;
      const keep = <T extends { requestId: Id<"combatRequests"> }>(list: readonly T[]) => list.filter((r) => r.requestId !== args.requestId);
      store.setQuery(api.featurePrompts.allyRolls, q.args, { ...q.value, asks: keep(q.value.asks), waiting: keep(q.value.waiting), pending: keep(q.value.pending) });
    }
  });
  return (
    <div className="sdp-card" data-testid="ally-roll-pending">
      <p className="sdp-title">Waiting ally rolls</p>
      <ul className="sdp-list">
        {pending.map((p) => (
          <li key={p.requestId} className="sdp-row">
            <span>
              {p.characterName}&apos;s {p.featureName}: {p.rollerName} rolls
            </span>
            <button
              type="button"
              className="cm-btn cm-sm"
              aria-label={`Cancel ${p.characterName}'s ${p.featureName}`}
              onClick={() => {
                setError(null);
                cancel({ campaignId, idempotencyKey: crypto.randomUUID(), requestId: p.requestId }).catch((e: unknown) => setError(errorMessage(e)));
              }}
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="sd-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
