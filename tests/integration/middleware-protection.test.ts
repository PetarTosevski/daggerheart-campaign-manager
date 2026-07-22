// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock },
  }),
}));

// Imported after the mock so the middleware uses the mocked client.
const { updateSession } = await import("@/lib/supabase/middleware");

function makeRequest(path: string) {
  return new NextRequest(new URL(`http://localhost${path}`));
}

afterEach(() => {
  getUserMock.mockReset();
});

describe("updateSession route protection", () => {
  it("redirects unauthenticated requests for protected routes to /login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("allows unauthenticated requests to the public login route", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(makeRequest("/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects authenticated users away from /login to /dashboard", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "1", email: "gm@example.com" } },
    });
    const res = await updateSession(makeRequest("/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("allows authenticated requests to protected routes", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "1", email: "gm@example.com" } },
    });
    const res = await updateSession(makeRequest("/dashboard"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("treats a getUser failure as unauthenticated", async () => {
    getUserMock.mockRejectedValue(new Error("network"));
    const res = await updateSession(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
