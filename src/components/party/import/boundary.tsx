"use client";

import { Component, type ReactNode } from "react";

/** Keeps a failing photo-import query from blanking the party page (CL1). */
export class ImportBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="m-0 text-[14px] text-danger">
          Photo import failed to load. Reload the page to try again.
        </p>
      );
    }
    return this.props.children;
  }
}
