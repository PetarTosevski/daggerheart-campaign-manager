"use client";

import { useEffect, useState } from "react";

import { assetBackground } from "@/lib/design-assets";
import { CUSTOM_BACKGROUNDS, CUSTOM_TONES } from "@/lib/frames";
import { cn } from "@/lib/utils";
import {
  CAMPAIGN_NAME_MAX,
  CUSTOM_TEXT_MAX,
  PARTY_SIZES,
  STARTING_TIERS,
  type CustomFrameInput,
} from "@/lib/validation/campaigns";

export type CustomDraft = CustomFrameInput & { name: string };

const EMPTY: CustomDraft = {
  name: "",
  pitch: "",
  tones: ["Adventurous", "Heroic"],
  themes: "",
  touchstones: "",
  partySize: 4,
  startingTier: 1,
  background: "custom",
};

// The unsent draft is a per-device convenience, so browser storage is enough.
const DRAFT_KEY = "dh.customDraft";

export function useCustomDraft() {
  const [draft, setDraft] = useState<CustomDraft>(EMPTY);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as Partial<CustomDraft> | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage after mount
      if (saved) setDraft({ ...EMPTY, ...saved });
    } catch {
      // No stored draft.
    }
  }, []);
  const update = (next: CustomDraft) => {
    setDraft(next);
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable; the draft lives for this visit only.
    }
  };
  return [draft, update] as const;
}

export function clearCustomDraft() {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

const FIELD = "flex flex-col gap-2 text-[14px] text-label";
const INPUT =
  "min-h-[50px] rounded-[10px] border border-line-2 bg-[#0f0d15] px-3.5 font-sans text-[16px] text-parchment placeholder:text-faint";

/** The Custom section of the FrameSelect board. */
export function CustomFrameForm({ draft, onChange }: { draft: CustomDraft; onChange: (d: CustomDraft) => void }) {
  const set = <K extends keyof CustomDraft>(key: K, value: CustomDraft[K]) => onChange({ ...draft, [key]: value });

  return (
    <section
      aria-label="Custom frame"
      className="grid grid-cols-1 gap-x-7 gap-y-[22px] rounded-2xl border border-line bg-panel p-6 sm:p-8 md:grid-cols-2"
    >
      <label className={FIELD}>
        Campaign name
        <input
          type="text"
          className={INPUT}
          value={draft.name}
          maxLength={CAMPAIGN_NAME_MAX}
          placeholder="Name your campaign"
          onChange={(e) => set("name", e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={FIELD}>
          Party size
          <select
            className={INPUT}
            value={draft.partySize}
            onChange={(e) => set("partySize", Number(e.target.value) as CustomDraft["partySize"])}
          >
            {PARTY_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD}>
          Starting tier
          <select
            className={INPUT}
            value={draft.startingTier}
            onChange={(e) => set("startingTier", Number(e.target.value) as CustomDraft["startingTier"])}
          >
            {STARTING_TIERS.map((t) => (
              <option key={t.tier} value={t.tier}>
                Tier {t.tier} · Lvl {t.level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={cn(FIELD, "md:col-span-2")}>
        The pitch
        <textarea
          rows={3}
          className={cn(INPUT, "py-3 leading-normal")}
          value={draft.pitch}
          maxLength={CUSTOM_TEXT_MAX}
          placeholder="What is this campaign about? Read this to your players."
          onChange={(e) => set("pitch", e.target.value)}
        />
      </label>
      <div className="flex flex-col gap-2.5 md:col-span-2">
        <span className="text-[14px] text-label">Tone &amp; feel</span>
        <div className="flex flex-wrap gap-2.5">
          {CUSTOM_TONES.map((tone) => {
            const on = draft.tones.includes(tone);
            return (
              <button
                key={tone}
                type="button"
                aria-pressed={on}
                onClick={() => set("tones", on ? draft.tones.filter((t) => t !== tone) : [...draft.tones, tone])}
                className={cn(
                  "min-h-11 cursor-pointer rounded-full border px-[18px] text-[15px]",
                  on ? "border-brand bg-brand text-brand-ink" : "border-line-2 bg-transparent text-parchment",
                )}
              >
                {tone}
              </button>
            );
          })}
        </div>
      </div>
      <label className={FIELD}>
        Themes
        <input
          type="text"
          className={INPUT}
          value={draft.themes}
          maxLength={CUSTOM_TEXT_MAX}
          placeholder="e.g. found family, cost of power"
          onChange={(e) => set("themes", e.target.value)}
        />
      </label>
      <label className={FIELD}>
        Touchstones
        <input
          type="text"
          className={INPUT}
          value={draft.touchstones}
          maxLength={CUSTOM_TEXT_MAX}
          placeholder="Films, books or games that set the mood"
          onChange={(e) => set("touchstones", e.target.value)}
        />
      </label>
      <div className="flex flex-col gap-2.5 md:col-span-2">
        <span className="text-[14px] text-label">Dashboard background</span>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5">
          {CUSTOM_BACKGROUNDS.map((bg) => {
            const on = draft.background === bg.id;
            return (
              <button
                key={bg.id}
                type="button"
                aria-pressed={on}
                aria-label={bg.label}
                title={bg.label}
                onClick={() => set("background", bg.id)}
                className={cn(
                  "relative h-[76px] cursor-pointer overflow-hidden rounded-[10px] border-2 bg-raised bg-cover bg-no-repeat p-0",
                  on ? "border-brand opacity-100" : "border-line opacity-70",
                )}
                style={{ backgroundImage: assetBackground(bg.art.asset), backgroundPosition: bg.art.position }}
              >
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-black/80 px-1.5 py-1 text-left text-[12px] text-parchment">
                  {bg.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="rounded-[10px] border border-dashed border-[#4a4360] px-4 py-3.5 text-[14px] leading-normal text-label md:col-span-2">
        A custom campaign starts with a blank tome. You write the Overview, Inciting Incident and Campaign
        Mechanics yourself from the campaign dashboard.
      </div>
    </section>
  );
}
