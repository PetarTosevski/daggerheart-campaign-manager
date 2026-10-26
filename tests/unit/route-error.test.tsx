// Error boundaries (plan d12-hardening H4, rule 11 / CL1): every route segment has an error.tsx, the root has a
// global-error.tsx with its own html and body, and the shared route-error body shows the mapped reason and a retry.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/campaigns/camp1", replace: vi.fn() }));
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => undefined), withProvider: true }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ campaignId: "camp1" }),
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace }),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => (auth.withProvider ? { signIn: vi.fn(), signOut: auth.signOut } : undefined),
}));

const { CampaignRouteError, RouteError } = await import("@/components/route-error");

afterEach(() => {
  cleanup();
  nav.pathname = "/campaigns/camp1";
  nav.replace.mockReset();
  auth.signOut.mockClear();
  auth.withProvider = true;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

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

describe("a session that ended (B5)", () => {
  const ended = () => new ConvexError({ code: "UNAUTHENTICATED" });

  it("signs out locally, then replaces the URL with /signin?next=<path + search>, with a polite status meanwhile", async () => {
    nav.pathname = "/campaigns/camp1/party";
    window.history.replaceState(null, "", "/campaigns/camp1/party?tab=gear");
    render(<RouteError error={ended()} retry={() => undefined} title="The Party" what="The party failed to load." />);

    expect(screen.getByRole("status").textContent).toContain("Your session ended");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(nav.replace.mock.invocationCallOrder[0]);
    expect(nav.replace).toHaveBeenCalledWith(`/signin?next=${encodeURIComponent("/campaigns/camp1/party?tab=gear")}`);
  });

  it("the campaign variant redirects too", async () => {
    nav.pathname = "/campaigns/camp1/codex";
    window.history.replaceState(null, "", "/campaigns/camp1/codex");
    render(<CampaignRouteError error={ended()} retry={() => undefined} title="Codex" what="The codex failed to load." />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/signin?next=%2Fcampaigns%2Fcamp1%2Fcodex"));
  });

  it("never redirects from /signin: the error screen stays (no loop)", async () => {
    nav.pathname = "/signin";
    window.history.replaceState(null, "", "/signin?next=%2Fcampaigns%2Fcamp1");
    render(<RouteError error={ended()} retry={() => undefined} title="Sign in" what="The sign-in page failed to load." />);
    expect(screen.getByRole("alert").textContent).toContain("Your session has ended. Sign in again.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(nav.replace).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("other codes keep the error screen and do not sign out", async () => {
    window.history.replaceState(null, "", "/campaigns/camp1");
    render(
      <RouteError error={new ConvexError({ code: "FORBIDDEN" })} retry={() => undefined} title="Dashboard" what="The dashboard failed to load." />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(nav.replace).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("outside the auth provider (global-error) it posts auth:signOut itself and erases the stored tokens", async () => {
    auth.withProvider = false;
    const fetchMock = vi.fn(async () => new Response("null"));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("__convexAuthJWT_x", "jwt");
    window.localStorage.setItem("__convexAuthRefreshToken_x", "dummy");
    window.localStorage.setItem("other", "kept");
    window.history.replaceState(null, "", "/campaigns/camp1");
    render(<RouteError error={ended()} retry={() => undefined} title="Something went wrong" what="The app failed to load." />);

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/signin?next=%2Fcampaigns%2Fcamp1"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "auth:signOut", args: {} }),
    });
    expect(window.localStorage.getItem("__convexAuthJWT_x")).toBeNull();
    expect(window.localStorage.getItem("__convexAuthRefreshToken_x")).toBeNull();
    expect(window.localStorage.getItem("other")).toBe("kept");
    window.localStorage.clear();
  });

  it("a failed sign-out still goes to sign-in", async () => {
    auth.signOut.mockRejectedValueOnce(new Error("offline"));
    window.history.replaceState(null, "", "/campaigns/camp1");
    render(<RouteError error={ended()} retry={() => undefined} title="Dashboard" what="The dashboard failed to load." />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/signin?next=%2Fcampaigns%2Fcamp1"));
  });
});
