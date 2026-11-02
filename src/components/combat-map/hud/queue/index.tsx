"use client";

import "./queue.css";

import { useQueries, useQuery } from "convex/react";
import { useId, useMemo, type ReactNode } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { GmDeathConfirm } from "../death/confirm";
import type { HudPartProps } from "../state";
import { PartBoundary } from "../ui";
import { QueueCard, useQueueAnswers } from "./items";
import { queueItems } from "./model";
import { HudResolutions } from "./resolutions";

/**
 * The GM's request queue (plan combat-hud H5.1; boards GMDesktop 'Requests', CmpPromptsGM): "Waiting on you" with a
 * count and one CmpPromptsGM card per thing that waits on the GM, oldest first, then Resolutions with Undo. A client
 * merge of the reads the classic column uses (no server change):
 *
 * - out of range, your call: `combatRequests.mine` (attack sanctions), `combatCards.pending`, `combatFeatures.pending`
 *   — Allow / Decline (`combatRequests.sanction`, `combatCards.sanction`, `combatFeatures.sanction`);
 * - Set the Difficulty: `combatRequests.difficulties` — Set and roll / Decline (`featurePrompts.answerDifficulty`);
 * - Reactions: `adversaryActions.windows` — Resolve now (`adversaryActions.resolve`);
 * - Does <name>'s Cloaked end?: `cloakPrompts.pending` — Yes, it ends / No, it stays (`cloakPrompts.answer`);
 * - Was this hit fire?: `hitKeywords.asks` — Yes / No (`hitKeywords.answer`);
 * - ally rolls: `featurePrompts.allyRolls` (the GM's `pending`) — Cancel the roll (`featurePrompts.cancelAllyRoll`);
 * - the death move confirm: `deathMoves.state` per PC — H4.3's `GmDeathConfirm` (Confirm the death move / Send it back).
 *
 * Every answer is the existing keyed mutation with an optimistic update that drops the card at once. A request someone
 * else answered first (REQUEST_NOT_OPEN, DEATH_MOVE_NOT_WAITING) toasts "Already answered" (H6.3: the refusal table's
 * STALE_REQUEST row, in the HUD's toast host) and drops out as the reads refresh; one the player
 * withdraws (HD3) leaves the reads, so its card disappears live. No Momentum prompt (answer 7a: automatic; its line
 * and Undo are in Resolutions) and no Hope split (answer 14a). "End this countdown?" waits on dcm-pgfr's server.
 * The GM's classic lists stay in the Map tools drawer.
 */
export function HudQueue({ state }: HudPartProps): ReactNode {
  if (state.role !== "gm") return null;
  return <GmQueue campaignId={state.campaignId} />;
}

function GmQueue({ campaignId }: { campaignId: Id<"campaigns"> }) {
  return (
    <div className="hud-q-col" data-testid="hud-queue-column">
      <PartBoundary label="The request queue">
        <Requests campaignId={campaignId} />
      </PartBoundary>
      <PartBoundary label="Resolutions">
        <HudResolutions campaignId={campaignId} />
      </PartBoundary>
    </div>
  );
}

function Requests({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const titleId = useId();
  const mine = useQuery(api.combatRequests.mine, { campaignId });
  const cards = useQuery(api.combatCards.pending, { campaignId });
  const features = useQuery(api.combatFeatures.pending, { campaignId });
  const difficulties = useQuery(api.combatRequests.difficulties, { campaignId });
  const windows = useQuery(api.adversaryActions.windows, { campaignId });
  const cloaks = useQuery(api.cloakPrompts.pending, { campaignId });
  const keywords = useQuery(api.hitKeywords.asks, { campaignId });
  const characters = useQuery(api.characters.listByCampaign, { campaignId });
  const live = useMemo(() => (characters ?? []).filter((c) => !c.corrupt), [characters]);
  // `allyRolls` reads for a character the caller edits; the GM's `pending` lists every open throw of the campaign.
  const anyPc = live[0]?._id;
  const ally = useQuery(api.featurePrompts.allyRolls, anyPc === undefined ? "skip" : { campaignId, characterId: anyPc });
  // useQueries needs a stable request object (a new one each render loops): keyed on the PCs' ids.
  const ids = live.map((c) => c._id).join(",");
  const deathRequests = useMemo(
    () => Object.fromEntries((ids ? (ids.split(",") as Id<"characters">[]) : []).map((characterId) => [characterId, { query: api.deathMoves.state, args: { characterId } }])),
    [ids],
  );
  const deaths = useQueries(deathRequests);
  const answers = useQueueAnswers(campaignId);

  const items = queueItems({
    attacks: mine?.flatMap((r) => (r.kind === "sanction" ? [r] : [])),
    cards,
    features,
    difficulties,
    windows,
    cloaks,
    keywords,
    allyRolls: ally?.pending,
  });
  const deathCount = live.filter((c) => {
    const s: unknown = deaths[c._id];
    return typeof s === "object" && s !== null && !(s instanceof Error) && (s as { request: unknown }).request !== null;
  }).length;
  const count = items.length + deathCount;
  const loading = mine === undefined || cards === undefined || features === undefined || difficulties === undefined || windows === undefined || cloaks === undefined || keywords === undefined;

  return (
    <section className="hud-q" aria-labelledby={titleId} data-testid="hud-queue">
      <h2 id={titleId} className="hud-q-h">
        Waiting on you{" "}
        <span className="hud-q-n" data-testid="hud-queue-count" aria-label={`${count} waiting`}>
          {count}
        </span>
      </h2>
      <div className="hud-q-scroll">
        {/* The death confirms stay mounted per PC: after Confirm the outcome stays until Done (H4.3). */}
        {live.map((c) => (
          <PartBoundary key={`death-${c._id}`} label={`${c.sheet.name}'s death move`}>
            <GmDeathConfirm character={c} />
          </PartBoundary>
        ))}
        {items.length > 0 ? (
          <ul className="hud-q-list" aria-label="Requests waiting on you">
            {items.map((item) => (
              <li key={item.key} data-kind={item.kind}>
                <QueueCard item={item} answers={answers} />
              </li>
            ))}
          </ul>
        ) : null}
        {loading ? (
          <p role="status" className="hud-q-note">
            Loading the requests…
          </p>
        ) : count === 0 ? (
          <p className="hud-q-note">Nothing is waiting on you.</p>
        ) : null}
      </div>
      <p role="status" className="hud-q-result" data-testid="hud-queue-result">
        {answers.result}
      </p>
    </section>
  );
}
