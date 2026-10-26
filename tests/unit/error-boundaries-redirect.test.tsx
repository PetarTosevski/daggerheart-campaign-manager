// dcm-bxp.131 (plan followups-6, tracer G1): the six campaign error.tsx files that render their own body instead of
// RouteError also send an ended session to sign-in and back (B5, src/lib/auth/use-session-ended-redirect.ts). Every
// other error keeps the page's own alert and 'Try again'.
import type { ComponentType } from "react";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/campaigns/camp1", replace: vi.fn() }));
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => undefined) }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ campaignId: "camp1" }),
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace }),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn(), signOut: auth.signOut }),
}));

type ErrorPage = ComponentType<{ error: Error & { digest?: string }; retry: () => void }>;

const PAGES: { segment: string; load: () => Promise<{ default: ErrorPage }>; failed: string }[] = [
  { segment: "notes", load: () => import("@/app/(gm)/campaigns/[campaignId]/notes/error"), failed: "The notes failed to load." },
  {
    segment: "combat-map",
    load: () => import("@/app/(gm)/campaigns/[campaignId]/combat-map/error"),
    failed: "The combat map failed to load.",
  },
  {
    segment: "combat-map/packs",
    load: () => import("@/app/(gm)/campaigns/[campaignId]/combat-map/packs/error"),
    failed: "The sprite packs failed to load.",
  },
  {
    segment: "lorekeeper",
    load: () => import("@/app/(gm)/campaigns/[campaignId]/lorekeeper/error"),
    failed: "The Lorekeeper failed to load.",
  },
  {
    segment: "sessions",
    load: () => import("@/app/(gm)/campaigns/[campaignId]/sessions/error"),
    failed: "The sessions failed to load.",
  },
  {
    segment: "adversaries",
    load: () => import("@/app/(gm)/campaigns/[campaignId]/adversaries/error"),
    failed: "Adversaries failed to load.",
  },
];

afterEach(() => {
  cleanup();
  nav.pathname = "/campaigns/camp1";
  nav.replace.mockReset();
  auth.signOut.mockClear();
  window.history.replaceState(null, "", "/");
});

describe.each(PAGES)("$segment error.tsx", ({ segment, load, failed }) => {
  const path = `/campaigns/camp1/${segment}`;

  it("an ended session signs out, shows the status and goes to /signin?next=<path + search>", async () => {
    const { default: Page } = await load();
    nav.pathname = path;
    window.history.replaceState(null, "", `${path}?from=g1`);
    render(<Page error={new ConvexError({ code: "UNAUTHENTICATED" })} retry={() => undefined} />);

    expect(screen.getByRole("status").textContent).toContain("Your session ended");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(nav.replace.mock.invocationCallOrder[0]);
    expect(nav.replace).toHaveBeenCalledWith(`/signin?next=${encodeURIComponent(`${path}?from=g1`)}`);
  });

  it("other errors keep the page's alert and retry, and do not sign out", async () => {
    const { default: Page } = await load();
    nav.pathname = path;
    window.history.replaceState(null, "", path);
    const retry = vi.fn();
    render(<Page error={new ConvexError({ code: "FORBIDDEN" })} retry={retry} />);

    expect(screen.getByRole("alert").textContent).toContain(failed);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(nav.replace).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
