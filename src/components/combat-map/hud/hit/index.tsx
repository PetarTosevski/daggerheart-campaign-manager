"use client";

import "./hit.css";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { HitBoundary } from "../../actions/reactions";
import { afterAnswer, featureChoice, hitLine, playableCards, type HitChoice, type HitView } from "../../actions/reactions/model";
import type { HudPartProps } from "../state";
import { Popup, Stepper, WaitingDots, hudButtonClass } from "../ui";
import {
  armorAsk,
  baseStep,
  keepCount,
  markLabel,
  offersArmor,
  previewRows,
  slotCounts,
  splitViews,
  stepCount,
  takeLabel,
  thresholdTiles,
  windowMode,
  windowSub,
  windowTitle,
  type HitWindowMode,
} from "./model";
import { PayElse, Preview, Reactions, Tiles } from "./parts";
import { useHitSpot } from "./spot";

/**
 * The incoming-hit window on the HUD (plan combat-hud H4.2; Main 'You're hit', CmpPromptsPlayer 'Pay something else?',
 * CmpCards 'Reaction · shows in the hit window'), in the pop region beside the hit PC's token. For every character the
 * viewer owns (a player's own; the GM's own PCs on the GM view, as the classic `GmOwnHits`), the oldest open hit from
 * `adversaryActions.pending`: the damage, the threshold tiles with the active one, the armor offer, HP / Armor before →
 * after ("n of 6 marked", pips show what is left: answer 2), Take n HP / Mark Armor, the reaction cards and features
 * that answer, and "Pay something else?" with the engine's own grants. No Armor Slot left (or direct damage) hides the
 * armor option. An ally's reaction, a before-roll defence and the after-hit offer (Unbreakable) use the same window.
 * Every answer is one `adversaryActions.respond` with the classic optimistic `pending` (CL4); nothing here looks at
 * the spotlight: reactions stay usable while the GM holds it (answer 1c; the server lets a reaction through).
 */
export function HudHit({ state }: HudPartProps): ReactNode {
  if (state.map === null) return null;
  return <OwnHits campaignId={state.campaignId} mapId={state.map._id} gm={state.role === "gm"} />;
}

function OwnHits({ campaignId, mapId, gm }: { campaignId: Id<"campaigns">; mapId: string; gm: boolean }) {
  const characters = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const party = useQuery(api.combatHud.party, { campaignId, mapId });
  if (characters === undefined) return null;
  const mine = characters.filter((c) => c.mine && !c.corrupt);
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((c) => (
        <HitBoundary key={c._id}>
          <CharacterHits
            campaignId={campaignId}
            characterId={c._id}
            characterName={c.sheet.name}
            tokenId={party?.find((m) => m.characterId === c._id)?.tokenId ?? null}
            gm={gm}
          />
        </HitBoundary>
      ))}
    </>
  );
}

