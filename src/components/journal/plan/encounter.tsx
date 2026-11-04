"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import type { InstanceView } from "@/components/adversaries/builder/types";
import { brandButton } from "@/components/brand/buttons";
import { encounterTrackerHref } from "@/components/sessions/session-chip";
import { errorMessage } from "@/lib/convex-errors";
import { BP_COSTS, minionGroups } from "@/lib/domain/encounters/budget";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SceneEncounterProps } from "../slots";

/** One adversary chip: a stat block's instances together ('Bandit ×2', 'Lackey ×4' for a Minion group). */
export type EncounterChip = { key: string; name: string; count: number; type: string | null; bp: number };

/**
 * The encounter's instances (`encounters.get`) as the board's chips: instances of one stat block (same name, type and
 * summoned flag) share a chip with their count (a Minion group counts its size) and their Battle Points (CB p.197:
 * the type's cost each; Minions per group the size of the party; summoned or unknown = 0). In first-added order.
 */
export function encounterChips(instances: readonly InstanceView[], pcs: number): EncounterChip[] {
  const groups = new Map<string, { name: string; type: InstanceView["type"]; items: InstanceView[] }>();
  for (const i of instances) {
    const name = i.name ?? i.label;
    const key = `${name}|${i.type ?? ""}|${i.summoned ? "s" : ""}`;
    const group = groups.get(key) ?? { name, type: i.type, items: [] };
    group.items.push(i);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, { name, type, items }]) => {
    const count = items.reduce((n, i) => n + (i.minionCount ?? 1), 0);
    const counted = items.filter((i) => !i.summoned);
    let bp = 0;
    if (type === "Minion") bp = minionGroups(counted, pcs);
    else if (type !== null) bp = BP_COSTS[type] * counted.length;
    return { key, name, count, type, bp };
  });
}

type Ids = { campaignId: Id<"campaigns">; sessionId: Id<"sessions">; sceneId: string };

const LINK = brandButton({ variant: "pill", size: "md", className: "px-3.5 text-sm" });

/**
 * A Combat scene's encounter card (JP2, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg,
 * Plan, scene 3): 'Encounter · <name>', a chip per stat block with its type and Battle Points, 'On the Combat Map'
 * when any of it has a token on the live map, 'Open map' and 'Edit in Adversaries'. Without one: create a draft for
 * the scene or link one of the campaign's encounters (sessionPrep, JD4). Adversaries are added in the Adversaries
 * tab's builder (Q6: reuse, no add dialog here). GM only (players never see the plan, Q5).
 */
export function SceneEncounter({ campaignId, isGm, sessionId, sceneId }: SceneEncounterProps) {
  const prep = useQuery(api.sessionPrep.get, isGm ? { campaignId, sessionId } : "skip");
  if (!isGm) return null;
  if (prep === undefined) {
    return (
      <p role="status" className="jr-muted jr-m0">
        Loading the encounter…
      </p>
    );
  }
  const scene = prep.scenes.find((s) => s.id === sceneId);
  if (scene === undefined || scene.type !== "combat") return null;
  const ids = { campaignId, sessionId, sceneId };
  const encounter = scene.encounter ?? null;
  if (encounter === null) return <NoEncounter {...ids} />;
  return <LinkedEncounter {...ids} encounterId={encounter._id} name={encounter.name} onMap={encounter.onMap} />;
}

const FRAME = "flex flex-col gap-3 rounded-xl border border-(--jr-card-border) bg-(--jr-field) p-3.5";

