"use client";

import "../admin.css";

import { BookOpen, Check, ChevronLeft, Flag, LayoutGrid, Lock, Users, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, type ComponentType, type KeyboardEvent } from "react";

import { brandButton } from "@/components/brand/buttons";
import { SlotBoundary } from "@/components/party/session/boundary";

import { AccountsTab } from "../accounts";
import { FeatureSwitchesTab } from "../features";
import { LorekeeperTab } from "../lorekeeper";
import { MaintenanceTab } from "../maintenance";
import { OverviewTab } from "../overview";
import {
  ADMIN_KICKER,
  ADMIN_OWNER_BADGE,
  ADMIN_SAVED,
  ADMIN_SUB,
  ADMIN_TAB_PARAM,
  ADMIN_TABS,
  ADMIN_TITLE,
  adminTabUrl,
  NOT_ALLOWED_TEXT,
  NOT_ALLOWED_TITLE,
  parseAdminTab,
  type AdminTab,
  type AdminTabProps,
} from "../slots";
import { useAppOwner } from "./owner";

export { useAppOwner } from "./owner";

/**
 * App admin (plan config AD1, design reference/designs/config/Admin.dc.html): the owner gate, the header and the five
 * tabs. Contract and rules for the tabs: ../slots.ts.
 */

const TAB_SLOT: Record<AdminTab, ComponentType<AdminTabProps>> = {
  overview: OverviewTab,
  accounts: AccountsTab,
  lorekeeper: LorekeeperTab,
  features: FeatureSwitchesTab,
  maintenance: MaintenanceTab,
};

const TAB_ICON: Record<AdminTab, LucideIcon> = {
  overview: LayoutGrid,
  accounts: Users,
  lorekeeper: BookOpen,
  features: Flag,
  maintenance: Wrench,
};

const tabId = (tab: AdminTab) => `adm-tab-${tab}`;
const TAB_PANEL = "adm-tab-panel";

/** Arrow keys (both axes), Home and End move between the tabs (ARIA tabs); returns the target index or null. */
function nextTabIndex(key: string, index: number, count: number): number | null {
  if (key === "ArrowDown" || key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Rewrites `?tab=` in place: `history.replaceState` is synced by Next's router into `useSearchParams` without a server
 * round trip or a scroll jump, and adds no history entry. Every other param stays.
 */
function writeTab(tab: AdminTab) {
  const { pathname, search, hash } = window.location;
  const next = adminTabUrl(pathname, search, tab) + hash;
  if (next !== pathname + search + hash) window.history.replaceState(null, "", next);
}

/** A signed-in caller who isn't the app owner (Q17 changed): no admin text, no admin data, a way back. */
export function NotAllowed() {
  return (
    <main className="adm-denied">
      <title>{NOT_ALLOWED_TITLE}</title>
      <h1>{NOT_ALLOWED_TITLE}</h1>
      <p>{NOT_ALLOWED_TEXT}</p>
      <Link href="/" className={brandButton({ variant: "confirm", size: "lg" })}>
        Back to the main menu
      </Link>
    </main>
  );
}

function AdminHeader() {
  return (
    <section className="adm-h" aria-label="App admin header">
      <div className="adm-wrap adm-h-in">
        <div className="adm-top">
          <div className="adm-brand">
            <Link href="/" className={brandButton({ variant: "cancel", icon: true })} aria-label="Back to the main menu">
              <ChevronLeft aria-hidden="true" />
            </Link>
            <span className="adm-wm">DAGGERHEART</span>
          </div>
          <span className="adm-own">
            <Lock aria-hidden="true" />
            {ADMIN_OWNER_BADGE}
          </span>
        </div>
        <div className="adm-title">
          <div>
            <div className="adm-kick">{ADMIN_KICKER}</div>
            <h1>{ADMIN_TITLE}</h1>
            <p>{ADMIN_SUB}</p>
          </div>
          <span className="adm-saved">
            <Check aria-hidden="true" />
            {ADMIN_SAVED}
          </span>
        </div>
      </div>
    </section>
  );
}

function AdminTabs({ tab }: { tab: AdminTab }) {
  const refs = useRef<Partial<Record<AdminTab, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(event.key, ADMIN_TABS.findIndex((t) => t.id === tab), ADMIN_TABS.length);
    if (next === null) return;
    event.preventDefault();
    const target = ADMIN_TABS[next]!.id;
    writeTab(target);
    refs.current[target]?.focus();
  }
  return (
    <div role="tablist" aria-label="Admin sections" aria-orientation="vertical" className="adm-nav" onKeyDown={onKeyDown}>
      {ADMIN_TABS.map(({ id, label }) => {
        const Icon = TAB_ICON[id];
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id)}
            className="adm-sn"
            aria-selected={tab === id}
            aria-controls={TAB_PANEL}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => writeTab(id)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** The owner's page: the header, the tab list and the selected tab (only that one is mounted). */
export function AdminFrame() {
  const tab = parseAdminTab(useSearchParams().get(ADMIN_TAB_PARAM));
  const Slot = TAB_SLOT[tab];
  const label = ADMIN_TABS.find((t) => t.id === tab)!.label;
  return (
    <div className="adm-root">
      <title>{ADMIN_TITLE}</title>
      <AdminHeader />
      <main className="adm-wrap adm-grid">
        <AdminTabs tab={tab} />
        <div role="tabpanel" id={TAB_PANEL} aria-labelledby={tabId(tab)} className="adm-panel" tabIndex={0}>
          <SlotBoundary
            key={tab}
            fallback={
              <p role="alert" className="adm-failed">
                {label} failed to load. Reload the page to try again.
              </p>
            }
          >
            <Slot onTab={writeTab} />
          </SlotBoundary>
        </div>
      </main>
    </div>
  );
}

/**
 * `/admin`: the owner gets the admin frame; anyone else signed in gets 'Not allowed' and no tab ever mounts, so no
 * admin query runs for them. A cosmetic gate (CF22): the server refuses every admin function to a non-owner. Signed
 * out never reaches here (src/proxy.ts sends them to sign-in). `useSearchParams` needs the page's Suspense boundary.
 */
export function AdminShell() {
  const me = useAppOwner();
  if (me === undefined) {
    return (
      <main className="adm-denied">
        <p role="status" className="adm-muted">
          Loading…
        </p>
      </main>
    );
  }
  if (me === null || !me.isOwner) return <NotAllowed />;
  return <AdminFrame />;
}
