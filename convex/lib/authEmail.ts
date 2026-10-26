/**
 * Emailed 6-digit codes for password sign-up and password reset (open-signup plan, OS1).
 *
 * `resendCodeProvider(id)` builds a Convex Auth email provider that sends the code through the Resend HTTP API
 * (plain `fetch`, no dependency). `AUTH_RESEND_KEY` and `MAIL_FROM` are read only inside the handler through the
 * typed `env` (CF19), live only in the Convex env, and are never logged or put into an error.
 *
 * On the local e2e backend (`isE2EDeployment` and `E2E_AUTH_ENABLED=true`) nothing is sent and the code is always
 * `123456`. Both the generator and the sender check, so a cloud deployment can never use the fixed code.
 * Runs in an action (`fetch`); no "use node" needed.
 */
import { Email } from "@convex-dev/auth/providers/Email";

import { env as typedEnv } from "../_generated/server";
import { isE2EDeployment, type Env } from "./allowlist";

export const RESEND_URL = "https://api.resend.com/emails";
/** The code is valid for 15 minutes. */
export const CODE_MAX_AGE_SECONDS = 15 * 60;
/** The only code used on the local e2e backend. */
export const E2E_FIXED_CODE = "123456";

export type CodeEmailKind = "verify" | "reset";

export type CodeEmail = { subject: string; text: string; html: string };

/** True only on the local e2e backend with the test sign-in enabled: no email is sent, the code is fixed. */
export function fakeCodeMode(env: Env): boolean {
  return isE2EDeployment(env) && env.E2E_AUTH_ENABLED === "true";
}

/** A uniformly random 6-digit code from the crypto source (rejection sampling, no modulo bias). */
export function randomSixDigitCode(): string {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000);
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0]! >= limit);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

export function generateCode(env: Env): string {
  return fakeCodeMode(env) ? E2E_FIXED_CODE : randomSixDigitCode();
}

/** The email for one code: subject, plain text and HTML. The code is shown once; there is no link. */
export function codeEmail(kind: CodeEmailKind, code: string): CodeEmail {
  const minutes = CODE_MAX_AGE_SECONDS / 60;
  const verify = kind === "verify";
  const subject = verify
    ? "Your Duality Heart verification code"
    : "Your Duality Heart password reset code";
  const intro = verify
    ? "Use this code to finish creating your account."
    : "Use this code to choose a new password.";
  const outro = verify
    ? "If you did not try to sign up, you can ignore this email."
    : "If you did not ask for a password reset, you can ignore this email.";
  const text = `${intro}\n\nYour code: ${code}\n\nIt expires in ${minutes} minutes.\n${outro}\n`;
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:480px">` +
    `<p>${intro}</p>` +
    `<p style="font-size:32px;letter-spacing:6px;font-weight:700">${code}</p>` +
    `<p>It expires in ${minutes} minutes.</p><p>${outro}</p></div>`;
  return { subject, text, html };
}

/** Sends one code email. Throws a clear error on missing config or a non-2xx answer; never leaks key or code. */
export async function sendCodeEmail(
  env: Env,
  kind: CodeEmailKind,
  to: string,
  code: string,
): Promise<void> {
  if (fakeCodeMode(env)) return;
  const key = env.AUTH_RESEND_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!key) throw new Error("Email is not configured: AUTH_RESEND_KEY is missing.");
  if (!from) throw new Error("Email is not configured: MAIL_FROM is missing.");
  const { subject, text, html } = codeEmail(kind, code);
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    throw new Error(`Could not send the email: Resend answered ${res.status}.`);
  }
}

/** Convex Auth email provider for one emailed code. The template follows the id: ids with "reset" send a reset. */
export function resendCodeProvider(id: string) {
  const kind: CodeEmailKind = id.includes("reset") ? "reset" : "verify";
  return Email({
    id,
    maxAge: CODE_MAX_AGE_SECONDS,
    async generateVerificationToken() {
      const env: Env = typedEnv;
      return generateCode(env);
    },
    async sendVerificationRequest({ identifier, token }) {
      const env: Env = typedEnv;
      await sendCodeEmail(env, kind, identifier, token);
    },
  });
}
