"use client";

import "./adversaries.css";

import { useQuery } from "convex/react";
import { Component, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { AddToEncounter, EncounterBuilder } from "@/components/adversaries/builder";
import { Catalogue } from "@/components/adversaries/catalogue";
import { CustomAdversaries } from "@/components/adversaries/custom";
import { EncounterTracker } from "@/components/adversaries/tracker";

import { api } from "../../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useCampaign } from "../campaign-shell";

const TABS = [
  { id: "catalogue", label: "Catalogue" },
  { id: "encounters", label: "Encounters" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Keeps a failing slot (a `useQuery` that throws) from blanking the page (CL1); "Try again" remounts it. */
class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="adv-alert">
        <span>{this.props.label} failed to load.</span>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

/** Stat block head actions: empty until the encounter builder (A3) adds "Add to encounter". */

function CatalogueTab({ campaign }: { campaign: CampaignSummary }) {
  return (
    <>
      <SlotBoundary label="The catalogue">
        <Catalogue campaignId={campaign._id} hopeAndFear={campaign.options.hopeAndFear} frameId={campaign.frameId} renderActions={(a) => <AddToEncounter campaignId={campaign._id} adversary={a} />} />
      </SlotBoundary>
      <SlotBoundary label="Custom adversaries">
        <CustomAdversaries campaignId={campaign._id} />
      </SlotBoundary>
    </>
  );
}

function Builder({ campaignId, onOpenEncounter }: { campaignId: Id<"campaigns">; onOpenEncounter: (id: string) => void }) {
  const party = useQuery(api.characters.listByCampaign, { campaignId });
  if (party === undefined) {
    return (
      <p role="status" className="adv-count">
        Loading the party…
      </p>
    );
  }
  const activePcs = party.filter((c) => c.status === "active").length;
  return <EncounterBuilder campaignId={campaignId} activePcs={activePcs} onOpenEncounter={onOpenEncounter} />;
}

function EncountersTab({ campaign }: { campaign: CampaignSummary }) {
  const [openEncounter, setOpenEncounter] = useState<string | null>(null);
  return (
    <>
      <SlotBoundary label="Encounters">
        <Builder campaignId={campaign._id} onOpenEncounter={setOpenEncounter} />
      </SlotBoundary>
      <SlotBoundary label="The encounter tracker">
        <EncounterTracker campaignId={campaign._id} encounterId={openEncounter} fear={campaign.fear} />
      </SlotBoundary>
    </>
  );
}

/** Tabs in the WAI-ARIA pattern: arrow keys, Home and End move between them and select. */
function AdversaryTabs({ tab, onTab }: { tab: TabId; onTab: (tab: TabId) => void }) {
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      event.key === "ArrowRight" ? (i + 1) % TABS.length
      : event.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length
      : event.key === "Home" ? 0
      : event.key === "End" ? TABS.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    const id = TABS[next]!.id;
    onTab(id);
    refs.current[id]?.focus();
  }
  return (
    <div role="tablist" aria-label="Adversary views" className="adv-tabs" onKeyDown={onKeyDown}>
      {TABS.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[t.id] = el;
          }}
          type="button"
          role="tab"
          id={`adv-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`adv-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          className="adv-tab"
          onClick={() => onTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function GmAdversaries({ campaign }: { campaign: CampaignSummary }) {
  const [tab, setTab] = useState<TabId>("catalogue");
  const blurb = campaign.options.hopeAndFear
    ? "Stat blocks from the Core Rulebook and Hope & Fear, with encounters and their Battle Points. Only you can see this page."
    : "Stat blocks from the Core Rulebook, with encounters and their Battle Points. Only you can see this page.";
  return (
    <>
      <header className="adv-top">
        <div className="adv-bar">
          <div>
            <h1 className="adv-title">Adversaries</h1>
            <div className="adv-count">{campaign.options.hopeAndFear ? "Core Rulebook and Hope & Fear" : "Core Rulebook"}</div>
          </div>
          <p className="adv-blurb">{blurb}</p>
        </div>
      </header>
      <main className="adv-main">
        <AdversaryTabs tab={tab} onTab={setTab} />
        <section role="tabpanel" id={`adv-panel-${tab}`} aria-labelledby={`adv-tab-${tab}`} tabIndex={0} className="adv-panel">
          {tab === "catalogue" ? <CatalogueTab campaign={campaign} /> : <EncountersTab campaign={campaign} />}
        </section>
      </main>
    </>
  );
}

/** Adversaries (D8): the SRD catalogue and the GM's encounters. GM-only; players get a panel and no data request. */
export default function AdversariesPage() {
  const campaign = useCampaign();
  return (
    <div className="adv-root">
      <title>Adversaries</title>
      {campaign.role === "gm" ? (
        <GmAdversaries campaign={campaign} />
      ) : (
        <main className="adv-main">
          <section aria-labelledby="adv-gm-only-h" className="adv-gm-only">
            <h1 id="adv-gm-only-h" className="adv-title">
              Adversaries
            </h1>
            <p>Only the GM can see adversaries and encounters.</p>
          </section>
        </main>
      )}
    </div>
  );
}
