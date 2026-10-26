"use client";

import { Component, type ReactNode } from "react";

/** Keeps a failing `useQuery` from blanking the page (CL1): renders `fallback` instead. Shared by the session and Wither slots. */
export class SlotBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
