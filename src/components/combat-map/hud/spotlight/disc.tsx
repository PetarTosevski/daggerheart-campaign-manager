"use client";

import "./spotlight.css";

import { useMutation, useQuery } from "convex/react";
import Image from "next/image";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { refusalFor } from "@/lib/errors/refusals";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Portrait, hpText, type HudPartyMember } from "../banners/banner";
import { closePanel, togglePanel, usePanelOpen } from "../panels";
import { canRevive, ReviveBox, ReviveButton, type ReviveTarget } from "../revive";
import { artOf, type TokenArt } from "../token/model";
import { hudButtonClass } from "../ui";
import {
  afterHandTo,
  afterHandToParty,
  afterRefill,
  afterTake,
  discHolder,
  discLabel,
  holderArt,
  initialOf,
  isDefeatedRow,
  livingFirst,
  NO_ACTIONS_LEFT,
  takePay,
  tokensText,
  trackerOn,
  type ActionTokens,
  type DiscHolder,
  type SpotlightState,
} from "./model";

/**
 * The spotlight disc (plan combat-hud H9.1; HANDOFF "App bar and spotlight"; CmpTokens 'Spotlight', GMDesktop, GMTablet,
 * Main, PlayerTablet, PlayerPhone). It hangs from a cord left of the day disc and shows whoever has the spotlight, lit
 * from above: the whole party (2 × 2 mini portraits, gold), one PC (the portrait, gold) or an adversary (purple light:
 * the portrait its map token draws, user 2026-11-04, else its initial on red). Faces cross-fade over 200 ms (none under
 * reduced motion, the device's or the account's).
 *
 * - GM: a button "Spotlight: <name>. Change who has it" that opens the popover (`panels.ts` "spotlight", one GM panel
 *   at a time): tabs Party (the whole party first, user answer Q8 a, then each PC with class, Hope and HP) and
 *   Adversaries (Free / 1 Fear, user answer Q7 a, then each adversary on the map with kind and HP). The holder's row
 *   says "Has it"; another row moves the spotlight (optimistic) and closes the popover.
 * - Players: the same disc, view only (`role="img"`, "Spotlight: <name>"). Which adversary a player sees named is the
 *   server's rule (`combatSpotlight.state`: only one the party saw this scene); otherwise "The GM".
 * - Phone (`PhoneSpotlight`): a 44 px disc under the party strip with a "Spotlight · <name>" pill.
 * - Spotlight Tracker (optional rule, CB p.89, plan rule-switches RT; only while it is on): a player sees their PC's
 *   action tokens under the disc and, at 0, "No actions left: let another player act" (warned, not refused, Q9 a); the
 *   GM's Party rows say "2 of 3 actions left", and the Party tab has "Refill actions" (`combatSpotlight.refillTokens`).
 *
 * Every part calls `useQuery`, so it sits under a `PartBoundary` (the fear region's, the phone region's; CL1).
 */

type Pay = "free" | "fear";
type AdversaryRow = {
  tokenId: Id<"combatTokens">;
  name: string;
  sub: string;
  hp: number;
  hpMax: number;
  art: TokenArt | null;
  defeated: boolean;
  /** The GM may revive it (bead dcm-6c2o): defeated in the running encounter; else null. */
  revive: ReviveTarget | null;
};

