// Error boundaries (plan d12-hardening H4, rule 11 / CL1): every route segment has an error.tsx, the root has a
// global-error.tsx with its own html and body, and the shared route-error body shows the mapped reason and a retry.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useParams: () => ({ campaignId: "camp1" }) }));

const { CampaignRouteError, RouteError } = await import("@/components/route-error");

afterEach(cleanup);

const APP = join(process.cwd(), "src", "app");

/** Every directory under src/app that holds a page.tsx. */
function pageDirs(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...pageDirs(path));
    else if (name === "page.tsx") found.push(dir);
  }
  return found;
}

describe("route segments", () => {
  it("every directory holding a page.tsx also holds an error.tsx", () => {
    const dirs = pageDirs(APP);
    expect(dirs.length).toBeGreaterThan(10);
    const missing = dirs.filter((dir) => !readdirSync(dir).includes("error.tsx")).map((dir) => relative(APP, dir) || ".");
    expect(missing).toEqual([]);
  });

  it("src/app/global-error.tsx exists, is a client component and renders its own html and body", () => {
    const source = readFileSync(join(APP, "global-error.tsx"), "utf8");
    expect(source.startsWith('"use client";')).toBe(true);
    expect(source).toMatch(/<html[\s>]/);
    expect(source).toMatch(/<body[\s>]/);
  });
});

describe("RouteError", () => {
  it("shows the mapped ConvexError reason in an alert, no stack, and Try again calls retry", () => {
    const retry = vi.fn();
    const error = new ConvexError({ code: "NOT_FOUND" });
    error.stack = "Error: secret stack\n    at handler (convex/codex.ts:1:1)";
    render(<RouteError error={error} retry={retry} title="The Party" what="The party failed to load." />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The party failed to load.");
    expect(alert.textContent).toContain("That no longer exists.");
    expect(document.body.textContent).not.toContain("secret stack");
    expect(screen.getByRole("heading", { name: "The Party" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Back to the main menu" }).getAttribute("href")).toBe("/");
  });

  it("a plain error shows the generic message, not its own text", () => {
    render(<RouteError error={new Error("TypeError: x is undefined")} retry={() => undefined} title="World" what="The world map failed to load." />);
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong. Check your connection and try again.");
    expect(document.body.textContent).not.toContain("x is undefined");
  });

  it("the campaign variant links back to the campaign dashboard", () => {
    render(<CampaignRouteError error={new Error("boom")} retry={() => undefined} title="Characters & Locations" what="The codex failed to load." />);
    expect(screen.getByRole("link", { name: "Back to the dashboard" }).getAttribute("href")).toBe("/campaigns/camp1");
  });
});
