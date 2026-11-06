"use client";

import "./generate.css";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { DEFAULT_SETTING } from "@/lib/sprite-packs/settings";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { GenerateResult } from "../../../../convex/combatMapGenerate";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SettingRef } from "../../../../convex/lib/validators/combatMaps";
import { MapImageButton } from "../maps";
import type { CombatMapSummary, ScenePanelProps } from "../slots";
import { sceneChips } from "./scene-chips";
import { SettingSelect } from "./setting-select";

/** The board's size presets (convex/lib/combatMaps.ts MAP_SIZES). */
const SIZES = [
  { key: "small", label: "Small", w: 22, h: 15 },
  { key: "medium", label: "Medium", w: 30, h: 20 },
  { key: "large", label: "Large", w: 40, h: 27 },
] as const;
type SizeKey = (typeof SIZES)[number]["key"];

/** convex/lib/combatMaps.ts MAX_MAP_PROMPT. */
const MAX_PROMPT = 1000;

const PLACEHOLDER =
  "e.g. A bandit camp in an autumn forest clearing: three tents around a campfire, logs to sit on, a stream on the east side and boulders for cover.";

/** The preset matching the map's size, else Medium (an uploaded image's size rarely matches one). */
function sizeOf(map: CombatMapSummary | null): SizeKey {
  return SIZES.find((s) => map !== null && s.w === map.w && s.h === map.h)?.key ?? "medium";
}

/** The board's message line for a finished generation. */
function resultMessage(result: GenerateResult): string {
  if (!result.saved) return "The map changed while it was being drawn, so this layout was dropped. Try again.";
  if (result.drawnBy === "claude") return "Drawn by Claude from your description.";
  if (result.claude === "failed") return `Claude couldn’t draw this one (${result.reason ?? "error"}), so it was drawn from keywords instead.`;
  return "Drawn from keywords in your description. (Claude isn’t set up on this server; with an API key it draws the scene itself.)";
}

type SettingOptions = FunctionReturnType<typeof api.combatMapStyle.settings> | undefined;

/**
 * dcm-bxp.129: the built-in setting whose suggestion chips the card shows.
 * - A built-in setting: that one. A GM pack: the built-in setting it adds to (`extends`); a pack with its own setting
 *   (or a list not loaded yet) shows no setting chips, since the client cannot tell what it depicts.
 * - "Let Claude choose": the setting this map was last drawn with, if any, else the generator's own fallback
 *   (DEFAULT_SETTING, D7), so a GM sees suggestions before picking anything.
 */
function chipSetting(picked: SettingRef | null, stored: SettingRef | undefined, options: SettingOptions): string | null {
  const ref = picked ?? stored ?? null;
  if (ref === null) return DEFAULT_SETTING;
  if ("builtin" in ref) return ref.builtin;
  return options?.packs.find((p) => p._id === ref.pack)?.extends?.id ?? null;
}

/** What a click on one of the card's buttons does: fill the map on screen or make a new one, and ask for a variation or not. */
type Run = { target: "current" | "new"; another: boolean };

/**
 * GM, left column in Edit (slot `ScenePanel`): the board's Scene card. Describe the battlefield, pick a size and
 * Generate: Claude (or the keyword fallback) lays the map out on the server (`combatMapGenerate.generate`).
 * - No map, or a blank map on screen: "✦ Generate map" fills it (no map: a new one is made first, as on the board).
 * - A generated map: "✦ Regenerate map" and "↻ Another version" replace its layout (tokens stay); "＋ Generate new
 *   map" keeps it and makes another.
 * - An uploaded image: only "＋ Generate new map" (the image is never replaced from here).
 * Stop drops the late result (the server ignores a generation whose map changed after it started).
 */
