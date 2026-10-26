import { afterEach, beforeEach, vi } from "vitest";

import { runMatrix } from "./harness";
import area from "./lorekeeper-chat.entries";

// No key: `ask` answers LOREKEEPER_UNAVAILABLE past the access check and schedules no run; fetch fails loudly anyway.
let key: string | undefined;
beforeEach(() => {
  key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in the authz matrix")));
});
afterEach(() => {
  if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
  vi.unstubAllGlobals();
});

runMatrix(area);
