"use client";

import { Component, type ReactNode } from "react";

/** Keeps one failing part of the adversary controls (a `useQuery` that throws, rule 11) from taking the rest down. */
export class PartBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="cm-alert">
        <span>{this.props.label} failed to load.</span>
        <button type="button" className="cm-btn cm-sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