/** `respond` with one idempotency key per tap and the optimistic `pending` (rule 12), as the classic prompt. */
function useRespond(campaignId: Id<"campaigns">, characterId: Id<"characters">) {
  const run = useMutation(api.adversaryActions.respond).withOptimisticUpdate((store, args) => {
    const query = { campaignId, characterId: args.characterId };
    const views = store.getQuery(api.adversaryActions.pending, query);
    if (views === undefined) return;
    store.setQuery(api.adversaryActions.pending, query, afterAnswer(views, args.requestId, args.choice));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ requestId: string; message: string } | null>(null);
  async function answer(view: HitView, choice: HitChoice) {
    setError(null);
    setBusy(true);
    try {
      const res = await run({ campaignId, requestId: view.requestId, characterId, choice, idempotencyKey: crypto.randomUUID() });
      if (res.status === "declined") setError({ requestId: view.requestId, message: "This hit was called off." });
    } catch (e) {
      setError({ requestId: view.requestId, message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return { answer, busy, error };
}

const HIT_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13.5 1.5l-1 3.5-6 6-2-2 6-6zM3.2 9.3l3.5 3.5M2 14l2.4-2.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
  </svg>
);

type CharacterHitsProps = {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  characterName: string;
  tokenId: Id<"combatTokens"> | null;
  gm: boolean;
};

function CharacterHits(props: CharacterHitsProps) {
  const { campaignId, characterId } = props;
  const views = useQuery(api.adversaryActions.pending, { campaignId, characterId });
  const respond = useRespond(campaignId, characterId);
  if (views === undefined || views.length === 0) return null;
  const { first, more, waiting } = splitViews(views);
  if (first === null) {
    const view = waiting[0]!;
    return (
      <Anchored tokenId={props.tokenId} testId="hud-hit-waiting">
        <Popup icon={HIT_ICON} tone="wait" title={hitLine(view)} sub="Waiting for the others">
          <p role="status" className="hud-hit-wait">
            <WaitingDots /> Waiting for the others to answer
          </p>
        </Popup>
      </Anchored>
    );
  }
  return (
    <Anchored tokenId={props.tokenId} testId="hud-hit">
      <HitWindow
        // A new hit is a new window (fresh armor count and picks); keyed on the request id, never on live content.
        key={first.requestId}
        {...props}
        view={first}
        more={more}
        busy={respond.busy}
        error={respond.error?.requestId === first.requestId ? respond.error.message : null}
        onAnswer={(choice) => void respond.answer(first, choice)}
      />
    </Anchored>
  );
}

/** Stands its child beside the token (spot.ts); a bottom sheet at phone width (hit.css). */
function Anchored({ tokenId, testId, children }: { tokenId: Id<"combatTokens"> | null; testId: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  const spot = useHitSpot(tokenId, box);
  const style = spot ? ({ "--hud-hit-x": `${spot.x}px`, "--hud-hit-y": `${spot.y}px` } as CSSProperties) : undefined;
  return (
    <div ref={box} className="hud-hit-spot" style={style} data-placed={spot !== null} data-testid={testId}>
      {children}
    </div>
  );
}

type HitWindowProps = CharacterHitsProps & {
  view: HitView;
  more: number;
  busy: boolean;
  error: string | null;
  onAnswer: (choice: HitChoice) => void;
};

function HitWindow({ characterId, characterName, gm, view, more, busy, error, onAnswer }: HitWindowProps) {
  const mode = windowMode(view);
  const target = view.role === "target" && mode !== "preRoll";
  const counts = slotCounts(view, mode);
  const [picked, setPicked] = useState<number | null>(null);
  const slots = keepCount(counts, picked);
  // The hit PC's own thresholds and trackers (HD2's sheet read; the player's own, or the GM's own PC).
  const sheet = useQuery(api.combatHud.sheet, target ? { characterId } : "skip");
  const trackers = sheet ? { hp: sheet.trackers.hp, armor: sheet.trackers.armor } : null;
  const armor = offersArmor(mode);
  const cards = mode === "preRoll" ? [] : playableCards(view);
  const features = view.features ?? [];
  const sub = more > 0 ? `${windowSub(view, mode)} · ${more} more after this` : windowSub(view, mode);
  return (
    <Popup
      icon={HIT_ICON}
      tone="red"
      title={windowTitle(mode, characterName, gm)}
      sub={sub}
      className="hud-hit"
      testId="hud-hit-window"
      primary={primaryOf(view, mode, slots, busy, onAnswer)}
      secondary={secondaryOf(view, mode, busy, onAnswer)}
    >
      {target && (mode === "armorOne" || mode === "armorMany" || mode === "ok" || mode === "afterArmor") ? (
        <>
          <div className="hud-hit-dmg">
            <b data-testid="hud-hit-damage">{view.damage ?? 0}</b>
            <span>damage</span>
          </div>
          <Tiles tiles={thresholdTiles(view, sheet ? sheet.thresholds : null)} />
          <Ask view={view} mode={mode} slots={slots} />
          {mode === "armorMany" && counts.length > 1 ? (
            <div className="hud-hit-split">
              <span>Armor Slots to mark</span>
              <Stepper
                label="Armor Slots to mark"
                value={slots}
                min={counts[0]!}
                max={counts[counts.length - 1]!}
                disabled={busy}
                onStep={(d) => setPicked(stepCount(counts, slots, d))}
              />
            </div>
          ) : null}
          {mode === "afterArmor" ? null : <Preview rows={previewRows(view, mode, armor ? slots : 0, trackers)} />}
          {sheet === undefined ? (
            <p role="status" className="hud-hit-muted">
              Loading your sheet…
            </p>
          ) : null}
        </>
      ) : null}
      {mode === "ally" ? <p>Use a reaction that answers this hit, or pass.</p> : null}
      {mode === "preRoll" ? <p>Use a defence before the roll, or pass.</p> : null}
      {mode === "afterHit" ? <p>{view.deathMove ? "This hit marks your last Hit Point. A reaction can still answer it." : "The hit landed. A reaction can still answer it."}</p> : null}
      <Reactions
        cardIds={cards}
        features={features}
        disabled={busy}
        onCard={(cardId) => onAnswer({ kind: "card", cardId })}
        onFeature={(f, picks) => onAnswer(featureChoice(f, picks))}
      />
      {target && mode !== "afterArmor" && mode !== "afterHit" ? (
        <PayElse grants={view.grants ?? []} comingHp={baseStep(view).hp} disabled={busy} onSpend={(g, amount) => onAnswer({ kind: "grant", id: g.id, amount })} />
      ) : null}
      {error ? (
        <p role="alert" className="hud-hit-err">
          {error}
        </p>
      ) : null}
    </Popup>
  );
}

function Ask({ view, mode, slots }: { view: HitView; mode: HitWindowMode; slots: number }) {
  const ask = armorAsk(view, mode, slots);
  return (
    <p className="hud-hit-q" data-testid="hud-hit-question">
      {ask.lead}
      {ask.result ? <b>{ask.result}</b> : null}
      {ask.tail}
    </p>
  );
}

/** The footer's one primary: Mark Armor (with the count), else take the hit, else Done / Pass. */
function primaryOf(view: HitView, mode: HitWindowMode, slots: number, busy: boolean, onAnswer: (c: HitChoice) => void) {
  if (offersArmor(mode)) return { label: markLabel(view, slots), disabled: busy, onClick: () => onAnswer({ kind: "armor", slots }) };
  if (mode === "ok") return { label: takeLabel(view), disabled: busy, onClick: () => onAnswer({ kind: "noArmor" }) };
  if (mode === "afterArmor" || mode === "afterHit") return { label: "Done", disabled: busy, onClick: () => onAnswer({ kind: "pass" }) };
  return undefined;
}

/** Left of the primary: "Take 2 HP" beside Mark Armor; Pass for an ally or before the roll. */
function secondaryOf(view: HitView, mode: HitWindowMode, busy: boolean, onAnswer: (c: HitChoice) => void): ReactNode {
  if (offersArmor(mode)) {
    return (
      <button type="button" className={hudButtonClass()} disabled={busy} onClick={() => onAnswer({ kind: "noArmor" })}>
        {takeLabel(view)}
      </button>
    );
  }
  if (mode === "ally" || mode === "preRoll") {
    return (
      <button type="button" className={hudButtonClass()} disabled={busy} onClick={() => onAnswer({ kind: "pass" })}>
        Pass
      </button>
    );
  }
  return null;
}