function LinkedEncounter({ campaignId, sessionId, sceneId, encounterId, name, onMap }: Ids & { encounterId: Id<"encounters">; name: string; onMap: boolean }) {
  const view = useQuery(api.encounters.get, { campaignId, encounterId });
  const headingId = useId();
  const [error, setError] = useState<string | null>(null);
  const unlink = useMutation(api.sessionPrep.unlinkSceneEncounter).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.sessionPrep.get, { campaignId: args.campaignId, sessionId: args.sessionId });
    if (!current) return;
    const scenes = current.scenes.map((s) => (s.id === args.sceneId ? { ...s, encounterId: undefined, encounter: null } : s));
    store.setQuery(api.sessionPrep.get, { campaignId: args.campaignId, sessionId: args.sessionId }, { ...current, scenes });
  });
  const chips = view ? encounterChips(view.instances, view.encounter.pcs) : [];

  return (
    <section className={FRAME} aria-labelledby={headingId} data-testid="scene-encounter">
      <h3 id={headingId} className="m-0 text-sm font-semibold text-(--jr-combat)">
        Encounter · {view?.encounter.name ?? name}
      </h3>
      {view === undefined ? (
        <p role="status" className="jr-muted jr-m0">
          Loading the adversaries…
        </p>
      ) : view === null ? (
        <p className="jr-muted jr-m0">This encounter no longer exists.</p>
      ) : chips.length === 0 ? (
        <p className="jr-muted jr-m0">No adversaries yet. Add them in the Adversaries tab; the Battle Points show how hard the fight is.</p>
      ) : (
        <ul aria-label="Adversaries in this encounter" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {chips.map((c) => (
            <li key={c.key} className="inline-flex items-baseline gap-1.5 rounded-lg bg-(--jr-combat-bg) px-2.5 py-1.5 text-sm text-(--jr-combat)">
              <span>
                {c.name}
                {c.count > 1 ? ` ×${c.count}` : ""}
              </span>
              <span className="text-xs opacity-75">
                {c.type ?? "Unknown"} · {c.bp}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {onMap ? (
          <span className="mr-auto inline-flex items-center gap-1.5 text-sm text-(--jr-live-text)" data-testid="scene-encounter-on-map">
            <Check aria-hidden="true" className="size-4" />
            On the Combat Map
          </span>
        ) : (
          <span className="mr-auto" />
        )}
        <Link className={LINK} href={`/campaigns/${campaignId}/combat-map`}>
          <MapIcon aria-hidden="true" />
          Open map
        </Link>
        <Link className={LINK} href={encounterTrackerHref(campaignId, encounterId)}>
          Edit in Adversaries
        </Link>
        <button
          type="button"
          className="jr-ghost"
          aria-label={`Unlink ${view?.encounter.name ?? name} from this scene`}
          onClick={() => {
            setError(null);
            unlink({ campaignId, sessionId, sceneId }).catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          Unlink
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-sm text-(--jr-danger)">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const STATUS_LABEL = { draft: "Draft", running: "Running", ended: "Ended" } as const;

function NoEncounter({ campaignId, sessionId, sceneId }: Ids) {
  const list = useQuery(api.encounters.list, { campaignId });
  const create = useIntent(api.sessionPrep.createSceneEncounter);
  const link = useMutation(api.sessionPrep.linkSceneEncounter);
  const selectId = useId();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const options = list ? [...list.active, ...list.ended] : [];
  const picked = options.some((e) => e._id === choice) ? choice : (options[0]?._id ?? "");

  async function onLink() {
    if (picked === "") return;
    setError(null);
    setLinking(true);
    try {
      await link({ campaignId, sessionId, sceneId, encounterId: picked });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLinking(false);
    }
  }

  return (
    <section className={FRAME} aria-label="Encounter" data-testid="scene-encounter">
      <p className="jr-muted jr-m0 text-sm">No encounter yet. Build this fight with real stat blocks and Battle Points; it also appears in the Adversaries tab.</p>
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className={brandButton({ variant: "solid", size: "md" })} disabled={create.pending} onClick={() => void create.fire({ campaignId, sessionId, sceneId })}>
          Create encounter
        </button>
        <label htmlFor={selectId} className="sr-only">
          Link an encounter
        </label>
        <select
          id={selectId}
          className="min-h-11 max-w-full flex-1 rounded-[10px] border border-(--jr-border) bg-(--jr-page) px-3 text-sm text-(--jr-text)"
          value={picked}
          disabled={options.length === 0}
          onChange={(e) => setChoice(e.currentTarget.value)}
        >
          {list === undefined ? <option value="">Loading encounters…</option> : null}
          {list !== undefined && options.length === 0 ? <option value="">No encounters yet</option> : null}
          {options.map((e) => (
            <option key={e._id} value={e._id}>
              {e.name} ({STATUS_LABEL[e.status]})
            </option>
          ))}
        </select>
        <button type="button" className={brandButton({ variant: "outline", size: "md" })} disabled={picked === "" || linking} onClick={() => void onLink()}>
          Link
        </button>
      </div>
      {(create.error ?? error) ? (
        <p role="alert" className="m-0 text-sm text-(--jr-danger)">
          {create.error ?? error}
        </p>
      ) : null}
    </section>
  );
}
