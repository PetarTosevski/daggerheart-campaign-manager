"use client";

import { Component, type ReactNode } from "react";

/** Keeps a failing features query from blanking the sheet (CL1). */
export class FeatureBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="cs-small italic">
          The features panel could not load. Reload the page to try again.
        </p>
      );
    }
    return this.props.children;
  }
}
