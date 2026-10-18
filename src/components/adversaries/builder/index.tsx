import type { ReactNode } from "react";

import type { BuilderProps } from "../slots";

/** Stub slot of the Adversaries page (D8 A0); tracer A3 replaces it with the encounters and the Battle Points builder. */
export const EncounterBuilder: (props: BuilderProps) => ReactNode = () => <p className="adv-stub">Encounters and the Battle Points budget arrive with the next update.</p>;
