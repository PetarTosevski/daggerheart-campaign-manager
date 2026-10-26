"use client";

import "../combat-map.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, useEffect, type ReactNode } from "react";

import { PacksScreen } from "@/components/combat-map/packs";

import { useCampaign } from "../../campaign-shell";

/**
 * Sprite packs (plan `.omc/plans/sprite-packs.yaml`): the GM's upload and labelling screen. P0 owns this route
 * shell (header, back link, error boundary, player redirect); the body is P8's `PacksScreen` slot
 * (src/components/combat-map/packs). GM only: a player is sent back to the Combat Map (UX only, CF22; every pack
 * function refuses players on the server, D10).
 */

/** Keeps a failing slot from blanking the page (CL1); "Try again" remounts it. */
class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
  state: { failed: boolean; message: string } = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="cm-alert">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <button type="button" className="cm-btn cm-sm" onClick={() => this.setState({ failed: false, message: "" })}>
          Try again
        </button>
      </div>
    );
  }
}

/** A player landed here: back to the Combat Map (navigation only, no data request). */
function PlayerRedirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return (
    <main className="cm-main cm-solo">
      <p role="status" className="cm-muted">
        Only the GM manages sprite packs. <Link href={href}>Back to the Combat Map</Link>
      </p>
    </main>
  );
}

export default function SpritePacksPage() {
  const campaign = useCampaign();
  const back = `/campaigns/${campaign._id}/combat-map`;
  if (campaign.role !== "gm") {
    return (
      <div className="cm-root" data-role="player">
        <title>{`Combat Map · ${campaign.name}`}</title>
        <PlayerRedirect href={back} />
      </div>
    );
  }
  return (
    <div className="cm-root" data-role="gm">
      <title>{`Sprite packs · ${campaign.name}`}</title>
      <header className="cm-head">
        <div className="cm-head-text">
          <div className="cm-campaign">{campaign.name}</div>
          <h1 className="cm-title">Sprite packs</h1>
        </div>
        <div className="cm-head-tools">
          <Link className="cm-btn" href={back}>
            ← Combat Map
          </Link>
        </div>
      </header>
      <main className="cm-main cm-solo">
        <SlotBoundary label="Sprite packs">
          <PacksScreen campaignId={campaign._id} />
        </SlotBoundary>
      </main>
    </div>
  );
}
