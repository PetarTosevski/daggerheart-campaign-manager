"use client";

import "./lorekeeper.css";

import { Component, type ReactNode } from "react";

import { ConversationsMenu, LorekeeperChat } from "@/components/lorekeeper/chat";
import { IndexPill, LorekeeperSide } from "@/components/lorekeeper/side";
import { Sigil } from "@/components/lorekeeper/sigil";
import type { LorekeeperChatProps, LorekeeperSideProps } from "@/components/lorekeeper/slots";

import { useCampaign } from "../campaign-shell";

/**
 * The Lorekeeper (D13): the page shell of the board's `page` variant. L0 owns the layout and the chat header
 * frame; the sidebar, the chat body and the header pills are slots (contract: src/components/lorekeeper/slots.ts),
 * each in its own error boundary. GM and players get the same layout; the server decides what each reads.
 */

/** Keeps a failing slot (a `useQuery` that throws) from blanking the page (CL1); "Try again" remounts it. */
class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="lk-alert">
        <span>{this.props.label} failed to load.</span>
        <button type="button" className="lk-act lk-act-dark" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

export default function LorekeeperPage() {
  const campaign = useCampaign();
  const access = { isGm: campaign.role === "gm" };
  const chat: LorekeeperChatProps = { campaignId: campaign._id, access, variant: "page" };
  const side: LorekeeperSideProps = { campaignId: campaign._id, access };
  return (
    <div className="lk-root" data-role={access.isGm ? "gm" : "player"}>
      <title>{`Lorekeeper · ${campaign.name}`}</title>
      <main className="lk-main">
        <aside className="lk-side" aria-label="Library and rulings">
          <SlotBoundary label="The library and rulings">
            <LorekeeperSide {...side} />
          </SlotBoundary>
        </aside>
        <section className="lk-chat" aria-label="The Lorekeeper">
          <header className="lk-chathead">
            <Sigil />
            <div className="lk-chathead-text">
              <h1 className="lk-name">The Lorekeeper</h1>
              <span className="lk-muted">Keeper of your rulebooks · answers rule questions</span>
            </div>
            <div className="lk-chathead-slots">
              <SlotBoundary label="The book count">
                <IndexPill {...side} />
              </SlotBoundary>
              <SlotBoundary label="Conversations">
                <ConversationsMenu {...chat} />
              </SlotBoundary>
            </div>
          </header>
          <div className="lk-body">
            <SlotBoundary label="The conversation">
              <LorekeeperChat {...chat} />
            </SlotBoundary>
          </div>
        </section>
      </main>
    </div>
  );
}
