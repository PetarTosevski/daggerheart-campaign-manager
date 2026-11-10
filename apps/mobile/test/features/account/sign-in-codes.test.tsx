import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ConvexError } from "convex/values";

import { authErrorText, joinCodeFromNext } from "../../../src/features/auth/auth-error";
import { PasswordForm } from "../../../src/features/auth/password-form";

const mockSignIn = jest.fn((_provider: string, _params?: Record<string, unknown>) =>
  Promise.resolve({ signingIn: false }),
);

jest.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn }),
}));

// The native crypto module is absent under jest (dcm-gdzi.40); the social buttons import it.
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: () => Promise.resolve("digest"),
  randomUUID: () => "uuid",
}));

beforeEach(() => {
  mockSignIn.mockReset();
  mockSignIn.mockResolvedValue({ signingIn: false });
});

test("rebuild's sign-up and suspension codes get the website's words", async () => {
  const screen = await render(<PasswordForm />);
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough-1");
  for (const [code, text] of [
    ["ACCOUNT_SUSPENDED", "This account is suspended."],
    ["SIGN_UP_CLOSED", "New accounts are closed right now."],
    ["SIGN_UP_INVITE_ONLY", "New accounts need an invite."],
  ] as const) {
    mockSignIn.mockRejectedValueOnce(new ConvexError({ code }));
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(text, { exact: false }));
  }
});

test("sign-up from a join link sends its code", async () => {
  const screen = await render(<PasswordForm joinCode="K7QM3XRP" />);
  await fireEvent.press(screen.getByRole("button", { name: "New here? Create an account" }));
  await fireEvent.changeText(screen.getByLabelText("Name"), "Ana");
  await fireEvent.changeText(screen.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "long-enough-1");
  await fireEvent.press(screen.getByRole("button", { name: "Create account" }));
  await screen.findByLabelText("6-digit code");
  expect(mockSignIn).toHaveBeenCalledWith("password", {
    flow: "signUp",
    email: "ana@x.com",
    password: "long-enough-1",
    name: "Ana",
    joinCode: "K7QM3XRP",
  });
});

test("sign-in from a join link never sends the code", async () => {
  mockSignIn.mockResolvedValueOnce({ signingIn: true });
  const signIn = await render(<PasswordForm joinCode="K7QM3XRP" />);
  await fireEvent.changeText(signIn.getByLabelText("Email"), "ana@x.com");
  await fireEvent.changeText(signIn.getByLabelText("Password"), "long-enough-1");
  await fireEvent.press(signIn.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(mockSignIn).toHaveBeenLastCalledWith("password", {
      flow: "signIn",
      email: "ana@x.com",
      password: "long-enough-1",
    }),
  );
});

test("an Apple key outage reads as unavailable, not as too many tries (dcm-gdzi.41)", () => {
  const outage = new ConvexError({ code: "SIGN_IN_UNAVAILABLE" });
  expect(authErrorText(outage, "fallback")).toBe("Sign in with Apple is unavailable right now. Try again in a moment.");
});

test("joinCodeFromNext reads only a /join/<code> path", () => {
  expect(joinCodeFromNext("/join/K7QM-3XRP")).toBe("K7QM-3XRP");
  expect(joinCodeFromNext("/join/K7QM-3XRP/")).toBe("K7QM-3XRP");
  expect(joinCodeFromNext("/join/a%2")).toBeNull();
  expect(joinCodeFromNext("/campaign/x")).toBeNull();
  expect(joinCodeFromNext("https://evil.example/join/X")).toBeNull();
  expect(joinCodeFromNext(undefined)).toBeNull();
});
