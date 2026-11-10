import { afterEach } from "@jest/globals";

import type { FakeConvex } from "./fake-convex";

let current: FakeConvex | null = null;

export function setActiveClient(client: FakeConvex | null): void {
  current = client;
}

export function hasActiveClient(): boolean {
  return current !== null;
}

export function activeClient(): FakeConvex {
  if (current === null) {
    throw new Error("No fake Convex client. Render with renderAsPlayer or renderAsGm.");
  }
  return current;
}

afterEach(() => {
  const errors = current?.fixtureErrors ?? [];
  current = null;
  if (errors.length > 0) throw new Error(errors.join("\n"));
});
