// The ten domains and their banner colours, without the domain card list (CL9: routes that only need a domain's
// name or colour, such as the dashboard party cards, should not pull the 93 KB DOMAIN_CARDS).
// Extracted verbatim from the Party design board (reference/designs/project/Party.dc.html).
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { DomainDef } from "./types";

export const DOMAINS: readonly DomainDef[] = [
  {
    id: "arcana",
    name: "Arcana",
    color: "#5b3a8c",
    source: "core"
  },
  {
    id: "blade",
    name: "Blade",
    color: "#a3262a",
    source: "core"
  },
  {
    id: "bone",
    name: "Bone",
    color: "#6b6560",
    source: "core"
  },
  {
    id: "codex",
    name: "Codex",
    color: "#2a5a9e",
    source: "core"
  },
  {
    id: "grace",
    name: "Grace",
    color: "#b0367c",
    source: "core"
  },
  {
    id: "midnight",
    name: "Midnight",
    color: "#24203a",
    source: "core"
  },
  {
    id: "sage",
    name: "Sage",
    color: "#2f7d3c",
    source: "core"
  },
  {
    id: "splendor",
    name: "Splendor",
    color: "#b8860f",
    source: "core"
  },
  {
    id: "valor",
    name: "Valor",
    color: "#c45a14",
    source: "core"
  },
  {
    id: "dread",
    name: "Dread",
    color: "#2c4d52",
    source: "hope-and-fear"
  }
];
