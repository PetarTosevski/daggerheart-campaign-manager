"use client";

import type { AfterSessionProps, RecapProps } from "../slots";

/** Recap and After the session (JR, contract: ../slots.ts). J1 stubs: render nothing until JR lands. */

/** Centre, under the log: the recap parchment. */
export const Recap: (props: RecapProps) => React.ReactNode = () => null;

/** Right column, last: 'After the session' (level-ups, loot). */
export const AfterSession: (props: AfterSessionProps) => React.ReactNode = () => null;
