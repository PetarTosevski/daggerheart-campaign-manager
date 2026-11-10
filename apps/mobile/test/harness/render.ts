import { render, type RenderResult } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { createFakeConvex, type FakeConvex, type FakeHandlers, type Role } from "./fake-convex";
import { setActiveClient } from "./session";

export type RenderedScreen = RenderResult & { client: FakeConvex };

/** Render `ui` against a fake Convex client. The client stays active until the test ends. */
export async function renderAs(
  role: Role,
  ui: ReactElement,
  handlers?: FakeHandlers,
): Promise<RenderedScreen> {
  const client = createFakeConvex(role, handlers);
  setActiveClient(client);
  const screen = await render(ui);
  return Object.assign(screen, { client });
}

export function renderAsPlayer(ui: ReactElement, handlers?: FakeHandlers): Promise<RenderedScreen> {
  return renderAs("player", ui, handlers);
}

export function renderAsGm(ui: ReactElement, handlers?: FakeHandlers): Promise<RenderedScreen> {
  return renderAs("gm", ui, handlers);
}
