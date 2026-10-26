"use client";

import { Component, type ReactNode } from "react";

/** Keeps a failing death-move query from blanking the sheet (CL1): shows one line instead. */
export class DeathBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="m-0 text-[14px] italic">
          Death moves couldn&apos;t load. Reload the page to try again.
        </p>
      );
    }
    return this.props.children;
  }
}
