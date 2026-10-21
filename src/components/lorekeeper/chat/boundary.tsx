"use client";

import { Component, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

/**
 * An error boundary inside the chat (CL1) around a `useQuery` subtree that can fail on its own: the message list
 * (a conversation made private or deleted meanwhile) and the book page dialog. It shows the error's own message
 * (the D13 codes have user-facing text) and an action; key it on the subtree's identity so another pick remounts it.
 */
export class ChatBoundary extends Component<
  { children: ReactNode; label: string; action?: { label: string; run: () => void }; dark?: boolean },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("failed") };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    const { action } = this.props;
    return (
      <div role="alert" className="lk-alert">
        <span>{errorMessage(this.state.error)}</span>
        <button
          type="button"
          className="lk-act lk-act-dark"
          onClick={() => {
            this.setState({ error: null });
            action?.run();
          }}
        >
          {action?.label ?? "Try again"}
        </button>
      </div>
    );
  }
}
