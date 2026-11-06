"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useState } from "react";

import { BREATH_MIN, BREATH_START } from "@/lib/domain/combat-map/light";
import { MAX_COUNTDOWN_START } from "@/lib/domain/countdowns/index";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PartBoundary, hudButtonClass } from "../ui";
import { ScenePop } from "./pop";

/**
 * The scene's environment in the HUD title (plan rule-switches OE): M3's dim-light badge naming the active mode (Book:
 * "ranged attacks at disadvantage"; a variant: what the app adds by itself), and, with the Underwater optional rule on
 * (CB p.168), an "Underwater · Breath 2 of 3" chip. The GM's Water button opens a pop-over: mark the live map
 * Underwater (with the breath countdown's start, 3 or more), restart the countdown, mark the creatures that fight
 * easily underwater ("like a Siren or Shark") and the PCs who breathe underwater (plan OE2: no breath tick, no Stress).
 * Reads `combatScenes.environment`.
 */

export type HudEnvironment = FunctionReturnType<typeof api.combatScenes.environment>;

const ENV_POP = "hud-pop-env";

/** The breath chip's text: "Underwater · Breath 2 of 3", "Underwater · Out of breath" at 0. */
export function breathChip(env: Pick<HudEnvironment, "underwater" | "breath">): string | null {
  if (!env.underwater) return null;
  if (env.breath === null) return "Underwater";
  if (env.breath.current <= 0) return "Underwater · Out of breath: each action marks a Stress";
  return `Underwater · Breath ${env.breath.current} of ${env.breath.start}`;
}

/** The chips under the scene's name (GM and players). Nothing while loading or with nothing to say. */
export function EnvironmentChips({ env }: { env: HudEnvironment | undefined }) {
  if (env === undefined) return null;
  const water = breathChip(env);
  if (env.darkness === null && water === null) return null;
  return (
    <span className="hud-env" data-testid="hud-environment" role="status" aria-live="polite">
      {env.darkness !== null ? <span className="hud-live hud-env-chip">{env.darkness}</span> : null}
      {water !== null ? <span className="hud-live hud-env-chip hud-env-water">{water}</span> : null}
    </span>
  );
}

/** The title's environment line in its own error boundary (rule 11): the chips and, for the GM, the Water button. */
export function HudEnvironmentLine({ campaignId }: { campaignId: Id<"campaigns"> }) {
  return (
    <PartBoundary label="Environment">
      <EnvironmentLine campaignId={campaignId} />
    </PartBoundary>
  );
}

function EnvironmentLine({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const env = useQuery(api.combatScenes.environment, { campaignId });
  return (
    <>
      <EnvironmentChips env={env} />
      <GmUnderwater campaignId={campaignId} env={env} />
    </>
  );
}

/** The GM's "Water" button and its pop-over, shown only while the Underwater rule is on and a map is live. */
export function GmUnderwater({ campaignId, env }: { campaignId: Id<"campaigns">; env: HudEnvironment | undefined }) {
  const [open, setOpen] = useState(false);
  if (env === undefined || !env.canEdit || !env.underwaterRule || env.mapId === null) return null;
  return (
    <>
      <button type="button" className={cn(hudButtonClass("tool"), "hud-glass-btn")} aria-expanded={open} aria-controls={ENV_POP} onClick={() => setOpen(!open)}>
        Water
      </button>
      {open ? (
        <ScenePop id={ENV_POP} title="Underwater" onClose={() => setOpen(false)} className="hud-pop-env">
          <PartBoundary label="Underwater">
            <UnderwaterPanel campaignId={campaignId} env={env} mapId={env.mapId} />
          </PartBoundary>
        </ScenePop>
      ) : null}
    </>
  );
}

function UnderwaterPanel({ campaignId, env, mapId }: { campaignId: Id<"campaigns">; env: HudEnvironment; mapId: Id<"combatMaps"> }) {
  const setUnderwater = useIntent(api.combatScenes.setUnderwater);
  const setFights = useIntent(api.combatScenes.setFightsUnderwater);
  // Plan OE2 (user 2026-11-06): a PC who breathes underwater skips the breath countdown and its Stress.
  const setBreathes = useIntent(api.combatScenes.setBreathesUnderwater);
  const pcs = env.creatures.filter((c) => c.pc);
  const startId = useId();
  const [start, setStart] = useState<number>(env.breath?.start ?? BREATH_START);
  const valid = Number.isInteger(start) && start >= BREATH_MIN && start <= MAX_COUNTDOWN_START;
  const error = setUnderwater.error ?? setFights.error ?? setBreathes.error;
  return (
    <div className="hud-env-pop">
      <p className="hud-env-p">Attack rolls underwater have disadvantage; each PC action ticks the breath countdown (once more on a failure or with Fear). At 0, each action marks a Stress (CB p.168).</p>
      <label className="hud-env-row" htmlFor={startId}>
        Breath starts at
        <input
          id={startId}
          type="number"
          inputMode="numeric"
          min={BREATH_MIN}
          max={MAX_COUNTDOWN_START}
          value={Number.isNaN(start) ? "" : start}
          onChange={(e) => setStart(e.target.valueAsNumber)}
        />
      </label>
      <div className="hud-env-row">
        {env.underwater ? (
          <>
            <button type="button" className={hudButtonClass("tool")} disabled={!valid || setUnderwater.pending} onClick={() => void setUnderwater.fire({ campaignId, mapId, underwater: true, breath: start })}>
              Restart breath
            </button>
            <button type="button" className={hudButtonClass("tool")} disabled={setUnderwater.pending} onClick={() => void setUnderwater.fire({ campaignId, mapId, underwater: false })}>
              Leave the water
            </button>
          </>
        ) : (
          <button type="button" className={hudButtonClass("tool")} disabled={!valid || setUnderwater.pending} onClick={() => void setUnderwater.fire({ campaignId, mapId, underwater: true, breath: start })}>
            Mark this scene Underwater
          </button>
        )}
      </div>
      {env.creatures.length > 0 ? (
        <fieldset className="hud-env-list">
          <legend>Fights easily underwater (no disadvantage)</legend>
          {env.creatures.map((c) => (
            <label key={c.tokenId} className="hud-env-row">
              <input type="checkbox" checked={c.fightsUnderwater} disabled={setFights.pending} onChange={(e) => void setFights.fire({ campaignId, tokenId: c.tokenId, fightsUnderwater: e.target.checked })} />
              {c.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      {pcs.length > 0 ? (
        <fieldset className="hud-env-list">
          <legend>Breathes underwater (no breath countdown, no Stress)</legend>
          {pcs.map((c) => (
            <label key={c.tokenId} className="hud-env-row">
              <input type="checkbox" checked={c.breathesUnderwater} disabled={setBreathes.pending} onChange={(e) => void setBreathes.fire({ campaignId, tokenId: c.tokenId, breathesUnderwater: e.target.checked })} />
              {c.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <span role="alert" className="hud-scene-err">
          {error}
        </span>
      ) : null}
    </div>
  );
}
