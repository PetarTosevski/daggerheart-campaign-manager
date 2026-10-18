import type { ReactNode } from "react";

import type { CatalogueProps } from "../slots";

/** Stub slot of the Adversaries page (D8 A0); tracer A2 replaces it with the catalogue browser. */
export const Catalogue: (props: CatalogueProps) => ReactNode = () => <p className="adv-stub">The adversary catalogue arrives with the next update.</p>;
