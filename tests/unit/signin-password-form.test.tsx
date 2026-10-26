// OS4 (.omc/plans/open-signup.yaml): step transitions, error texts, resend cooldown and the code step gate.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), push: vi.fn() }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: mocks.signIn }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}));

const { PasswordForm, RESEND_COOLDOWN_SECONDS, authErrorText } = await import("@/app/signin/password-form");

beforeEach(() => {
  mocks.signIn.mockResolvedValue({ signingIn: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.signIn.mockReset();
  mocks.push.mockReset();
});

const field = (label: string | RegExp) => screen.getByLabelText(label);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

async function createAccount() {
  render(createElement(PasswordForm));
  click("New here? Create an account");
  fireEvent.change(field("Name"), { target: { value: "Ana" } });
  fireEvent.change(field("Email"), { target: { value: "ana@x.com" } });
  fireEvent.change(field("Password"), { target: { value: "long-enough-1" } });
  fireEvent.submit(screen.getByRole("form", { name: "Create account" }));
  await screen.findByText("Enter the 6-digit code we emailed to ana@x.com.");
}

describe("PasswordForm", () => {
  it("create account: details, then the code step, then signed in", async () => {
    await createAccount();
    expect(mocks.signIn).toHaveBeenCalledWith("password", {
      flow: "signUp",
      email: "ana@x.com",
      password: "long-enough-1",
      name: "Ana",
    });
    const code = field("6-digit code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(mocks.push).not.toHaveBeenCalled();

    mocks.signIn.mockResolvedValueOnce({ signingIn: true });
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("form", { name: "Enter the code" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.signIn).toHaveBeenLastCalledWith("password", {
      flow: "email-verification",
      email: "ana@x.com",
      code: "123456",
    });
  });

  it("the code step cannot be skipped: no sign-in before the code, and a failed sign-up stays on the details", async () => {
    mocks.signIn.mockRejectedValueOnce(new ConvexError({ code: "EMAIL_TAKEN" }));
    render(createElement(PasswordForm));
    click("New here? Create an account");
    fireEvent.change(field("Email"), { target: { value: "ana@x.com" } });
    fireEvent.change(field("Password"), { target: { value: "long-enough-1" } });
    fireEvent.submit(screen.getByRole("form", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This email already has an account");
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("a signUp that does not sign in only goes to the code step, never to the app", async () => {
    await createAccount();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("minLength 8 and a hint guard the password on sign-up only", () => {
    render(createElement(PasswordForm));
    expect(field("Password")).not.toHaveAttribute("minlength");
    click("New here? Create an account");
    expect(field("Password")).toHaveAttribute("minlength", "8");
    expect(screen.getByText("At least 8 characters.")).toBeInTheDocument();
  });

  it("wrong code shows the code text, which also says to request a new one", async () => {
    await createAccount();
    mocks.signIn.mockRejectedValueOnce(new ConvexError({ code: "CODE_INVALID" }));
    fireEvent.change(field("6-digit code"), { target: { value: "000000" } });
    fireEvent.submit(screen.getByRole("form", { name: "Enter the code" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("wrong or has expired");
    expect(alert).toHaveTextContent("Request a new");
  });

  it("each code has its own text; unknown errors get the step's fallback", () => {
    expect(authErrorText(new ConvexError({ code: "EMAIL_TAKEN" }), "x")).toMatch(/already has an account/);
    expect(authErrorText(new ConvexError({ code: "PASSWORD_TOO_SHORT" }), "x")).toMatch(/at least 8/);
    expect(authErrorText(new ConvexError({ code: "CODE_INVALID" }), "x")).toMatch(/new one/);
    expect(authErrorText(new ConvexError({ code: "RATE_LIMITED" }), "x")).toMatch(/Wait a few minutes/);
    expect(authErrorText(new Error("Server Error"), "Wrong email or password.")).toBe("Wrong email or password.");
  });

  it("a wrong password on sign-in says wrong email or password; a rate limit says to wait", async () => {
    render(createElement(PasswordForm));
    fireEvent.change(field("Email"), { target: { value: "ana@x.com" } });
    fireEvent.change(field("Password"), { target: { value: "nope" } });
    mocks.signIn.mockRejectedValueOnce(new Error("Server Error"));
    fireEvent.submit(screen.getByRole("form", { name: "Sign in with email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    mocks.signIn.mockRejectedValueOnce(new ConvexError({ code: "RATE_LIMITED" }));
    fireEvent.submit(screen.getByRole("form", { name: "Sign in with email" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Wait a few minutes"));
  });

  it("resend code: disabled during the cooldown, then sends the sign-up again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    render(createElement(PasswordForm));
    click("New here? Create an account");
    fireEvent.change(field("Email"), { target: { value: "ana@x.com" } });
    fireEvent.change(field("Password"), { target: { value: "long-enough-1" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Create account" }));
    });
    const resend = screen.getByRole("button", { name: new RegExp(`Resend code in ${RESEND_COOLDOWN_SECONDS}s`) });
    expect(resend).toBeDisabled();
    for (let i = 0; i < RESEND_COOLDOWN_SECONDS; i++) await act(() => vi.advanceTimersByTimeAsync(1000));
    const ready = screen.getByRole("button", { name: "Resend code" });
    expect(ready).toBeEnabled();
    mocks.signIn.mockClear();
    await act(async () => {
      fireEvent.click(ready);
    });
    expect(mocks.signIn).toHaveBeenCalledWith("password", expect.objectContaining({ flow: "signUp", email: "ana@x.com" }));
    expect(screen.getByText("We sent a new code.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resend code in/ })).toBeDisabled();
  });

  it("an unverified account that signs in goes to the code step", async () => {
    render(createElement(PasswordForm));
    fireEvent.change(field("Email"), { target: { value: "ana@x.com" } });
    fireEvent.change(field("Password"), { target: { value: "long-enough-1" } });
    fireEvent.submit(screen.getByRole("form", { name: "Sign in with email" }));
    await screen.findByLabelText("6-digit code");
  });

  it("forgot password: email, code and new password, then signed in; the email step never says if an account exists", async () => {
    render(createElement(PasswordForm));
    click("Forgot password?");
    fireEvent.change(field("Email"), { target: { value: "ana@x.com" } });
    fireEvent.submit(screen.getByRole("form", { name: "Reset password" }));
    expect(await screen.findByText(/If ana@x.com has an account/)).toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenCalledWith("password", { flow: "reset", email: "ana@x.com" });

    mocks.signIn.mockResolvedValueOnce({ signingIn: true });
    fireEvent.change(field("6-digit code"), { target: { value: "123456" } });
    fireEvent.change(field("New password"), { target: { value: "brand-new-pass" } });
    fireEvent.submit(screen.getByRole("form", { name: "Choose a new password" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.signIn).toHaveBeenLastCalledWith("password", {
      flow: "reset-verification",
      email: "ana@x.com",
      code: "123456",
      newPassword: "brand-new-pass",
    });
  });

  it("use a different email returns to the details step", async () => {
    await createAccount();
    click("Use a different email");
    expect(screen.getByRole("form", { name: "Create account" })).toBeInTheDocument();
  });
});
