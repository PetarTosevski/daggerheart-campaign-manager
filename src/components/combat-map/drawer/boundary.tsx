"use client";

import { Component, type ReactNode } from "react";

import { BrandButton } from "@/components/brand/buttons";

/** Keeps a failing `useQuery` inside the drawer (a refused or thrown read) from blanking the page (rule 11); "Try again" remounts it. */
export class DrawerBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
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
      <div role="alert" className="sd-error sd-boundary">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <BrandButton variant="neutral" size="sm" onClick={() => this.setState({ failed: false, message: "" })}>
          Try again
        </BrandButton>
      </div>
    );
  }
}
