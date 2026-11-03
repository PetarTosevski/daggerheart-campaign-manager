"use client";

import { useQuery } from "convex/react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartyMember } from "../banners/banner";
import { HudFeed } from "../feed";
import { HudHand } from "../hand";
import { useAttackPicker } from "../pick-attack";
import { HudDice } from "../scene/dice";
import { sameSheet, useHud, type HudPartProps, type HudSheetTarget } from "../state";
import { PartBoundary, hudButtonClass } from "../ui";
import { PHONE_TABS, resourceItems, type PhoneTab, type ResourceItem } from "./model";

/**
 * The phone's bottom sheet (plan combat-hud H7.2; PlayerPhone 'Hand tab'; HANDOFF "Phone (390)"): the grab handle, the
 * resource line with Sheet, the tabs Hand / Attack / Dice / Feed and the open tab's body. Every tab reuses the HUD's own
 * part: Hand is `HudHand` (H2.3, laid out as a scrolling row here; Roll options, vault and Hide cards come with it),
 * Attack opens H3.2's picker (`useAttackPicker`), Dice is the app's dice box (`HudDice`, as the classic map's), Feed is
 * H4.3's "Just now". The open tab again, or the handle, folds the sheet to its resource line and tabs. It starts
 * folded, so the map (and your token under the sheet) stays reachable until a tab is tapped.
 */
