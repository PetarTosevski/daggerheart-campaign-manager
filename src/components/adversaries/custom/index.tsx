import type { ReactNode } from "react";

import type { CustomProps } from "../slots";

/** Stub slot of the Adversaries page (D8 A0); tracer A5 replaces it with the campaign's custom adversaries. */
export const CustomAdversaries: (props: CustomProps) => ReactNode = () => <p className="adv-stub">Custom adversaries arrive with the next update.</p>;
