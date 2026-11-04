"use client";

import "./app-bar.css";

import { useQuery } from "convex/react";
import { ChevronLeft, Maximize2, Minimize2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";
import { SigilIcon } from "@/components/lorekeeper/sigil";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CampaignSettingsButton, PreferencesButton } from "./account";
import { openLorekeeperDrawer, useLorekeeperDrawerState } from "./lorekeeper-store";
import { CampaignNav, LOREKEEPER_SLUG } from "./nav";

export { CampaignNav } from "./nav";
export { CampaignSettingsButton, PreferencesButton, PREFERENCES_LABEL, SETTINGS_LABEL } from "./account";

/*
 * The Combat Map's app bar (plan combat-hud H9.A; HANDOFF "App bar"; boards Main, GMDesktop, GMTablet, PlayerTablet).
 * User answers 2026-11-04: Q1 (a) the user's nav order and names with the design's look (36 px items, gold current
 * page, a live dot on Combat Map, the Lorekeeper as the gold pill on the right); Q2 (c) on the Combat Map only, plus a
 * full-screen button that hides the bar during play (back with the floating button or Escape); Q3 (c) the gear and
 * avatar as placeholders config S1 fills (./account.tsx).
 *
 * The frame sets `--app-bar-h` (56 px desktop, 52 px tablet, 0 on a phone or with the bar hidden) so the HUD can size
 * itself to the rest of the screen. A phone keeps the tall art header (`header`), as before.
 */

export const LOREKEEPER_PILL_LABEL = "Ask the Lorekeeper";
export const FULL_SCREEN_LABEL = "Full screen: hide the app bar";
export const SHOW_BAR_LABEL = "Show the app bar";

type Props = {
  campaignId: Id<"campaigns">;
  isGm: boolean;
  /** The art header the phone keeps. */
  header: ReactNode;
  /** GM: opens today's Players dialog (from the gear's menu). */
  onPlayers: () => void;
  children: ReactNode;
};

/** Whether the campaign has a live map: the same queries `useCurrentMap` subscribes to on this page (shared). */
function useLiveMap(campaignId: Id<"campaigns">, isGm: boolean): boolean {
  const maps = useQuery(api.combatMaps.list, isGm ? { campaignId } : "skip");
  const live = useQuery(api.combatMaps.live, isGm ? "skip" : { campaignId });
  return isGm ? (maps?.some((map) => map.live) ?? false) : live != null;
}

