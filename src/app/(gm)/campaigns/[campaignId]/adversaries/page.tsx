"use client";

import "./adversaries.css";

import { useQuery } from "convex/react";
import { Component, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { AddToEncounter, EncounterBuilder } from "@/components/adversaries/builder";
import { Catalogue } from "@/components/adversaries/catalogue";
import { CustomAdversaries, DuplicateAdversary } from "@/components/adversaries/custom";
import { EnvironmentCatalogue } from "@/components/adversaries/environments";
import { OpenedAdversary } from "@/components/adversaries/environments/opened-adversary";
import type { CatalogueEntryRef } from "@/components/adversaries/slots";
import { EncounterTracker } from "@/components/adversaries/tracker";
import { countLine } from "@/lib/adversaries/catalogue";
import { adversariesFor } from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";

import { api } from "../../../../../../convex/_generated/api";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useCampaign } from "../campaign-shell";

const TABS = [
  { id: "catalogue", label: "Catalogue" },
  { id: "encounters", label: "Encounters" },
  { id: "environment", label: "Environment" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** An adversary opened from an environment's Potential Adversaries (EV1), shown at the top of the Catalogue tab. */
type OpenedFromEnvironment = { adversaryId: string; environmentId: string; environmentName: string };

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

/**
 * Catalogue tab: the SRD catalogue, whose stat blocks get "Add to encounter" (A3) and "Duplicate & edit" (A5), and
 * the campaign's custom adversaries below it; a saved duplicate is selected there.
 */
function CatalogueTab({
  campaign,
  opened,
  onBack,
  onClose,
}: {
  campaign: CampaignSummary;
  opened: OpenedFromEnvironment | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const [selectedCustom, setSelectedCustom] = useState<string | null>(null);
  const renderActions = (a: CatalogueEntryRef) => (
    <>
      <AddToEncounter campaignId={campaign._id} adversary={a} />
      <DuplicateAdversary campaignId={campaign._id} adversary={a} onSaved={setSelectedCustom} />
    </>
  );
  return (
    <>
      {opened ? (
        <OpenedAdversary
          adversaryId={opened.adversaryId}
          fromEnvironment={opened.environmentName}
          renderActions={renderActions}
          onBack={onBack}
          onClose={onClose}
        />
      ) : null}
      <SlotBoundary label="The catalogue">
        <Catalogue campaignId={campaign._id} hopeAndFear={campaign.options.hopeAndFear} frameId={campaign.frameId} renderActions={renderActions} />
      </SlotBoundary>
      <SlotBoundary label="Custom adversaries">
        <CustomAdversaries campaignId={campaign._id} selectedId={selectedCustom} onSelect={setSelectedCustom} />
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
  const [opened, setOpened] = useState<OpenedFromEnvironment | null>(null);
  // The selected environment lives here so it survives a tab switch ("Back to ..." from an opened adversary).
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const { hopeAndFear } = campaign.options;
  // The catalogue's size, as the board's header line (A2's count line, in place of A0's placeholder).
  const count = useMemo(() => {
    const visible = adversariesFor(ADVERSARIES, { hopeAndFear, frameId: campaign.frameId });
    return countLine(visible, visible.length);
  }, [hopeAndFear, campaign.frameId]);
  const blurb = campaign.options.hopeAndFear
    ? "Adversary and environment stat blocks from the Core Rulebook and Hope & Fear, with encounters and their Battle Points. Only you can see this page."
    : "Adversary and environment stat blocks from the Core Rulebook, with encounters and their Battle Points. Only you can see this page.";
  return (
    <>
      <header className="adv-top">
        <div className="adv-bar">
          <div>
            <h1 className="adv-title">Adversaries</h1>
            <div className="adv-count">{count}</div>
          </div>
          <p className="adv-blurb">{blurb}</p>
        </div>
      </header>
      <main className="adv-main">
        <AdversaryTabs tab={tab} onTab={setTab} />
        <section role="tabpanel" id={`adv-panel-${tab}`} aria-labelledby={`adv-tab-${tab}`} tabIndex={0} className="adv-panel">
          {tab === "catalogue" ? (
            <CatalogueTab
              campaign={campaign}
              opened={opened}
              onBack={() => {
                setOpened(null);
                setTab("environment");
              }}
              onClose={() => setOpened(null)}
            />
          ) : tab === "encounters" ? (
            <EncountersTab campaign={campaign} />
          ) : (
            <SlotBoundary label="Environments">
              <EnvironmentCatalogue
                hopeAndFear={hopeAndFear}
                frameId={campaign.frameId}
                selectedId={environmentId}
                onSelect={setEnvironmentId}
                onOpenAdversary={(adversaryId, environment) => {
                  setOpened({ adversaryId, environmentId: environment.id, environmentName: environment.name });
                  setTab("catalogue");
                }}
              />
            </SlotBoundary>
          )}
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