/** The GM's moves from the disc: intents with optimistic updates (CL3 / CL4); the last refusal in the refusal table's words. */
function useDiscMoves(campaignId: Id<"campaigns">, mapId: Id<"combatMaps"> | undefined) {
  const [error, setError] = useState<string | null>(null);
  const take = useMutation(api.combatSpotlight.gmTake);
  const hand = useMutation(api.combatSpotlight.handTo);
  const party = useMutation(api.combatSpotlight.handToParty);
  const refill = useMutation(api.combatSpotlight.refillTokens);
  const fail = (e: unknown) => setError(refusalFor(e, { viewer: "gm" }).text);
  const key = () => crypto.randomUUID();
  return {
    error,
    refillTokens: () => {
      setError(null);
      refill
        .withOptimisticUpdate((store, args) => {
          if (mapId === undefined) return;
          const query = { campaignId: args.campaignId, mapId };
          const current = store.getQuery(api.combatHud.party, query);
          if (current !== undefined) store.setQuery(api.combatHud.party, query, afterRefill(current));
        })({ campaignId, idempotencyKey: key() })
        .catch(fail);
    },
    toParty: () => {
      setError(null);
      party
        .withOptimisticUpdate((store, args) => {
          const current = store.getQuery(api.combatSpotlight.state, { campaignId: args.campaignId });
          if (current !== undefined) store.setQuery(api.combatSpotlight.state, { campaignId: args.campaignId }, afterHandToParty(current));
        })({ campaignId, idempotencyKey: key() })
        .catch(fail);
    },
    toPc: (pc: { characterId: Id<"characters">; name: string }) => {
      setError(null);
      hand
        .withOptimisticUpdate((store, args) => {
          const current = store.getQuery(api.combatSpotlight.state, { campaignId: args.campaignId });
          if (current !== undefined) store.setQuery(api.combatSpotlight.state, { campaignId: args.campaignId }, afterHandTo(current, pc, Date.now()));
        })({ campaignId, characterId: pc.characterId, idempotencyKey: key() })
        .catch(fail);
    },
    toAdversary: (tokenId: Id<"combatTokens">, pay: Pay) => {
      setError(null);
      take
        .withOptimisticUpdate((store, args) => {
          const id = args.campaignId as Id<"campaigns">;
          const current = store.getQuery(api.combatSpotlight.state, { campaignId: id });
          if (current !== undefined) store.setQuery(api.combatSpotlight.state, { campaignId: id }, afterTake(current, Date.now(), tokenId));
          if (args.pay !== "fear") return;
          const scene = store.getQuery(api.combatHud.scene, { campaignId: id });
          if (scene !== undefined && scene.fear !== null) store.setQuery(api.combatHud.scene, { campaignId: id }, { ...scene, fear: Math.max(0, scene.fear - 1) });
          const fear = store.getQuery(api.campaigns.fear, { campaignId: id });
          if (fear !== undefined && fear !== null) store.setQuery(api.campaigns.fear, { campaignId: id }, Math.max(0, fear - 1));
        })({ campaignId, tokenId, pay, idempotencyKey: key() })
        .catch(fail);
    },
  };
}

const Flame = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
  </svg>
);

/** The whole party's 2 × 2 mini portraits (board `.sp-grp`). */
function PartyFace({ party }: { party: readonly HudPartyMember[] }) {
  return (
    <span className="hud-spd-grp">
      {party.slice(0, 4).map((member) => (
        <Portrait key={member.characterId} member={{ ...member, mine: false }} className="hud-spd-mini" sizes="36px" />
      ))}
    </span>
  );
}

/**
 * An adversary's face (user 2026-11-04): the portrait its map token draws, cropped to the circle, or its initial when it
 * has none or the image fails to load (remembered per source, so a new portrait gets its own try).
 */
