// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn().mockResolvedValue({
  data: { user: { id: "user-1", email: "gm@example.com" } },
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: getUserMock },
  }),
}));

const { createSupabaseServerClient } = await import("@/lib/supabase/server");

describe("createSupabaseServerClient", () => {
  it("reads the authenticated user from the request cookies", async () => {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    expect(user?.email).toBe("gm@example.com");
  });
});
