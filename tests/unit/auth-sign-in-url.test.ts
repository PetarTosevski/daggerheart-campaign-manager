// B5 (plan d12-bugs): the sign-in page rendered under another URL (after a failed refresh) keeps that URL as `next`.
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/signin" as string | null, replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace }),
}));

const { SignInUrl } = await import("@/lib/auth/sign-in-url");

afterEach(() => {
  cleanup();
  nav.replace.mockReset();
  window.history.replaceState(null, "", "/");
});

function at(url: string) {
  window.history.replaceState(null, "", url);
  nav.pathname = new URL(url, "http://x").pathname;
  render(createElement(SignInUrl));
}

describe("SignInUrl", () => {
  it("does nothing on /signin (no loop), with or without next", () => {
    at("/signin");
    at("/signin?next=%2Fcampaigns%2Fabc");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("replaces another URL with /signin?next=<path + search>", () => {
    at("/campaigns/abc?from=b5");
    expect(nav.replace).toHaveBeenCalledWith(`/signin?next=${encodeURIComponent("/campaigns/abc?from=b5")}`);
  });

  it("the main menu goes to plain /signin", () => {
    at("/");
    expect(nav.replace).toHaveBeenCalledWith("/signin");
  });
});