function AdversaryFace({ name, art, sizes, initialClass }: { name: string; art: TokenArt | null; sizes: string; initialClass?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (art !== null && art.src !== failed) {
    return (
      <Image
        src={art.src}
        alt=""
        fill
        sizes={sizes}
        // Uploads and rulebook art are remote URLs (no optimiser); design art is local and optimised.
        unoptimized={art.remote}
        className="hud-spf-img"
        style={{ objectPosition: art.position }}
        data-testid="hud-spotlight-art"
        onError={() => setFailed(art.src)}
      />
    );
  }
  return initialClass ? <span className={initialClass}>{initialOf(name)}</span> : <>{initialOf(name)}</>;
}

/**
 * Every face the disc can show, stacked; only the holder's is on, so a change cross-fades (200 ms) without remounting.
 * The adversary layer's portrait or letter changes in place.
 */
function DiscFaces({ holder, party, art }: { holder: DiscHolder; party: readonly HudPartyMember[]; art: TokenArt | null }) {
  const pcOn = holder.kind === "pc" && !party.some((m) => m.characterId === holder.characterId);
  return (
    <>
      <span className="hud-spf" data-on={holder.kind === "party"}>
        <PartyFace party={party} />
      </span>
      {party.map((member) => (
        <span key={member.characterId} className="hud-spf" data-on={holder.kind === "pc" && holder.characterId === member.characterId}>
          <Portrait member={{ ...member, mine: false }} className="hud-spd-face" sizes="72px" />
        </span>
      ))}
      {/* A PC holder whose token is not on this map: its initial. */}
      <span className="hud-spf hud-spf-pc" data-on={pcOn}>
        {holder.kind === "pc" ? initialOf(holder.name) : ""}
      </span>
      <span className="hud-spf hud-spf-en" data-on={holder.kind === "adversary"}>
        {holder.kind === "adversary" ? <AdversaryFace name={holder.name} art={art} sizes="72px" /> : ""}
      </span>
      <span className="hud-spf hud-spf-en" data-on={holder.kind === "gm"}>
        <Flame className="hud-spf-flame" />
      </span>
      <span className="hud-spd-shine" />
    </>
  );
}

/** The adversary tokens on the map (the GM's `combatTokensReads.list`), for the Adversaries tab and the disc's names. */
function useAdversaries(campaignId: Id<"campaigns">, mapId: Id<"combatMaps"> | undefined, on: boolean): AdversaryRow[] | undefined {
  const tokens = useQuery(api.combatTokensReads.list, on && mapId ? { campaignId, mapId } : "skip");
  if (tokens === undefined) return undefined;
  return tokens
    .filter((t) => t.kind === "adversary")
    .map((t) => ({
      tokenId: t._id,
      name: t.name,
      sub: t.sub,
      hp: t.stats?.hp ?? 0,
      hpMax: t.stats?.hpMax ?? 0,
      art: artOf(t.portrait),
      defeated: isDefeatedRow(t.stats),
      revive: canRevive(t) && t.instanceId ? { tokenId: t._id, instanceId: t.instanceId, name: t.name } : null,
    }));
}

/**
 * The GM's adversary art by token id, for the adversary holder's face (`holderArt`, which reads it only for an adversary
 * the disc names). A player has none: their disc draws the state's `adversaryPortrait`, the party's knowledge
 * (dcm-onze), whatever their own map draws.
 */
function gmTokenArt(gm: boolean, adversaries: AdversaryRow[] | undefined): ReadonlyMap<string, TokenArt | null> | undefined {
  if (!gm || adversaries === undefined) return undefined;
  return new Map(adversaries.map((a) => [a.tokenId as string, a.art]));
}

export type SpotlightDiscProps = {
  campaignId: Id<"campaigns">;
  mapId?: Id<"combatMaps">;
  gm: boolean;
  /** The GM's Fear now (`combatHud.scene`): "1 Fear" is disabled at 0. */
  fear: number;
};

/** The hanging disc in the fear region (desktop and tablet): the GM's button + popover, or the players' view-only disc. */
export function SpotlightDisc({ campaignId, mapId, gm, fear }: SpotlightDiscProps): ReactNode {
  const state = useQuery(api.combatSpotlight.state, { campaignId });
  const party = useQuery(api.combatHud.party, mapId ? { campaignId, mapId } : "skip");
  const adversaries = useAdversaries(campaignId, mapId, gm);
  const tokenArt = gmTokenArt(gm, adversaries);
  const open = usePanelOpen("spotlight");
  const moves = useDiscMoves(campaignId, mapId);
  const [reviving, setReviving] = useState<ReviveTarget | null>(null);
  const popId = useId();
  if (state === undefined) {
    return (
      <p role="status" className="sr-only">
        Loading the spotlight…
      </p>
    );
  }
  const names = new Map((adversaries ?? []).map((a) => [a.tokenId as string, a.name]));
  const holder = discHolder(state, names);
  const tone = holder.kind === "adversary" || holder.kind === "gm" ? "gm" : "gold";
  const members = party ?? [];
  const body = (
    <>
      <span className="hud-spd-cord" aria-hidden="true" />
      <span className="hud-spd-beam" aria-hidden="true" />
      <span className="hud-spd-disc" aria-hidden="true">
        <DiscFaces holder={holder} party={members} art={holderArt(holder, tokenArt, state.adversaryPortrait)} />
      </span>
      <span className="hud-spd-l" aria-hidden="true">
        Spotlight
        <b data-testid="hud-spotlight-name">{holder.name}</b>
      </span>
    </>
  );
  if (!gm || !state.canMove) {
    return (
      <>
        <div className={cn("hud-spd hud-spd-ro", `hud-spd-${tone}`)} role="img" aria-label={discLabel(holder, false)} data-testid="hud-spotlight-disc">
          {body}
        </div>
        <MyActionTokens party={members} className="hud-spd-tok" />
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        className={cn("hud-spd", `hud-spd-${tone}`)}
        aria-label={discLabel(holder, true)}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-testid="hud-spotlight-disc"
        onClick={(e) => togglePanel("spotlight", e.currentTarget)}
      >
        {body}
      </button>
      {moves.error ? (
        <p role="alert" className="hud-spd-err">
          {moves.error}
        </p>
      ) : null}
      {open ? (
        <SpotlightPopover
          id={popId}
          state={state}
          holder={holder}
          party={party}
          adversaries={adversaries}
          fear={fear}
          moves={moves}
          onClose={() => closePanel("spotlight", true)}
          onRevive={(target) => {
            closePanel("spotlight", true);
            setReviving(target);
          }}
        />
      ) : null}
      {reviving ? <ReviveBox campaignId={campaignId} mapId={mapId} target={reviving} onClose={() => setReviving(null)} /> : null}
    </>
  );
}

type PopoverProps = {
  id: string;
  state: SpotlightState;
  holder: DiscHolder;
  party: readonly HudPartyMember[] | undefined;
  adversaries: AdversaryRow[] | undefined;
  fear: number;
  moves: ReturnType<typeof useDiscMoves>;
  onClose: () => void;
  /** Opens the revive box for a defeated adversary (bead dcm-6c2o); the popover closes. */
  onRevive: (target: ReviveTarget) => void;
};

/** The PC row's line: "Druid · Hope 1 · HP 2 of 6 marked" (Spotlight Tracker on: "· 2 of 3 actions left"). */
export function pcRowLine(member: Pick<HudPartyMember, "className" | "hope" | "hp" | "tokens">): string {
  const line = `${member.className} · Hope ${member.hope.value} · HP ${member.hp.marked} of ${member.hp.max} marked`;
  return member.tokens === undefined ? line : `${line} · ${tokensText(member.tokens)}`;
}

/** A PC's action tokens as pips (filled: left), view only; the words are the caller's. */
function TokenPips({ tokens }: { tokens: ActionTokens }) {
  return (
    <span className="hud-tok-pips" aria-hidden="true">
      {Array.from({ length: tokens.of }, (_, i) => (
        <span key={i} className="hud-tok-pip" data-on={i < tokens.left} />
      ))}
    </span>
  );
}

/**
 * The caller's own PCs' Spotlight Tracker tokens (plan rule-switches RT): pips and words per PC, and at 0 the warning
 * "No actions left: let another player act" (Q9 a: the roll still goes through). Nothing while the rule is off or the
 * caller has no PC on the map. A polite live region, so the warning is announced when a roll spends the last token.
 */
function MyActionTokens({ party, className }: { party: readonly HudPartyMember[]; className: string }) {
  const mine = party.filter((m) => m.mine && m.tokens !== undefined);
  if (mine.length === 0) return null;
  return (
    <div className={className} role="status" data-testid="hud-action-tokens">
      {mine.map((m) => {
        const tokens = m.tokens!;
        return (
          <p key={m.characterId} className="hud-tok-row">
            <span className="hud-tok-who">{mine.length > 1 ? `${m.name}: ` : "Actions"}</span>
            <TokenPips tokens={tokens} />
            <span className="sr-only">{`${m.name}: ${tokensText(tokens)}.`}</span>
            {tokens.left === 0 ? (
              <span className="hud-tok-out" data-testid="hud-no-actions">
                {NO_ACTIONS_LEFT}
              </span>
            ) : null}
          </p>
        );
      })}
    </div>
  );
}

/** The adversary row's line: "Leader · HP 2 of 6 marked" (no kind for a custom token). */
export function adversaryRowLine(row: Pick<AdversaryRow, "sub" | "hp" | "hpMax">): string {
  const hp = `HP ${row.hp} of ${row.hpMax} marked`;
  return row.sub ? `${row.sub} · ${hp}` : hp;
}

/**
 * The GM's popover (board `.spp`, role dialog "Spotlight"): Close, the Party / Adversaries tabs (opening on the
 * holder's), the rows and the footer. Focus goes to the selected tab on open; Escape and Close return it to the disc.
 */
function SpotlightPopover({ id, state, holder, party, adversaries, fear, moves, onClose, onRevive }: PopoverProps) {
  const [tab, setTab] = useState<"party" | "adv">(holder.kind === "adversary" || holder.kind === "gm" ? "adv" : "party");
  const [pay, setPay] = useState<Pay>("free");
  const tabsId = useId();
  const partyTab = useRef<HTMLButtonElement>(null);
  const advTab = useRef<HTMLButtonElement>(null);
  // Focus the selected tab once, when the popover mounts (a ref callback, not an effect).
  const focused = useRef(false);
  const focusOnMount = (el: HTMLButtonElement | null) => {
    if (el && !focused.current) {
      focused.current = true;
      el.focus();
    }
  };
  const gmHolds = state.holder?.kind === "gm";
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = tab === "party" ? "adv" : "party";
    const to = e.key === "Home" ? "party" : e.key === "End" ? "adv" : next;
    setTab(to);
    (to === "party" ? partyTab : advTab).current?.focus();
  };
  const choose = (run: () => void, same: boolean) => {
    if (!same) run();
    onClose();
  };
  return (
    <div id={id} className={cn("hud-spp", tab === "adv" && "hud-spp-adv")} role="dialog" aria-label="Spotlight" data-testid="hud-spotlight-popover" onKeyDown={onKeyDown}>
      <div className="hud-spp-h">
        <b>Spotlight</b>
        <button type="button" className={cn(hudButtonClass("cancel"), "hud-spp-x")} aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="hud-spp-tabs" role="tablist" aria-label="Who gets the spotlight">
        <button
          ref={(el) => {
            partyTab.current = el;
            if (tab === "party") focusOnMount(el);
          }}
          type="button"
          role="tab"
          className={hudButtonClass("tool")}
          id={`${tabsId}-party`}
          aria-selected={tab === "party"}
          aria-controls={`${tabsId}-party-panel`}
          tabIndex={tab === "party" ? 0 : -1}
          onClick={() => setTab("party")}
          onKeyDown={onTabKey}
        >
          Party
        </button>
        <button
          ref={(el) => {
            advTab.current = el;
            if (tab === "adv") focusOnMount(el);
          }}
          type="button"
          role="tab"
          className={hudButtonClass("tool")}
          id={`${tabsId}-adv`}
          aria-selected={tab === "adv"}
          aria-controls={`${tabsId}-adv-panel`}
          tabIndex={tab === "adv" ? 0 : -1}
          onClick={() => setTab("adv")}
          onKeyDown={onTabKey}
        >
          Adversaries
        </button>
      </div>
      {tab === "party" ? (
        <div className="hud-spp-pane" role="tabpanel" id={`${tabsId}-party-panel`} aria-labelledby={`${tabsId}-party`}>
          <Row
            has={holder.kind === "party"}
            face={<PartyFace party={party ?? []} />}
            title="The whole party"
            line="No one chosen · players decide who acts"
            go="Give"
            label={holder.kind === "party" ? "The whole party has the spotlight" : "Give the spotlight to the whole party"}
            onClick={() => choose(moves.toParty, holder.kind === "party")}
          />
          {party === undefined ? (
            <p role="status" className="hud-spp-muted">
              Loading the party…
            </p>
          ) : (
            party.map((member) => {
              const has = holder.kind === "pc" && holder.characterId === member.characterId;
              return (
                <Row
                  key={member.characterId}
                  has={has}
                  face={<Portrait member={{ ...member, mine: false }} className="hud-spr-portrait" sizes="40px" />}
                  title={member.name}
                  line={pcRowLine(member)}
                  description={`${member.className}, Hope ${member.hope.value}, ${hpText(member)}${member.tokens === undefined ? "" : `, ${tokensText(member.tokens)}`}`}
                  go="Give"
                  label={has ? `${member.name} has the spotlight` : `Give the spotlight to ${member.name}`}
                  onClick={() => choose(() => moves.toPc({ characterId: member.characterId, name: member.name }), has)}
                />
              );
            })
          )}
          {trackerOn(party) ? (
            <button
              type="button"
              className={cn(hudButtonClass("secondary"), "hud-spp-refill")}
              data-testid="hud-refill-tokens"
              onClick={() => {
                moves.refillTokens();
                onClose();
              }}
            >
              Refill actions
              <span className="hud-spp-refill-n">Every PC back to full (the app refills once everyone is out)</span>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="hud-spp-pane" role="tabpanel" id={`${tabsId}-adv-panel`} aria-labelledby={`${tabsId}-adv`}>
          <div className="hud-sp-how" role="group" aria-label="How you take it">
            <button type="button" className={hudButtonClass()} aria-pressed={pay === "free"} onClick={() => setPay("free")}>
              <b>Free</b>
              <span>A player failed or rolled with Fear</span>
            </button>
            <button
              type="button"
              className={hudButtonClass("primary")}
              aria-pressed={pay === "fear"}
              aria-disabled={fear < 1 ? true : undefined}
              aria-describedby={fear < 1 ? `${tabsId}-nofear` : undefined}
              onClick={() => {
                if (fear >= 1) setPay("fear");
              }}
            >
              <b>
                <Flame className="hud-sp-how-ic" />1 Fear
              </b>
              <span>Interrupt the players</span>
            </button>
          </div>
          {fear < 1 ? (
            <p id={`${tabsId}-nofear`} className="hud-spp-muted">
              This needs 1 Fear. You have 0.
            </p>
          ) : gmHolds && pay === "fear" ? (
            <p className="hud-spp-muted">You already have the spotlight: moving it to another adversary is free.</p>
          ) : null}
          {adversaries === undefined ? (
            <p role="status" className="hud-spp-muted">
              Loading the adversaries…
            </p>
          ) : adversaries.length === 0 ? (
            <p className="hud-spp-muted">No adversaries on this map.</p>
          ) : (
            livingFirst(adversaries).map((row) => {
              const has = holder.kind === "adversary" && holder.tokenId === row.tokenId;
              // A defeated adversary (user 2026-11-04): at the bottom, disabled, "Defeated" in place of Take (the
              // server refuses it too, ADVERSARY_DEFEATED). While its encounter runs, hover or focus shows its Revive
              // pill (bead dcm-6c2o), a sibling of the row button (CL13).
              if (row.defeated) {
                return (
                  <div key={row.tokenId} className="hud-spr-wrap" data-testid="hud-spotlight-defeated">
                    <Row
                      gmRow
                      has={has}
                      off="Defeated"
                      face={<AdversaryFace name={row.name} art={row.art} sizes="40px" initialClass="hud-spr-en" />}
                      title={row.name}
                      line={adversaryRowLine(row)}
                      go="Take"
                      label={`${row.name}, defeated: can't take the spotlight`}
                      onClick={() => undefined}
                    />
                    {row.revive ? <ReviveButton target={row.revive} onOpen={onRevive} className="hud-rv-row" /> : null}
                  </div>
                );
              }
              return (
                <Row
                  key={row.tokenId}
                  gmRow
                  has={has}
                  face={<AdversaryFace name={row.name} art={row.art} sizes="40px" initialClass="hud-spr-en" />}
                  title={row.name}
                  line={adversaryRowLine(row)}
                  go="Take"
                  label={has ? `${row.name} has the spotlight` : `Take the spotlight for ${row.name}`}
                  onClick={() => choose(() => moves.toAdversary(row.tokenId, takePay(state, fear < 1 ? "free" : pay)), has)}
                />
              );
            })
          )}
        </div>
      )}
      <p className="hud-spp-n">Playing around one screen? Set it to whoever acts and the table sees the light move on the map.</p>
    </div>
  );
}

function Row({
  has,
  gmRow = false,
  face,
  title,
  line,
  description,
  go,
  label,
  off,
  onClick,
}: {
  has: boolean;
  gmRow?: boolean;
  face: ReactNode;
  title: string;
  line: string;
  description?: string;
  go: string;
  label: string;
  /** Disabled, with this tag in place of the go / "Has it" tag (a defeated adversary: "Defeated"). */
  off?: string;
  onClick: () => void;
}) {
  const lineId = useId();
  return (
    <button
      type="button"
      className={cn(hudButtonClass(gmRow ? "primary" : "secondary"), "hud-spr", gmRow && "hud-spr-gm", off && "hud-spr-off")}
      aria-pressed={has}
      aria-disabled={off ? true : undefined}
      aria-label={label}
      aria-describedby={lineId}
      onClick={off ? undefined : onClick}
    >
      <span className="hud-spr-f" aria-hidden="true">
        {face}
      </span>
      <span className="hud-spr-t" aria-hidden="true">
        <b>{title}</b>
        <span>{line}</span>
      </span>
      <span id={lineId} className="sr-only">
        {description ?? line}
      </span>
      <span className={off ? "hud-spr-dead" : has ? "hud-spr-has" : "hud-spr-go"} aria-hidden="true">
        {off ?? (has ? "Has it" : go)}
      </span>
    </button>
  );
}

/**
 * The phone's spotlight (PlayerPhone `.mspot`): a 44 px disc under the party strip, view only, with a "Spotlight ·
 * Moss" pill. Gold for the party or a PC, purple for an adversary or the GM (its portrait as on the map, else its
 * initial). The phone is the players' (`HudPhone`), so the art is the state's `adversaryPortrait` (party knowledge,
 * dcm-onze). With the Spotlight Tracker on, the player's action tokens sit beside it (plan rule-switches RT).
 */
export function PhoneSpotlight({ state, party }: { state: SpotlightState; party: readonly HudPartyMember[] }) {
  const holder = discHolder(state);
  const gm = holder.kind === "adversary" || holder.kind === "gm";
  return (
    <>
      <div className={cn("hud-mspot", gm && "hud-mspot-gm")} role="img" aria-label={discLabel(holder, false)} data-testid="hud-phone-spotlight">
        <span className="hud-ms-cord" aria-hidden="true" />
        <span className="hud-ms-disc" aria-hidden="true">
          <DiscFaces holder={holder} party={party} art={holderArt(holder, undefined, state.adversaryPortrait)} />
        </span>
        <span className="hud-ms-l" aria-hidden="true">
          Spotlight · <b>{holder.name}</b>
        </span>
      </div>
      {/* Spotlight Tracker (plan rule-switches RT): the player's tokens and the at-0 warning, left of the disc. */}
      <MyActionTokens party={party} className="hud-ms-tok" />
    </>
  );
}

