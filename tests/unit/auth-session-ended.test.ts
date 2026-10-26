// B5 (plan d12-bugs): the decision that sends an ended session to sign-in and back.
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { isSignInPath, isUnauthenticated, sessionEndedRedirect, signInRedirectTarget } from "@/lib/auth/session-ended";

const at = (pathname: string, search = "") => ({ pathname, search });

describe("isUnauthenticated", () => {
  it("is true only for ConvexError code UNAUTHENTICATED", () => {
    expect(isUnauthenticated(new ConvexError({ code: "UNAUTHENTICATED" }))).toBe(true);
    expect(isUnauthenticated(new ConvexError({ code: "UNAUTHENTICATED", message: "x" }))).toBe(true);
    for (const code of ["FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "INVALID"]) {
      expect(isUnauthenticated(new ConvexError({ code }))).toBe(false);
    }
    expect(isUnauthenticated(new ConvexError("UNAUTHENTICATED"))).toBe(false);
    expect(isUnauthenticated(new Error("UNAUTHENTICATED"))).toBe(false);
    expect(isUnauthenticated(null)).toBe(false);
  });
});

describe("signInRedirectTarget", () => {
  it("carries the path and search in next", () => {
    expect(signInRedirectTarget("/campaigns/abc", "")).toBe("/signin?next=%2Fcampaigns%2Fabc");
    expect(signInRedirectTarget("/campaigns/abc/party", "?tab=gear&x=1")).toBe(
      `/signin?next=${encodeURIComponent("/campaigns/abc/party?tab=gear&x=1")}`,
    );
    expect(signInRedirectTarget("/join/CODE", "?")).toBe("/signin?next=%2Fjoin%2FCODE");
  });

  it("the main menu goes to plain /signin, as the proxy does", () => {
    expect(signInRedirectTarget("/", "")).toBe("/signin");
    expect(signInRedirectTarget("/", "?a=1")).toBe(`/signin?next=${encodeURIComponent("/?a=1")}`);
  });

  it("never redirects from the sign-in page itself", () => {
    expect(isSignInPath("/signin")).toBe(true);
    expect(isSignInPath("/signin/")).toBe(true);
    expect(isSignInPath("/signing")).toBe(false);
    expect(signInRedirectTarget("/signin", "")).toBeNull();
    expect(signInRedirectTarget("/signin", "?next=%2Fcampaigns%2Fabc")).toBeNull();
  });

  it("drops a path that could leave the site", () => {
    expect(signInRedirectTarget("//evil.example", "")).toBe("/signin");
    expect(signInRedirectTarget("/\\evil.example", "")).toBe("/signin");
  });
});

describe("sessionEndedRedirect", () => {
  it("redirects UNAUTHENTICATED and keeps the error screen for everything else", () => {
    const ended = new ConvexError({ code: "UNAUTHENTICATED" });
    expect(sessionEndedRedirect(ended, at("/campaigns/abc"))).toBe("/signin?next=%2Fcampaigns%2Fabc");
    expect(sessionEndedRedirect(ended, at("/signin"))).toBeNull();
    expect(sessionEndedRedirect(new ConvexError({ code: "FORBIDDEN" }), at("/campaigns/abc"))).toBeNull();
    expect(sessionEndedRedirect(new Error("boom"), at("/campaigns/abc"))).toBeNull();
  });
});
