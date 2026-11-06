import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex";

export {
  isGmEntry,
  isGmList,
  type AnyEntry,
  type CodexList,
  type CodexPin,
} from "../../../../../src/lib/codex/list-model";

export type CodexText = FunctionReturnType<typeof api.codex.entryText>;
