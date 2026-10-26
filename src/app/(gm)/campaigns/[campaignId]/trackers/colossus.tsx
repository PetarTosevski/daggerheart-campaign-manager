"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { COLOSSI_TOTAL, EMERGENCE_POWER, MAX_POWER, SIPHON_SLOTS } from "@/lib/frames/trackers/colossus";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import type { ColossusView } from "../../../../../../convex/trackers/colossus";
import { TRACKER_BTN, TrackerCard } from "./tracker-card";

type Props = { campaign: CampaignSummary };

/** Colossus of the Drylands (Core pp.318, 327): the hunt, the Siphoning Track and Kudamat's Power. */
export function ColossusTracker({ campaign }: Props) {
  const view = useQuery(api.trackers.colossus.get, { campaignId: campaign._id });
  if (view === undefined) return null;
  return (
    <div className="flex flex-col gap-4">
      <HuntCard campaign={campaign} view={view} />
      {view.gm ? <KudamatCard campaign={campaign} gm={view.gm} phase={view.phase} /> : null}
    </div>
  );
}

function HuntCard({ campaign, view }: Props & { view: ColossusView }) {
  const readOnly = campaign.role !== "gm";
  const setPhase = useIntent(api.trackers.colossus.setPhase);
  const defeat = useIntent(api.trackers.colossus.defeatColossus);
  const correct = useIntent(api.trackers.colossus.correct);
  const [notice, setNotice] = useState<string | null>(null);
  const allSlain = view.colossiDefeated >= COLOSSI_TOTAL;
  const error = setPhase.error ?? defeat.error ?? correct.error;

  return (
    <TrackerCard
      title="The Hunt"
      subtitle={view.phase === "hunt" ? "Hunt phase: a colossus stalks the Drylands." : "Interlude: time for smaller, personal tasks."}
    >
      <div role="radiogroup" aria-label="Campaign phase" className="flex gap-2">
        {(["hunt", "interlude"] as const).map((phase) => (
          <button
            key={phase}
            type="button"
            role="radio"
            aria-checked={view.phase === phase}
            disabled={readOnly || setPhase.pending}
            onClick={() => view.phase !== phase && void setPhase.fire({ campaignId: campaign._id, phase })}
            className={cn(TRACKER_BTN, "flex-1 capitalize", view.phase === phase && "border-brand bg-brand/15 text-parchment")}
          >
            {phase}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">
          Colossi slain <span data-testid="colossi-defeated" className="text-parchment">{view.colossiDefeated}</span> / {COLOSSI_TOTAL}
        </span>
        <div role="group" aria-label="Colossi slain" className="flex gap-1.5">
          {Array.from({ length: COLOSSI_TOTAL }, (_, k) => {
            const slain = k < view.colossiDefeated;
            return (
              <button
                key={k}
                type="button"
                aria-label={`Correct colossi slain to ${k + 1 === view.colossiDefeated ? k : k + 1}`}
                disabled={readOnly || correct.pending}
                onClick={() =>
                  void correct.fire({ campaignId: campaign._id, colossiDefeated: k + 1 === view.colossiDefeated ? k : k + 1 })
                }
                className={cn(
                  "size-7 rotate-45 rounded-[4px] border disabled:cursor-default",
                  slain ? "border-[#d9a64a] bg-[#7a5218]" : "border-[#33444a] bg-[#10181b]",
                  !readOnly && "cursor-pointer",
                )}
              />
            );
          })}
        </div>
      </div>

      {readOnly ? null : (
        <button
          type="button"
          className={TRACKER_BTN}
          disabled={allSlain || defeat.pending}
          onClick={async () => {
            const result = await defeat.fire({ campaignId: campaign._id });
            if (result) setNotice(`${result.notice} Kudamat drew ${result.roll.gained} (rolled ${result.roll.dice.join(", ")}).`);
          }}
        >
          Colossus defeated
        </button>
      )}
      {notice ? (
        <p role="status" className="m-0 rounded-lg border border-[#5b4a2a] bg-[#2a2010] px-3 py-2 text-[14px] text-[#f4e3bd]">
          {notice}
        </p>
      ) : null}
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </TrackerCard>
  );
}

function KudamatCard({
  campaign,
  gm,
  phase,
}: Props & { gm: NonNullable<ColossusView["gm"]>; phase: ColossusView["phase"] }) {
  const markRest = useIntent(api.trackers.colossus.markRest);
  const correct = useIntent(api.trackers.colossus.correct);
  const [power, setPower] = useState("");
  const error = markRest.error ?? correct.error;
  const powerValue = Number(power);
  const powerValid = power.trim() !== "" && Number.isInteger(powerValue) && powerValue >= 0 && powerValue <= MAX_POWER;

  return (
    <TrackerCard title="Kudamat" subtitle="The power siphoned from the soul shards." gmOnly>
      {gm.emerged ? (
        <div role="status" className="rounded-lg border border-danger-line bg-[#3a1414] px-3 py-2 text-center font-display text-[14px] tracking-[0.1em] text-[#ffd9d6]">
          KUDAMAT EMERGES FROM GODFELL MOUNTAIN
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">
          Siphoning Track <span data-testid="siphon-marked">{gm.siphonMarked}</span> / {SIPHON_SLOTS}
        </span>
        <div role="group" aria-label="Siphoning Track" className="grid grid-cols-10 gap-1.5">
          {Array.from({ length: SIPHON_SLOTS }, (_, k) => {
            const marked = k < gm.siphonMarked;
            const target = Math.max(1, k + 1 === gm.siphonMarked ? k : k + 1);
            return (
              <button
                key={k}
                type="button"
                aria-label={`Slot ${k + 1}${marked ? ", marked" : ""}`}
                aria-pressed={marked}
                disabled={correct.pending || target === gm.siphonMarked}
                onClick={() => void correct.fire({ campaignId: campaign._id, siphonMarked: target })}
                className={cn(
                  "aspect-square cursor-pointer rounded-[5px] border disabled:cursor-default",
                  marked ? "border-[#8f78d8] bg-[#4b3a7a]" : "border-[#33444a] bg-[#10181b]",
                )}
              />
            );
          })}
        </div>
        <p className="m-0 text-[13px] text-[#9fb2b6]" data-testid="siphon-rest-note">
          Party rests mark the track automatically when the GM finishes them. Use these only to correct a rest taken outside the app.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["short", "long"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={TRACKER_BTN}
              disabled={phase !== "hunt" || markRest.pending}
              onClick={() => void markRest.fire({ campaignId: campaign._id, kind })}
            >
              {kind === "short" ? "Correction: short rest +1" : "Correction: long rest +2"}
            </button>
          ))}
          {phase !== "hunt" ? <span className="self-center text-[13px] text-[#9fb2b6]">Rests mark the track only during a hunt.</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Kudamat&rsquo;s Power</span>
            <span data-testid="kudamat-power" className="font-display text-[44px] leading-none font-black text-[#f4efe6]">
              {gm.kudamatPower}
            </span>
          </div>
          <dl className="m-0 flex gap-4 text-right text-[13px] text-[#9fb2b6]">
            <div>
              <dt>Major</dt>
              <dd data-testid="kudamat-major" className="m-0 font-display text-[20px] text-parchment">
                {gm.thresholds.major}
              </dd>
            </div>
            <div>
              <dt>Severe</dt>
              <dd data-testid="kudamat-severe" className="m-0 font-display text-[20px] text-parchment">
                {gm.thresholds.severe}
              </dd>
            </div>
          </dl>
        </div>
        <div
          role="meter"
          aria-label="Kudamat's Power toward emergence"
          aria-valuemin={0}
          aria-valuemax={EMERGENCE_POWER}
          aria-valuenow={Math.min(gm.kudamatPower, EMERGENCE_POWER)}
          className="h-2.5 overflow-hidden rounded-full bg-[#10181b]"
        >
          <div
            className={cn("h-full rounded-full", gm.emerged ? "bg-[#e0605a]" : "bg-[#8f78d8]")}
            style={{ width: `${Math.min(100, (gm.kudamatPower / EMERGENCE_POWER) * 100)}%` }}
          />
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!powerValid) return;
            if (await correct.fire({ campaignId: campaign._id, kudamatPower: powerValue }) !== undefined) setPower("");
          }}
        >
          <label className="text-[13px] text-[#9fb2b6]" htmlFor="kudamat-power-input">
            Correct Power
          </label>
          <input
            id="kudamat-power-input"
            inputMode="numeric"
            value={power}
            onChange={(e) => setPower(e.target.value)}
            className="min-h-10 w-24 rounded-[9px] border border-[#33444a] bg-[#10181b] px-2 text-[14px] text-parchment"
          />
          <button type="submit" className={TRACKER_BTN} disabled={!powerValid || correct.pending}>
            Set
          </button>
        </form>
      </div>

      {gm.log.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Last siphon rolls</span>
          <ol aria-label="Last siphon rolls" className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-[#c9d2cf]">
            {gm.log.map((entry) => (
              <li key={entry.at + entry.dice.join("")}>
                {entry.reason === "defeat" ? "Colossus slain" : "Track full"}: rolled {entry.dice.join(", ")} → +{entry.gained} (Power{" "}
                {entry.powerAfter})
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <p aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </TrackerCard>
  );
}
