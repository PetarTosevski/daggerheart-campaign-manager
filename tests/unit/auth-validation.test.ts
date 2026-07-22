import { describe, expect, it } from "vitest";

import { signInSchema } from "@/lib/validation/auth";

describe("signInSchema", () => {
  it("accepts a valid email and password", () => {
    const result = signInSchema.safeParse({
      email: "gm@example.com",
      password: "correct horse",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = signInSchema.safeParse({
      email: "not-an-email",
      password: "correct horse",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = signInSchema.safeParse({
      email: "gm@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });
});
