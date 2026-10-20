"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { CombatantsPanelProps } from "../slots";
import { SIDES } from "./sides";

type CustomSide = "enemy" | "ally" | "neutral";
const CUSTOM_SIDES: readonly CustomSide[] = ["enemy", "ally", "neutral"];
/** How long "Click again to clear" waits for the second click (the board). */
const CONFIRM_MS = 3000;

const idempotencyKey = () => crypto.randomUUID();

/**
 * GM, left column in Play (slot `CombatantsPanel`, D9 C6): the board's Combatants card. "＋ Party (n)" places the
 * active characters not yet on the map; "＋ Session encounter" (D10 S8, B11) starts the live (else newest planned)
 * session's encounter if needed and places its adversaries, titled 'Session N: 2× Bruiser, 1× Leader'; the
 * "From the Adversaries tab" queue places the running encounter's adversaries one by one or all at once (solo
 * adversaries 2 × 2); a custom token has a name, Hit Points and a side; "Clear tokens" asks for a second click.
 */
export function CombatantsPanel({ campaignId, map }: CombatantsPanelProps) {
  const mapId = map._id;
  const info = useQuery(api.combatTokens.combatants, { campaignId, mapId });
  const tokens = useQuery(api.combatTokens.list, { campaignId, mapId });
  const addParty = useMutation(api.combatTokens.addParty);
  const session = useQuery(api.combatTokens.sessionEncounter, { campaignId, mapId });
  const place = useMutation(api.combatTokens.placeAdversaries);
  const placeSessionEncounter = useMutation(api.combatTokens.placeSessionEncounter);
  const addCustom = useMutation(api.combatTokens.addCustom);
  const clear = useMutation(api.combatTokens.clear).withOptimisticUpdate((store, args) => {
    if (store.getQuery(api.combatTokens.list, { campaignId: args.campaignId, mapId }) !== undefined) {
      store.setQuery(api.combatTokens.list, { campaignId: args.campaignId, mapId }, []);
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [name, setName] = useState("");
  const [hp, setHp] = useState("");
  const [side, setSide] = useState<CustomSide>("enemy");

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  async function run(call: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await call();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const points = hp.trim() === "" ? 0 : Number(hp);
    if (n === "") return setError("Give the token a name.");
    if (!Number.isInteger(points) || points < 0 || points > 99) return setError("Hit Points must be a whole number from 0 to 99.");
    void run(async () => {
      await addCustom({ campaignId, mapId, name: n, hp: points, side, idempotencyKey: idempotencyKey() });
      setName("");
      setHp("");
    });
  }

  function placeSession() {
    setNotice(null);
    void run(async () => {
      const { n, added } = await placeSessionEncounter({ campaignId, mapId, idempotencyKey: idempotencyKey() });
      setNotice(added > 0 ? `Added Session ${n}'s encounter.` : `Session ${n}'s encounter is already on the map.`);
    });
  }

  if (info === undefined || tokens === undefined || session === undefined) {
    return (
      <section className="cm-card" aria-labelledby="cm-combatants-h">
        <h2 id="cm-combatants-h" className="cm-h">
          Combatants
        </h2>
        <p role="status" className="cm-muted cm-m0">
          Loading …
        </p>
      </section>
    );
  }

  const party = tokens.filter((t) => t.side === "pc").length;
  const enemies = tokens.filter((t) => t.side === "enemy").length;
  const count = tokens.length > 0 ? `${party} party · ${enemies} ${enemies === 1 ? "enemy" : "enemies"}` : "None placed";

  return (
    <section className="cm-card" aria-labelledby="cm-combatants-h">
      <div className="cm-row cm-between">
        <h2 id="cm-combatants-h" className="cm-h">
          Combatants
        </h2>
        <span className="cm-muted" data-testid="combat-token-count">
          {count}
        </span>
      </div>
      <div className="cm-row">
        <button
          type="button"
          className="cm-btn"
          disabled={info.partyLeft === 0 || pending}
          onClick={() => void run(() => addParty({ campaignId, mapId, idempotencyKey: idempotencyKey() }))}
        >
          ＋ Party ({info.partyLeft})
        </button>
        {/* D10 S8 (B11, Q2): the live (else newest planned) session's encounter; disabled without one. */}
        <button
          type="button"
          className="cm-btn"
          disabled={session.session === null || session.session.adversaries === 0 || pending}
          title={session.title}
          onClick={placeSession}
        >
          ＋ Session encounter
        </button>
        {tokens.length > 0 ? (
          <button
            type="button"
            className="cm-btn cm-danger"
            disabled={pending}
            onClick={() => {
              if (!confirmClear) return setConfirmClear(true);
              setConfirmClear(false);
              void run(() => clear({ campaignId, mapId }));
            }}
          >
            {confirmClear ? "Click again to clear" : "Clear tokens"}
          </button>
        ) : null}
      </div>

      {info.queue.length > 0 ? (
        <div className="cm-queue" role="group" aria-label="From the Adversaries tab">
          <span className="cm-lbl cm-queue-lbl">From the Adversaries tab</span>
          <div className="cm-row cm-tight">
            {info.queue.map((q) => (
              <button
                key={q.instanceId}
                type="button"
                className="cm-chip"
                disabled={pending}
                onClick={() => void run(() => place({ campaignId, mapId, instanceIds: [q.instanceId], idempotencyKey: idempotencyKey() }))}
              >
                ⚔ {q.name}
                {q.solo ? <span className="cm-muted cm-small"> · 2×2</span> : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="cm-btn cm-sm cm-self-start"
            disabled={pending}
            onClick={() => void run(() => place({ campaignId, mapId, instanceIds: info.queue.map((q) => q.instanceId), idempotencyKey: idempotencyKey() }))}
          >
            Place all
          </button>
        </div>
      ) : info.encounter === null ? (
        <p className="cm-muted cm-small cm-m0">Start an encounter on the Adversaries tab to bring its adversaries here.</p>
      ) : null}

      <details className="cm-custom">
        <summary className="cm-lbl">Add a custom token</summary>
        <form className="cm-custom-form" onSubmit={submitCustom}>
          <div className="cm-custom-grid">
            <input className="cm-in" type="text" placeholder="Name (e.g. Bandit Archer)" aria-label="Token name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            <input className="cm-in" type="text" inputMode="numeric" placeholder="HP" aria-label="Hit Points" value={hp} onChange={(e) => setHp(e.target.value)} />
          </div>
          <div className="cm-row cm-tight" role="group" aria-label="Side">
            {CUSTOM_SIDES.map((k) => (
              <button key={k} type="button" className="cm-btn cm-sm" aria-pressed={side === k} onClick={() => setSide(k)}>
                {SIDES[k].label}
              </button>
            ))}
          </div>
          <button type="submit" className="cm-btn cm-self-start" disabled={pending}>
            ＋ Add token
          </button>
        </form>
      </details>
      {notice ? (
        <p role="status" className="cm-muted cm-small cm-m0">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="cm-alert cm-m0">
          {error}
        </p>
      ) : null}
    </section>
  );
}
