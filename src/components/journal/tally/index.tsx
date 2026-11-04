"use client";

import type { SessionTallyProps, SpotlightProps } from "../slots";

/** Session tally and Spotlight (JT, contract: ../slots.ts; GM only). J1 stubs: render nothing until JT lands. */

/** The six tally tiles. */
export const SessionTally: (props: SessionTallyProps) => React.ReactNode = () => null;

/** A spotlight bar per PC, Reset, the least-spotlight line. */
export const Spotlight: (props: SpotlightProps) => React.ReactNode = () => null;
