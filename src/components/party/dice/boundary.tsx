"use client";

import { Component, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

type State = { error: unknown };

/** Keeps a failing dice query (CL1) from blanking the page: shows the error and a retry button. */
export class DiceBoundary extends Component<{ label: string; children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[#5b2b2b] p-4 text-[15px]">
        <span>
          {this.props.label} couldn’t load: {errorMessage(this.state.error)}
        </span>
        <button type="button" className="min-h-10 rounded-[9px] border border-current px-3" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    );
  }
}
