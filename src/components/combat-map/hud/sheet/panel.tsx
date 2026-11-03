"use client";

// The classic drawer's control styles (D5 Use, prompts, class controls: `sd-*`), loaded here since H9.5 removed
// `SheetExtras`, which loaded them for the page.
import "../../drawer/drawer.css";
import "./sheet.css";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { refusalFor, type Refusal } from "@/lib/errors/refusals";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useHandSharing } from "../../actions/hand/sharing";
import { D5Use } from "../../drawer/list/controls";
import { DrawerPrompts } from "../../drawer/prompts";
import { FeatureUse } from "../../drawer/use";
import { usePlayFor } from "../../play-for";
import type { CombatMapSummary, CombatRole } from "../../slots";
import { Portrait } from "../banners/banner";
import { BlockedReason, RefusalMessage, blockedReason, hudToasts, useBlocked } from "../blocked";
import { useAttackPicker } from "../pick-attack";
import { useFeatureUse } from "../pick-feature";
import { featurePlan } from "../pick-feature/model";
import { usedText } from "../hand/states";
import { pcHolds } from "../spotlight/model";
import { useSpotlight } from "../spotlight";
import { PartBoundary, Pips, SidePanel, StatTile, Toggle } from "../ui";
import { FeatureHeld, SheetClassView, SheetCounters, SheetFlying, SheetForm, type ClassHere } from "./class";
import {
  applyStep,
  applyStepToParty,
  conditionName,
  d5Key,
  featureNotes,
  kindLabel,
  mapUses,
  pipsOn,
  roNote,
  sheetBadge,
  sheetRights,
  SHEET_CONDITIONS,
  stepLabel,
  toggleConditionIn,
  toggleConditionInParty,
  trackerOf,
  TRACKER_ORDER,
  TRACKERS,
  type HudSheetData,
  type HudSheetFeature,
  type HudSheetUse,
  type SheetCondition,
  type TrackerResource,
} from "./model";

export type SheetPanelProps = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  map: CombatMapSummary | null;
  characterId: Id<"characters">;
  onClose: () => void;
};

/**
 * One PC's sheet in the HUD's right panel (H0's `SidePanel`: a non-modal `<aside>` named "<name>'s sheet", Esc and ✕
 * close it, focus goes to its heading on open and back to the opener on close). Data: `combatHud.sheet` (HD2) for the
 * numbers, features, thresholds, Experiences, conditions and effects in every mode; the banners' `combatHud.party` row
 * for the portrait; `combatSpotlight.state` for the Spotlight badge; `playFor.list` (GM) and `combatCards.handSharing`
 * (own) for the two switches. Every change is an intent with an optimistic update (rule 12).
 */
