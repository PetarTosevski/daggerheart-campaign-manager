import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import { appError } from "../../src/lib/errors/app-error";
import { authMessages } from "../../src/lib/errors/auth";
import { errorMessage } from "../../src/lib/convex-errors";

describe("sign-in errors", () => {
  it("has the three distinct codes with the agreed texts", () => {
    expect(authMessages).toEqual({
      EMAIL_TAKEN: "This email already has an account. Sign in instead.",
      PASSWORD_TOO_SHORT: "The password needs at least 8 characters.",
      CODE_INVALID: "That code is wrong or has expired. Request a new one.",
    });
  });

  it.each(Object.keys(authMessages) as (keyof typeof authMessages)[])("%s is a ConvexError with its code and text", (code) => {
    const error = appError(code);
    expect(error).toBeInstanceOf(ConvexError);
    expect(error.data).toEqual({ code, message: authMessages[code] });
    expect(errorMessage(error)).toBe(authMessages[code]);
  });

  it("the client resolves each code to its own text from the code alone", () => {
    for (const code of Object.keys(authMessages) as (keyof typeof authMessages)[]) {
      expect(errorMessage(new ConvexError({ code }))).toBe(authMessages[code]);
    }
  });

  it("a plain Error (what Convex Auth throws unwrapped) shows the generic text", () => {
    expect(errorMessage(new Error("Server Error"))).toBe("Something went wrong. Check your connection and try again.");
  });
});
