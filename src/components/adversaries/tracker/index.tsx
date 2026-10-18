import type { ReactNode } from "react";

import type { TrackerProps } from "../slots";

/** Stub slot of the Adversaries page (D8 A0); tracer A4 replaces it with the live encounter tracker. */
export const EncounterTracker: (props: TrackerProps) => ReactNode = () => <p className="adv-stub">The live encounter tracker arrives with the next update.</p>;
