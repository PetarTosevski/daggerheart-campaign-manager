"use client";

import { Component, type ReactNode } from "react";

import type { CharacterSlot } from "../slots";
import { LunarPhasesSection } from "./section";

// Lunar Phases on the character sheet (plan session-features F3, U6), mounted on page one right after the Class
// Features box. Renders nothing unless the character holds Lunar Phases (Moon Witch with the mastery, Hope & Fear on).

/** Keeps a failing Lunar Phases box from blanking the sheet (CL1). */
class LunarBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="sh-small italic">
          The Lunar Phases box could not load. Reload the page to try again.
        </p>
      );
    }
    return this.props.children;
  }
}

export const LunarPhasesSlot: CharacterSlot = (props) => (
  <LunarBoundary>
    <LunarPhasesSection {...props} />
  </LunarBoundary>
);

export { MoonArt, MOON_NAMES } from "./moon-art";