function LiveNav({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  return <CampaignNav campaignId={campaignId} isGm={isGm} variant="bar" liveMap={useLiveMap(campaignId, isGm)} />;
}

/**
 * The Lorekeeper pill (`.ab-lk`): opens the Lorekeeper drawer on this page. While the Lorekeeper's availability loads,
 * or on a deployment without it, it is a link to the Lorekeeper page instead, so the section is never out of reach.
 */
function LorekeeperPill({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const pathname = usePathname();
  const available = useQuery(api.lorekeeper.available, { campaignId });
  const { openAt } = useLorekeeperDrawerState();
  const ref = useRef<HTMLButtonElement>(null);
  const body = (
    <>
      <SigilIcon size={20} />
      <span className="ab-lk-text">Lorekeeper</span>
    </>
  );
  if (available !== true) {
    return (
      <Link href={`/campaigns/${campaignId}/${LOREKEEPER_SLUG}`} className="ab-lk" aria-label={LOREKEEPER_PILL_LABEL}>
        {body}
      </Link>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      className="ab-lk"
      aria-label={LOREKEEPER_PILL_LABEL}
      aria-haspopup="dialog"
      aria-expanded={openAt === pathname}
      onClick={() => openLorekeeperDrawer(pathname, ref.current)}
    >
      {body}
    </button>
  );
}

function LorekeeperLink({ campaignId }: { campaignId: Id<"campaigns"> }) {
  return (
    <Link href={`/campaigns/${campaignId}/${LOREKEEPER_SLUG}`} className="ab-lk" aria-label={LOREKEEPER_PILL_LABEL}>
      <SigilIcon size={20} />
      <span className="ab-lk-text">Lorekeeper</span>
    </Link>
  );
}

/** Asks the browser for full screen where it can (a hidden bar is the point; a refusal changes nothing). */
function enterBrowserFullScreen(): boolean {
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== "function" || document.fullscreenElement) return false;
  root.requestFullscreen().catch(() => undefined);
  return true;
}

function exitBrowserFullScreen() {
  if (document.fullscreenElement && typeof document.exitFullscreen === "function") document.exitFullscreen().catch(() => undefined);
}

/** An open modal dialog or popover takes Escape for itself. */
function somethingOpen(): boolean {
  if (document.querySelector("dialog[open]")) return true;
  try {
    return document.querySelector("[popover]:popover-open") !== null;
  } catch {
    return false; // a browser without :popover-open
  }
}

/**
 * The bar's hidden state (Q2 c). Hiding asks for browser full screen too; Escape (when no dialog is open) or leaving
 * browser full screen brings the bar back. Focus moves to the floating button on hide and back to the full-screen
 * button on show, so a keyboard user never lands on nothing.
 */
function useHiddenBar() {
  const [hidden, setHidden] = useState(false);
  const fullScreenButton = useRef<HTMLButtonElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const askedFullScreen = useRef(false);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (hidden ? showButton : fullScreenButton).current?.focus();
  }, [hidden]);

  useEffect(() => {
    if (!hidden) return;
    function show() {
      moveFocus.current = true;
      askedFullScreen.current = false;
      setHidden(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape closes an open dialog or popover first; the bar stays hidden for that press.
      if (somethingOpen()) return;
      exitBrowserFullScreen();
      show();
    }
    function onFullScreen() {
      if (askedFullScreen.current && !document.fullscreenElement) show();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullScreen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullScreen);
    };
  }, [hidden]);

  const hide = useCallback(() => {
    askedFullScreen.current = enterBrowserFullScreen();
    moveFocus.current = true;
    setHidden(true);
  }, []);
  const show = useCallback(() => {
    exitBrowserFullScreen();
    askedFullScreen.current = false;
    moveFocus.current = true;
    setHidden(false);
  }, []);
  return { hidden, hide, show, fullScreenButton, showButton };
}

/** The Combat Map's chrome: the app bar (tablet and desktop), the art header (phone) and the page under them. */
export function CombatAppBarFrame({ campaignId, isGm, header, onPlayers, children }: Props) {
  const { hidden, hide, show, fullScreenButton, showButton } = useHiddenBar();
  return (
    <div className="cab-frame" data-bar-hidden={hidden ? "" : undefined} data-testid="combat-app-frame">
      {hidden ? null : (
        <header className="abar" data-testid="app-bar">
          <Link href="/" className="ab-back" aria-label="Back to main menu">
            <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden="true" />
          </Link>
          <span className="ab-wm">DAGGERHEART</span>
          <SlotBoundary fallback={<CampaignNav campaignId={campaignId} isGm={isGm} variant="bar" />}>
            <LiveNav campaignId={campaignId} isGm={isGm} />
          </SlotBoundary>
          <span className="ab-r">
            <SlotBoundary fallback={<LorekeeperLink campaignId={campaignId} />}>
              <LorekeeperPill campaignId={campaignId} />
            </SlotBoundary>
            <button ref={fullScreenButton} type="button" className="ab-ic" aria-label={FULL_SCREEN_LABEL} onClick={hide}>
              <Maximize2 className="size-[17px]" strokeWidth={2} aria-hidden="true" />
            </button>
            {isGm ? <CampaignSettingsButton onPlayers={onPlayers} /> : null}
            <PreferencesButton campaignId={campaignId} isGm={isGm} />
          </span>
        </header>
      )}
      <div className="cab-phone-header">{header}</div>
      {hidden ? (
        <button ref={showButton} type="button" className="cab-show" aria-label={SHOW_BAR_LABEL} title={`${SHOW_BAR_LABEL} (Esc)`} onClick={show}>
          <Minimize2 className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
      {children}
    </div>
  );
}