export function SheetPanel({ campaignId, role, map, characterId, onClose }: SheetPanelProps) {
  const sheet = useQuery(api.combatHud.sheet, { characterId });
  const party = useQuery(api.combatHud.party, map ? { campaignId, mapId: map._id } : "skip");
  const spotlight = useSpotlight(campaignId);
  const playFor = usePlayFor(campaignId, characterId, role === "gm");
  const titleRef = useRef<HTMLSpanElement>(null);
  const focused = useRef(false);
  const loaded = sheet !== undefined;

  // Focus goes to the heading once the first sheet has loaded (SidePanel's own effect, which runs first, has already
  // remembered the opener and focused the panel). Swapping to another sheet keeps focus where it is.
  useEffect(() => {
    if (!loaded || focused.current) return;
    focused.current = true;
    const heading = titleRef.current?.closest("h2");
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [loaded]);

  const name = sheet?.name ?? "Character";
  const member = party?.find((m) => m.characterId === characterId);
  const badge = sheet ? sheetBadge(sheet.mode, pcHolds(spotlight, characterId)) : null;

  return (
    <SidePanel
      open
      onClose={onClose}
      label={`${name}’s sheet`}
      className="hsh"
      testId="hud-sheet"
      title={
        <span ref={titleRef} className="hsh-title">
          <Portrait member={{ name, portrait: member?.portrait ?? null, mine: sheet?.mode === "own" }} className="hsh-face" sizes="60px" />
          <span className="hsh-name">
            <b>{name}</b>
            {sheet ? (
              <small>
                {sheet.className} · Level {sheet.level}
              </small>
            ) : null}
          </span>
        </span>
      }
      headerEnd={
        <>
          {badge ? (
            <span className={cn("hsh-tag", `hsh-tag-${badge.tone}`)} data-testid="hud-sheet-badge">
              {badge.text}
            </span>
          ) : null}
          {sheet?.mode === "gm" ? (
            <div className="hsh-playfor">
              <Toggle checked={playFor.on} onChange={playFor.set} label="Play for this character" />
              {playFor.error ? (
                <p role="alert" className="hsh-error">
                  {playFor.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      }
    >
      {sheet === undefined ? (
        <p role="status" className="hsh-muted">
          Loading the sheet…
        </p>
      ) : (
        <SheetBody campaignId={campaignId} role={role} map={map} sheet={sheet} playingFor={playFor.on} spotlightWithGm={spotlight?.reactionsOnly === true} />
      )}
    </SidePanel>
  );
}

function SheetBody({
  campaignId,
  role,
  map,
  sheet,
  playingFor,
  spotlightWithGm,
}: {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  map: CombatMapSummary | null;
  sheet: HudSheetData;
  playingFor: boolean;
  /** The GM holds the spotlight (H6.2): action Uses wait, React stays (answer 1c). */
  spotlightWithGm: boolean;
}) {
  const rights = sheetRights(sheet.mode, playingFor);
  const note = roNote(sheet.mode, sheet.name, playingFor);
  const [using, setUsing] = useState<{ featureId: string; useId: string } | null>(null);
  // H3.3: Use opens the HUD's picking panel; the classic flow keeps what the HUD does not run (count, Charge).
  const featureUse = useFeatureUse({ campaignId, role, map, characterId: sheet.characterId, canUse: rights.use });
  // H9.5: the class controls (own and gm only: they read `combatFeatures.drawer`); the GM's act with Play-for on.
  const here: ClassHere | null = sheet.mode === "view" ? null : { campaignId, characterId: sheet.characterId, canAct: rights.use };
  return (
    <div className={cn("hsh-body", !rights.edit && "hsh-ro")} data-mode={sheet.mode}>
      <div className="hsh-stats">
        <StatTile label="Evasion" value={sheet.evasion} />
        <StatTile label="Armor" value={sheet.armorScore} />
        <StatTile label="Level" value={sheet.level} />
      </div>

      <SheetTrackers sheet={sheet} edit={rights.edit} />

      {here ? (
        <PartBoundary label="Class counters">
          <SheetCounters {...here} />
        </PartBoundary>
      ) : (
        <SheetClassView sheet={sheet} />
      )}

      {note ? (
        <p className={cn("hsh-note", sheet.mode === "gm" && "hsh-note-gm")} data-testid="hud-sheet-note">
          <LockIcon />
          {note}
        </p>
      ) : null}

      {rights.hideHand ? (
        <PartBoundary label="Hand sharing">
          <HideHand campaignId={campaignId} characterId={sheet.characterId} />
        </PartBoundary>
      ) : null}

      {sheet.mode === "gm" && playingFor ? (
        <PartBoundary label="The attack">
          <SheetAttack campaignId={campaignId} role={role} map={map} characterId={sheet.characterId} name={sheet.name} />
        </PartBoundary>
      ) : null}

      {here ? (
        <PartBoundary label="Beastform and stance">
          <SheetForm {...here} />
        </PartBoundary>
      ) : null}

      <section aria-labelledby="hsh-sec-features">
        <h3 id="hsh-sec-features" className="hsh-sec">
          Features
        </h3>
        {sheet.features.length === 0 ? <p className="hsh-muted">No features yet.</p> : null}
        <ul className="hsh-fts">
          {sheet.features.map((f) => (
            <FeatureRow key={f.featureId} here={here} feature={f} sheet={sheet} canUse={rights.use} spotlightWithGm={spotlightWithGm} onUse={(useId) => (featureUse.open({ featureId: f.featureId, useId }) === "classic" ? setUsing({ featureId: f.featureId, useId }) : setUsing(null))} />
          ))}
        </ul>
        {using && rights.use ? (
          // The classic Use flow until H3.3 (the HUD's picking pattern) replaces it.
          <div className="hsh-use-flow">
            <FeatureUse campaignId={campaignId} role={role} map={map} characterId={sheet.characterId} featureId={using.featureId} useId={using.useId} onClose={() => setUsing(null)} />
          </div>
        ) : null}
      </section>

      {sheet.mode !== "view" ? (
        <PartBoundary label="The prompts">
          <SheetPrompts campaignId={campaignId} role={role} map={map} characterId={sheet.characterId} canAct={rights.use} />
        </PartBoundary>
      ) : null}

      <section aria-labelledby="hsh-sec-thr">
        <h3 id="hsh-sec-thr" className="hsh-sec">
          Damage thresholds
        </h3>
        <div className="hsh-thr">
          <span>
            Minor<small>1 HP</small>
          </span>
          <span>
            Major<b>{sheet.thresholds.major}+</b>
            <small>2 HP</small>
          </span>
          <span>
            Severe<b>{sheet.thresholds.severe}+</b>
            <small>3 HP</small>
          </span>
        </div>
      </section>

      <section aria-labelledby="hsh-sec-xp">
        <h3 id="hsh-sec-xp" className="hsh-sec">
          Experiences
        </h3>
        {sheet.experiences.length === 0 ? (
          <p className="hsh-muted">None yet.</p>
        ) : (
          <ul className="hsh-xp">
            {sheet.experiences.map((x) => (
              <li key={x.id}>
                {x.name} <b>{x.value >= 0 ? `+${x.value}` : x.value}</b>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SheetConditions sheet={sheet} edit={rights.edit}>
        {here ? (
          <PartBoundary label="Flying">
            <SheetFlying {...here} />
          </PartBoundary>
        ) : null}
      </SheetConditions>
    </div>
  );
}

/**
 * dcm-bxp.99.32.36 (user 2026-11-02): the GM playing for this PC attacks through the player's weapon attack picker
 * (H3.2's `useAttackPicker`, with the PC as the session's actor), one button per equipped weapon. The action ring opens
 * on a player's own token only (H3.4), so the sheet is the GM's entry.
 */
function SheetAttack({ campaignId, role, map, characterId, name }: { campaignId: Id<"campaigns">; role: CombatRole; map: CombatMapSummary | null; characterId: Id<"characters">; name: string }) {
  const attack = useAttackPicker({ campaignId, role, mode: "play", map, previewCharacterId: null }, characterId);
  const headingId = useId();
  const weapons = attack.weapons.length > 0 ? attack.weapons : [null];
  return (
    <section aria-labelledby={headingId} data-testid="hud-sheet-attack">
      <h3 id={headingId} className="hsh-sec">
        Attack
      </h3>
      <div className="hsh-atks">
        {weapons.map((w) => (
          <button
            key={w?.slot ?? "none"}
            type="button"
            className="hsh-use hsh-atk"
            disabled={!attack.ready}
            aria-label={w ? `Attack with ${w.name} for ${name}` : `Attack for ${name}`}
            title={attack.reason ?? undefined}
            data-testid="hud-sheet-attack-weapon"
            onClick={() => attack.open(w ? { slot: w.slot } : {})}
          >
            {w ? `Attack · ${w.name}` : "Attack"}
          </button>
        ))}
      </div>
      {attack.reason && !attack.ready && attack.reason !== "Loading your weapons…" ? <p className="hsh-muted">{attack.reason}</p> : null}
    </section>
  );
}

function LockIcon() {
  return (
    <svg className="hsh-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M5 7V5a3 3 0 0 1 6 0v2h-1.5V5a1.5 1.5 0 0 0-3 0v2z" />
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
    </svg>
  );
}

/** HP / Stress / Hope / Armor: pips, "n of 6 marked", and − / + for own and GM (one `characters.adjustResource` intent a click). */
function SheetTrackers({ sheet, edit }: { sheet: HudSheetData; edit: boolean }) {
  const [error, setError] = useState<Refusal | null>(null);
  const adjust = useMutation(api.characters.adjustResource).withOptimisticUpdate((store, args) => {
    if (args.resource === "scars") return;
    const resource = args.resource;
    const current = store.getQuery(api.combatHud.sheet, { characterId: args.characterId });
    if (current !== undefined) store.setQuery(api.combatHud.sheet, { characterId: args.characterId }, { ...current, trackers: applyStep(current.trackers, resource, args.delta) });
    for (const { args: q, value } of store.getAllQueries(api.combatHud.party)) {
      if (value === undefined) continue;
      store.setQuery(api.combatHud.party, q, value.map((m) => (m.characterId === args.characterId ? applyStepToParty(m, resource, args.delta) : m)));
    }
  });
  function step(resource: TrackerResource, delta: -1 | 1) {
    setError(null);
    adjust({ characterId: sheet.characterId, resource, delta }).catch((e: unknown) => setError(refusalFor(e)));
  }
  return (
    <div className="hsh-trks" data-testid="hud-sheet-trackers">
      {TRACKER_ORDER.map((r) => {
        const t = trackerOf(sheet.trackers, r);
        const { name, short } = TRACKERS[r];
        if (r === "armor" && t.max === 0) return null;
        return (
          <div key={r} className={cn("hsh-trk", `hsh-trk-${r}`)} role="group" aria-label={name} data-resource={r}>
            <span className="hsh-trk-l" aria-hidden="true">
              {short}
            </span>
            <Pips kind={r} on={pipsOn(sheet.trackers, r)} max={t.max} label={`${name}: ${t.text}`} />
            <span className="hsh-trk-c">
              {edit ? (
                <button type="button" aria-label={stepLabel(r, -1)} disabled={t.value <= 0} onClick={() => step(r, -1)}>
                  −
                </button>
              ) : null}
              <output aria-live="polite">
                <b>{t.value}</b>
                <small>{r === "hope" ? ` of ${t.max}` : ` of ${t.max} marked`}</small>
              </output>
              {edit ? (
                <button type="button" aria-label={stepLabel(r, 1)} disabled={t.value >= t.max} onClick={() => step(r, 1)}>
                  +
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
      <RefusalMessage refusal={error} className="hsh-error" />
    </div>
  );
}

/**
 * Why one Use of a feature can't start (H6.2, CmpBlocked layer 1 in H6.1's words), or null: the GM's spotlight for an
 * action (a reaction stays, answer 1c), then a fixed Hope cost above the sheet's Hope. Stress never locks: Stress past
 * full marks a Hit Point (CB p.106). A spent use shows the sheet badge instead (`usedText`).
 */
function blockedUseOf(feature: HudSheetFeature, u: HudSheetUse, hope: number, spotlightWithGm: boolean) {
  const plan = featurePlan(feature.featureId, u.useId);
  const name = feature.uses && feature.uses.length > 1 ? u.name : feature.name;
  return blockedReason({
    kind: "feature",
    subject: name,
    spotlightWithGm,
    reaction: u.activation === "reaction",
    ...(plan.kind === "classic" ? {} : { costs: plan.use.costs, room: { hope } }),
  });
}

type FeatureRowProps = { feature: HudSheetFeature; sheet: HudSheetData; canUse: boolean; spotlightWithGm: boolean; onUse: (useId: string) => void };

/**
 * One feature. A spent-looking one on an own / gm sheet asks the drawer whether its effect still holds (DA7 "Active",
 * H9.5: `FeatureHeld`, in its own boundary); everything else renders at once.
 */
function FeatureRow({ here, ...props }: FeatureRowProps & { here: ClassHere | null }) {
  if (here === null || !props.feature.used) return <FeatureRowBody {...props} held={null} />;
  return (
    <PartBoundary label={props.feature.name}>
      <FeatureHeld here={here} featureId={props.feature.featureId}>
        {(held) => <FeatureRowBody {...props} held={held} />}
      </FeatureHeld>
    </PartBoundary>
  );
}

/**
 * Name, text, cost / limit notes, and on the right its Use (own; GM with Play for), a locked cost (view) or its kind.
 * `held` (DA7): the feature's effect still holds: an "Active" banner with when it comes back instead of "Used".
 */
function FeatureRowBody({ feature, sheet, canUse, spotlightWithGm, onUse, held }: FeatureRowProps & { held: { resetLabel: string | null } | null }) {
  const uses = mapUses(feature);
  const d5 = d5Key(feature);
  const notes = held ? [] : featureNotes(feature);
  const gm = sheet.mode === "gm";
  const usable = sheet.mode !== "view" && (uses.length > 0 || d5 !== null);
  const forWhom = gm ? ` for ${sheet.name}` : "";
  // H6.2: the refusal of a press on a blocked Use, under the row (CmpBlocked "feature disabled").
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const reasons = canUse ? uses.map((u) => (u.ready ? blockedUseOf(feature, u, sheet.trackers.hope.value, spotlightWithGm) : null)) : [];
  const first = reasons.find((r) => r !== null) ?? null;
  const why = useBlocked(first);
  return (
    <li className={cn("hsh-ft", sheet.mode === "view" && "hsh-ft-ro", feature.used && !held && "hsh-ft-used")} data-feature={feature.featureId} data-state={held ? "active" : undefined}>
      <div className="hsh-ft-main">
        <b>{feature.name}</b>
        {held ? (
          <span className="hsh-active" data-testid="hud-sheet-active">
            <span className="hsh-active-tag">Active</span>
            {held.resetLabel ? ` ${held.resetLabel}.` : null}
          </span>
        ) : null}
        <small>{feature.text}</small>
        {notes.length > 0 ? <span className="hsh-ft-notes">{notes.join(" · ")}</span> : null}
        {why.blocked ? <BlockedReason id={why.reasonId}>{why.text}</BlockedReason> : null}
        <RefusalMessage refusal={refusal} />
      </div>
      <div className="hsh-ft-act">
        {usable && uses.length > 0
          ? uses.map((u, i) => {
              const label = `${u.activation === "reaction" ? "React with" : "Use"} ${uses.length > 1 ? u.name : feature.name}${forWhom}`;
              if (canUse && !u.ready && held) {
                // DA7: the effect holds; the Use comes back when it ends (the banner says when).
                return (
                  <span key={u.useId} className="hsh-use hsh-use-ro hsh-badge" role="img" aria-label={`${label}: active`} data-testid="hud-sheet-held">
                    <LockIcon />
                    Active
                  </span>
                );
              }
              if (canUse && !u.ready) {
                // CmpBlocked "sheet badge": a spent use says when it comes back instead of a dead button.
                return (
                  <span key={u.useId} className="hsh-use hsh-use-ro hsh-badge" role="img" aria-label={`${label}: ${usedText(u.resetLabel ?? feature.resetLabel)}`} data-testid="hud-sheet-used">
                    <LockIcon />
                    {usedText(u.resetLabel ?? feature.resetLabel)}
                  </span>
                );
              }
              const blocked = reasons[i] ?? null;
              return (
                <button
                  key={u.useId}
                  type="button"
                  className="hsh-use"
                  disabled={!canUse}
                  aria-disabled={blocked ? true : undefined}
                  aria-describedby={blocked ? why.reasonId : undefined}
                  aria-label={label}
                  data-blocked={blocked?.code}
                  onClick={() => {
                    if (!blocked) {
                      setRefusal(null);
                      onUse(u.useId);
                      return;
                    }
                    // The refusal the table words for it: under the row, or a toast where the table places it.
                    if (blocked.refusal.place === "toast") hudToasts.refusal(blocked.refusal);
                    else setRefusal(blocked.refusal);
                  }}
                >
                  {blocked ? <LockIcon /> : null}
                  {u.activation === "reaction" ? "React" : "Use"}
                  {uses.length > 1 ? ` · ${u.name}` : ""}
                  {gm ? forWhom : ""}
                </button>
              );
            })
          : null}
        {usable && uses.length === 0 && d5 !== null ? <D5Use characterId={sheet.characterId} canAct={canUse} featureKey={d5} name={feature.name} /> : null}
        {!usable && sheet.mode === "view" && feature.cost && (feature.kind === "action" || feature.kind === "reaction") ? (
          <span className="hsh-use hsh-use-ro" aria-label={`${feature.cost}: only ${sheet.name}’s player and the GM can use it`} role="img">
            <LockIcon />
            {feature.cost}
          </span>
        ) : null}
        {!usable && !(sheet.mode === "view" && feature.cost && (feature.kind === "action" || feature.kind === "reaction")) ? <span className="hsh-k">{kindLabel(feature.kind)}</span> : null}
      </div>
    </li>
  );
}

/** The ally-roll prompts the classic drawer showed (Cannonball, DA13), from `combatFeatures.drawer` (own / GM only). */
function SheetPrompts({ campaignId, role, map, characterId, canAct }: { campaignId: Id<"campaigns">; role: CombatRole; map: CombatMapSummary | null; characterId: Id<"characters">; canAct: boolean }) {
  const drawer = useQuery(api.combatFeatures.drawer, { campaignId, characterId });
  if (drawer === undefined) {
    return (
      <p role="status" className="sr-only">
        Loading prompts…
      </p>
    );
  }
  return (
    <div className="hsh-prompts">
      <DrawerPrompts campaignId={campaignId} role={role} map={map} characterId={characterId} drawer={drawer} canAct={canAct} />
    </div>
  );
}

/** Answer 16a: "Hide my hand from other players" on your own sheet (`combatCards.setHandHidden`, optimistic). */
function HideHand({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }) {
  const sharing = useHandSharing(campaignId);
  const [error, setError] = useState<Refusal | null>(null);
  const setHidden = useMutation(api.combatCards.setHandHidden).withOptimisticUpdate((store, { characterId: id, hidden }) => {
    const current = store.getQuery(api.combatCards.handSharing, { campaignId });
    if (current === undefined) return;
    const rest = current.hidden.filter((c) => c !== id);
    store.setQuery(api.combatCards.handSharing, { campaignId }, { ...current, hidden: hidden ? [...rest, id] : rest });
  });
  if (sharing === undefined) {
    return (
      <p role="status" className="hsh-muted">
        Loading hand sharing…
      </p>
    );
  }
  const hidden = sharing.hidden.includes(characterId);
  return (
    <div className="hsh-hide">
      <Toggle
        checked={hidden || !sharing.playersSeeHands}
        disabled={!sharing.playersSeeHands}
        onChange={(on) => {
          setError(null);
          setHidden({ campaignId, characterId, hidden: on }).catch((e: unknown) => setError(refusalFor(e)));
        }}
        label="Hide my hand from other players"
        note={sharing.playersSeeHands ? "The GM always sees it." : "The GM keeps every hand hidden from the other players."}
      />
      <RefusalMessage refusal={error} className="hsh-error" />
    </div>
  );
}

/** Conditions (with their source and how long) and lasting effects; own and GM switch conditions (`characters.toggleCondition`). */
function SheetConditions({ sheet, edit, children }: { sheet: HudSheetData; edit: boolean; children?: ReactNode }) {
  const [error, setError] = useState<Refusal | null>(null);
  const toggle = useMutation(api.characters.toggleCondition).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.combatHud.sheet, { characterId: args.characterId });
    if (current !== undefined) store.setQuery(api.combatHud.sheet, { characterId: args.characterId }, toggleConditionIn(current, args.condition));
    for (const { args: q, value } of store.getAllQueries(api.combatHud.party)) {
      if (value === undefined) continue;
      store.setQuery(api.combatHud.party, q, value.map((m) => (m.characterId === args.characterId ? toggleConditionInParty(m, args.condition) : m)));
    }
  });
  // dcm-bxp.99.32.37: End on a lasting effect (the GM, the bearer's player, the caster's player: `canEnd`), the classic
  // list's `classFeatures.endEffect` intent; the row leaves at once (optimistic), the server ends what ends with it.
  const end = useMutation(api.classFeatures.endEffect).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.combatHud.sheet, { characterId: args.characterId });
    if (current !== undefined) store.setQuery(api.combatHud.sheet, { characterId: args.characterId }, { ...current, effects: current.effects.filter((x) => x.id !== args.effectId) });
  });
  const none = sheet.conditions.length === 0 && sheet.effects.length === 0;
  const on = new Set(sheet.conditions.map((c) => c.id));
  return (
    <section aria-labelledby="hsh-sec-cond">
      <h3 id="hsh-sec-cond" className="hsh-sec">
        Conditions & lasting effects
      </h3>
      {children}
      {none ? <p className="hsh-muted">None right now.</p> : null}
      {!none ? (
        <ul className="hsh-cds">
          {sheet.conditions.map((c) => (
            <li key={`c:${c.id}`} className="hsh-cdl">
              <ConditionDot />
              <span>
                {c.label}
                {c.source ? <small> · {c.source}</small> : null}
              </span>
              {c.until ? <em>{c.until}</em> : null}
            </li>
          ))}
          {sheet.effects.map((e) => (
            <li key={`e:${e.id}`} className="hsh-eff">
              <span>
                <b>{e.source}</b> {e.text}
              </span>
              <em>{e.until}</em>
              {e.canEnd ? (
                <button
                  type="button"
                  className="hsh-end"
                  aria-label={`End ${e.source} on ${sheet.name}`}
                  data-testid="hud-sheet-end-effect"
                  onClick={() => {
                    setError(null);
                    end({ characterId: sheet.characterId, effectId: e.id, idempotencyKey: crypto.randomUUID() }).catch((err: unknown) => setError(refusalFor(err)));
                  }}
                >
                  End
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {edit ? (
        <div className="hsh-cond-tgs" role="group" aria-label="Switch conditions">
          {SHEET_CONDITIONS.map((id: SheetCondition) => (
            <button
              key={id}
              type="button"
              aria-pressed={on.has(id)}
              onClick={() => {
                setError(null);
                toggle({ characterId: sheet.characterId, condition: id }).catch((e: unknown) => setError(refusalFor(e)));
              }}
            >
              {conditionName(id)}
            </button>
          ))}
        </div>
      ) : null}
      <RefusalMessage refusal={error} className="hsh-error" />
    </section>
  );
}

function ConditionDot() {
  return (
    <svg className="hsh-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
