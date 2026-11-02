"use client";

import { Component, type ReactNode } from "react";

/**
 * Keeps a failing HUD part (a `useQuery` that throws) from blanking the map (CL1), like the classic page's
 * SlotBoundary: an alert with the part's name and "Try again", which remounts it. Every HUD region mounts its part in
 * one of these.
 */
export class PartBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
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
      <div role="alert" className="hud-alert">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <button type="button" className="hud-btn" onClick={() => this.setState({ failed: false, message: "" })}>
          Try again
        </button>
      </div>
    );
  }
}
