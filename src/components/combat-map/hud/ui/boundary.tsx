"use client";

import { Component, type ReactNode } from "react";

import { hudButtonClass } from "./popup";

/** Waits before each quiet retry of a failed HUD part (bead dcm-rzq2): 3 retries, then "Try again". */
export const PART_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;
/** A retried part that stays up this long has recovered: the next failure starts the retries afresh. */
export const PART_RETRY_STABLE_MS = 10_000;

type PartBoundaryState = { failed: boolean; message: string; attempts: number };

/**
 * Keeps a failing HUD part (a `useQuery` that throws) from blanking the map (CL1), like the classic page's
 * SlotBoundary. Every HUD region mounts its part in one of these. A failed load (under load a Convex query can time
 * out, bead dcm-uh6r) is retried by itself after 2, 5 and 10 s with a quiet "Loading…" meanwhile (user decision,
 * bead dcm-rzq2; the same approach as the incoming hit's `HitBoundary`); only when the third retry fails too does it
 * show an alert with the part's name and "Try again", which remounts it with fresh retries. Retrying remounts the
 * part: the boundary rendered the placeholder in its place, so its children mount afresh (no `key=`).
 */
export class PartBoundary extends Component<{ children: ReactNode; label: string }, PartBoundaryState> {
  state: PartBoundaryState = { failed: false, message: "", attempts: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
    this.clearTimer();
    const delay = PART_RETRY_DELAYS_MS[this.state.attempts];
    if (delay === undefined) return;
    this.timer = setTimeout(() => {
      this.setState((s) => ({ failed: false, message: "", attempts: s.attempts + 1 }));
      // No new failure for a while: recovered, so the retries start afresh next time.
      this.timer = setTimeout(() => {
        this.timer = null;
        this.setState({ attempts: 0 });
      }, PART_RETRY_STABLE_MS);
    }, delay);
  }

  componentWillUnmount() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private tryAgain = () => {
    this.clearTimer();
    this.setState({ failed: false, message: "", attempts: 0 });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    // Retrying quietly.
    if (this.state.attempts < PART_RETRY_DELAYS_MS.length) {
      return (
        <span role="status" className="hud-part-retry" data-testid="hud-part-retry">
          Loading…
        </span>
      );
    }
    return (
      <div role="alert" className="hud-alert">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <button type="button" className={hudButtonClass()} onClick={this.tryAgain}>
          Try again
        </button>
      </div>
    );
  }
}