export function ScenePanel({ campaignId, map, onMapCreated }: ScenePanelProps) {
  const layout = useQuery(api.combatMaps.get, map ? { campaignId, mapId: map._id } : "skip");
  const generate = useAction(api.combatMapGenerate.generate);
  const stop = useMutation(api.combatMapGenerate.stop);
  const create = useIntent(api.combatMaps.create);
  // Both are subscribed already (the campaign shell holds campaigns.get, the Setting picker holds settings).
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const settingOptions = useQuery(api.combatMapStyle.settings, { campaignId });

  const mapId = map?._id ?? null;
  // The GM's typing and size pick, per map: switching maps shows that map's own description again (the board).
  const [draft, setDraft] = useState<{ mapId: Id<"combatMaps"> | null; text: string } | null>(null);
  const [picked, setPicked] = useState<{ mapId: Id<"combatMaps"> | null; size: SizeKey } | null>(null);
  const [busy, setBusy] = useState<{ mapId: Id<"combatMaps"> | null } | null>(null);
  // Sprite packs P7: the Setting pick before the first map exists (a map stores its own with setSetting).
  const [pendingSetting, setPendingSetting] = useState<SettingRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The running generation; Stop or a newer click replaces it, so a late answer is ignored here too.
  const job = useRef(0);

  if (map && layout === undefined) {
    return (
      <section className="cm-card" aria-labelledby="cm-scene-h">
        <h2 id="cm-scene-h" className="cm-h">
          Scene
        </h2>
        <p role="status" className="cm-muted cm-m0">
          Loading …
        </p>
      </section>
    );
  }

  const prompt = draft !== null && draft.mapId === mapId ? draft.text : (layout?.prompt ?? "");
  const size = picked !== null && picked.mapId === mapId ? picked.size : sizeOf(map);
  const source = map?.source ?? null;
  // The setting the GM picked (sent to generate; absent = Let Claude choose): the map's own pick, else the pending one.
  const pickedSetting: SettingRef | null = map ? (layout?.settingPicked === true && layout.setting ? layout.setting : null) : pendingSetting;

  const chips = sceneChips(chipSetting(pickedSetting, map ? layout?.setting : undefined, settingOptions), campaign?.frameId);

  async function run({ target, another }: Run) {
    const desc = prompt.trim();
    if (!desc) {
      setMessage("Describe the scene first: where the fight happens and what is there.");
      return;
    }
    const id = ++job.current;
    setMessage(null);
    let targetId = target === "current" ? mapId : null;
    setBusy({ mapId: targetId });
    if (targetId === null) {
      const made = await create.fire({ campaignId, size });
      if (job.current !== id) return;
      if (!made) {
        setBusy(null);
        return;
      }
      targetId = made.mapId;
      // The new map keeps what the GM typed and picked while it is drawn.
      setDraft({ mapId: targetId, text: prompt });
      setPicked({ mapId: targetId, size });
      setBusy({ mapId: targetId });
      onMapCreated(targetId);
    }
    try {
      const result = await generate({
        campaignId,
        mapId: targetId,
        prompt: desc,
        size,
        ...(another ? { another: true } : {}),
        ...(pickedSetting ? { setting: pickedSetting } : {}),
      });
      if (job.current !== id) return;
      setMessage(resultMessage(result));
    } catch (e) {
      if (job.current !== id) return;
      setMessage(errorMessage(e));
    }
    setBusy(null);
  }

  function onStop() {
    job.current++;
    const stopped = busy?.mapId ?? null;
    setBusy(null);
    if (stopped !== null) {
      stop({ campaignId, mapId: stopped }).catch((e: unknown) => setMessage(errorMessage(e)));
    }
  }

  const fills = source === null || source === "blank";
  const disabled = busy !== null;

  return (
    <section className="cm-card cm-scene" aria-labelledby="cm-scene-h">
      <h2 id="cm-scene-h" className="cm-h">
        Scene
      </h2>
      <label className="cm-scene-field">
        <span className="cm-lbl">Describe the battlefield</span>
        <textarea
          className="cm-ta"
          placeholder={PLACEHOLDER}
          maxLength={MAX_PROMPT}
          value={prompt}
          onChange={(e) => setDraft({ mapId, text: e.target.value })}
        />
      </label>
      {chips.length > 0 ? (
        <div className="cm-row cm-scene-chips" role="group" aria-label="Suggested scenes">
          {chips.map((chip) => (
            <BrandButton
              key={chip.text}
              type="button"
              variant="neutral"
              size="sm"
              title={chip.text}
              onClick={() => setDraft({ mapId, text: chip.text })}
            >
              {chip.label}
            </BrandButton>
          ))}
        </div>
      ) : null}
      <SettingSelect
        campaignId={campaignId}
        mapId={mapId}
        setting={layout?.setting}
        settingPicked={layout?.settingPicked === true}
        generated={source === "generated"}
        pending={pendingSetting}
        onPending={setPendingSetting}
        disabled={disabled}
      />
      <div className="cm-row cm-scene-sizes" role="group" aria-label="Map size">
        <span className="cm-lbl" aria-hidden="true">
          Size
        </span>
        {SIZES.map((s) => (
          <BrandButton
            key={s.key}
            type="button"
            variant="neutral"
            size="sm"
            aria-pressed={size === s.key}
            title={`${s.w} × ${s.h} squares`}
            onClick={() => setPicked({ mapId, size: s.key })}
          >
            {s.label}
          </BrandButton>
        ))}
      </div>
      <div className="cm-row cm-scene-actions">
        {fills ? (
          <BrandButton type="button" variant="confirm" disabled={disabled} onClick={() => void run({ target: "current", another: false })}>
            ✦ Generate map
          </BrandButton>
        ) : source === "generated" ? (
          <>
            <BrandButton type="button" variant="confirm" disabled={disabled} onClick={() => void run({ target: "current", another: false })}>
              ✦ Regenerate map
            </BrandButton>
            <BrandButton type="button" variant="neutral" disabled={disabled} onClick={() => void run({ target: "current", another: true })}>
              ↻ Another version
            </BrandButton>
          </>
        ) : null}
        {!fills ? (
          <BrandButton type="button" variant={source === "image" ? "confirm" : "neutral"} disabled={disabled} onClick={() => void run({ target: "new", another: false })}>
            ＋ Generate new map
          </BrandButton>
        ) : null}
      </div>
      {busy ? (
        <div role="status" className="cm-muted cm-scene-busy">
          <span className="cm-spin" aria-hidden="true" />
          Drawing the battlefield…
          <BrandButton type="button" variant="cancel" size="sm" onClick={onStop}>
            Stop
          </BrandButton>
        </div>
      ) : null}
      {message ? (
        <div role="status" className="cm-muted cm-scene-msg">
          {message}
        </div>
      ) : null}
      {create.error ? (
        <p role="alert" className="cm-scene-err cm-m0">
          {create.error}
        </p>
      ) : null}
      <MapImageButton
        campaignId={campaignId}
        {...(map && source === "blank" ? { mapId: map._id } : {})}
        size={size}
        label="🖼 Use my own map image"
        onDone={(id) => {
          setMessage("Using your image. Line the grid up in Edit, then paint what blocks sight.");
          if (id !== mapId) onMapCreated(id);
        }}
      />
    </section>
  );
}
