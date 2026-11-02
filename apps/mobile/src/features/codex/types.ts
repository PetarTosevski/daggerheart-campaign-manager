import type { FunctionReturnType } from "convex/server";

import type { GmEntry, PlayerEntry } from "../../../../../src/lib/codex/view";

import { api } from "../../convex";

export type CodexList = FunctionReturnType<typeof api.codex.list>;
export type CodexText = FunctionReturnType<typeof api.codex.entryText>;

export type CodexPin = {
  id: number;
  name: string;
  x: number;
  y: number;
  hidden: boolean;
  type: string;
};

export type AnyEntry = GmEntry | PlayerEntry;

export function isGmList(data: CodexList | undefined): data is Extract<CodexList, { role: "gm" }> {
  return data?.role === "gm";
}

export function isGmEntry(entry: AnyEntry, gm: boolean): entry is GmEntry {
  return gm && "known" in entry;
}