export function PhoneSheet({ state, mapId }: HudPartProps & { mapId: Id<"combatMaps"> }) {
  const [tab, setTab] = useState<PhoneTab>("hand");
  const [open, setOpen] = useState(false);
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const party = useQuery(api.combatHud.party, { campaignId: state.campaignId, mapId });
  const mine = party?.find((m) => m.mine) ?? null;

  function choose(next: PhoneTab) {
    if (open && tab === next) setOpen(false);
    else {
      setTab(next);
      setOpen(true);
    }
  }

  // The tablist's arrow keys (WAI-ARIA tabs): Left / Right / Home / End move and select.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = PHONE_TABS.findIndex((t) => t.key === tab);
    const to =
      event.key === "ArrowRight" ? (at + 1) % PHONE_TABS.length : event.key === "ArrowLeft" ? (at - 1 + PHONE_TABS.length) % PHONE_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? PHONE_TABS.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    const next = PHONE_TABS[to]!.key;
    setTab(next);
    setOpen(true);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  }

  return (
    <section className="hud-ph-bs" data-open={open} aria-label="Your actions" data-testid="hud-phone-sheet">
      <button
        type="button"
        className="hud-ph-handle"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={open ? "Fold the actions down" : "Show the actions"}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true" />
      </button>
      <div className="hud-ph-res">
        {party === undefined ? (
          <p role="status" className="hud-ph-muted">
            Loading your sheet…
          </p>
        ) : mine ? (
          <Resources member={mine} />
        ) : (
          <p className="hud-ph-muted">Your character isn’t on this map.</p>
        )}
      </div>
      <div ref={tabsRef} className="hud-ph-tabs" role="tablist" aria-label="Combat actions" onKeyDown={onKeyDown}>
        {PHONE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${id}-${t.key}`}
            data-tab={t.key}
            aria-selected={tab === t.key}
            aria-controls={open && tab === t.key ? `${id}-panel` : undefined}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => choose(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {open ? (
        <div className={cn("hud-ph-body", `hud-ph-body-${tab}`)} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} data-testid={`hud-phone-tab-${tab}`}>
          <TabBody tab={tab} state={state} characterId={mine?.characterId ?? null} />
        </div>
      ) : null}
    </section>
  );
}

const ICONS: Record<ResourceItem["kind"], ReactNode> = {
  hp: <path d="M8 14s-5.5-3.3-5.5-7.2A3 3 0 0 1 8 4.6a3 3 0 0 1 5.5 2.2C13.5 10.7 8 14 8 14z" />,
  stress: <path d="M8 1.5l1.3 3.2 3.4-.9-1.6 3.1 2.9 2-3.5.4.3 3.5L8 10.6l-2.8 2.2.3-3.5-3.5-.4 2.9-2-1.6-3.1 3.4.9z" />,
  hope: <path d="M8 .8l1.9 4.4 4.7.4-3.6 3.1 1.1 4.6L8 10.9l-4.1 2.4L5 8.7 1.4 5.6l4.7-.4z" />,
  armor: <path d="M8 1.5l5 2v4c0 3.2-2.2 5.6-5 6.9-2.8-1.3-5-3.7-5-6.9v-4z" />,
};

/** The resource line (PlayerPhone `.mres`): HP, Stress, Hope, Armor, and Sheet (your sheet, full screen). */
function Resources({ member }: { member: HudPartyMember }) {
  const { sheet, toggleSheet } = useHud();
  const target: HudSheetTarget = { kind: "pc", characterId: member.characterId };
  return (
    <>
      <ul className="hud-ph-mres" aria-label={`${member.name}’s resources`} data-testid="hud-phone-resources">
        {resourceItems(member).map((item) => (
          <li key={item.kind} className={`hud-ph-m-${item.kind}`} aria-label={item.label}>
            <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
              {ICONS[item.kind]}
            </svg>
            <span aria-hidden="true">{item.text}</span>
          </li>
        ))}
      </ul>
      <button type="button" className={cn(hudButtonClass("tool"), "hud-ph-sheet-btn")} aria-pressed={sameSheet(sheet, target)} data-testid="hud-phone-sheet-button" onClick={() => toggleSheet(target)}>
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 5h5M5.5 8h5M5.5 11h3" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        Sheet
      </button>
    </>
  );
}

function TabBody({ tab, state, characterId }: { tab: PhoneTab; state: HudPartProps["state"]; characterId: Id<"characters"> | null }) {
  switch (tab) {
    case "hand":
      return (
        <PartBoundary label="The hand">
          <HudHand state={state} />
        </PartBoundary>
      );
    case "attack":
      return (
        <PartBoundary label="Attack">
          <AttackTab state={state} />
        </PartBoundary>
      );
    case "dice":
      return (
        <PartBoundary label="The dice box">
          <HudDice campaignId={state.campaignId} characterId={characterId} gm={false} />
        </PartBoundary>
      );
    case "feed":
      return (
        <PartBoundary label="The feed">
          <HudFeed state={state} />
        </PartBoundary>
      );
  }
}

/**
 * The Attack tab: H3.2's weapon attack picker (`useAttackPicker`). "Weapon attack" opens the picking panel (weapon
 * tiles, roll chips, riders), which takes the bottom of the screen while it is open; a forced attack waiting on you
 * opens with its target locked. Disabled with the picker's reason while it loads or without a weapon.
 */
function AttackTab({ state }: HudPartProps) {
  const attack = useAttackPicker(state);
  return (
    <div className="hud-ph-attack">
      <button type="button" className={hudButtonClass("primary")} disabled={!attack.ready} aria-describedby={attack.reason ? "hud-ph-attack-why" : undefined} data-testid="hud-phone-attack" onClick={() => attack.open()}>
        Weapon attack
      </button>
      {attack.reason ? (
        <p id="hud-ph-attack-why" className="hud-ph-muted">
          {attack.reason}
        </p>
      ) : (
        <p className="hud-ph-muted">Pick the weapon, your target and any riders, then roll.</p>
      )}
      {attack.forced.length > 0 ? (
        <ul className="hud-ph-forced" aria-label="Forced attacks">
          {attack.forced.map((f) => (
            <li key={f.requestId}>
              <button type="button" className={hudButtonClass()} disabled={!attack.ready} onClick={() => attack.open({ forcedRequestId: f.requestId })}>
                {f.feature}: attack {f.targets.map((t) => t.name).join(", ")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
