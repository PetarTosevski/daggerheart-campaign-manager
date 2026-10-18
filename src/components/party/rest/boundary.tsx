"use client";

import { Component, type ReactNode } from "react";

/** Keeps a failing rest query from blanking the page around it (CL1). */
export class RestBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="m-0 text-[14px] text-danger">
          The rest panel failed to load. Reload the page to try again.
        </p>
      );
    }
    return this.props.children;
  }
}
