import { Suspense } from "react";

import { LogoMark } from "@/components/brand/brand";
import { SignInUrl } from "@/lib/auth/sign-in-url";

import { E2ESignInForm } from "./e2e-sign-in-form";
import { GoogleSignInButton } from "./google-sign-in-button";
import { PasswordForm } from "./password-form";

// Inlined at build time: only the e2e build renders the test-only form.
const showE2EForm = process.env.NEXT_PUBLIC_E2E_AUTH === "true";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-ink px-6 pt-16 pb-12 text-parchment">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <LogoMark size={110} className="mb-6" />
        <div className="font-display text-[clamp(28px,8.4vw,104px)] leading-none font-black tracking-[0.08em]">
          DAGGERHEART
        </div>
        <div className="flex items-center gap-4 font-display text-[13px] tracking-[0.3em] text-brand sm:text-[16px] sm:tracking-[0.4em]">
          <span className="h-px w-8 bg-brand sm:w-16" />
          Campaign Ledger
          <span className="h-px w-8 bg-brand sm:w-16" />
        </div>
      </div>
      <div className="mt-[72px] flex w-full max-w-sm flex-col gap-6">
        <h1 className="text-center font-display text-[26px] font-bold tracking-[0.08em]">Sign in</h1>
        {/* Email first (user 2026-10-21); Google is the other way in. */}
        <Suspense>
          <PasswordForm />
        </Suspense>
        <div className="flex items-center gap-4 font-display text-[18px] tracking-[0.12em] text-muted-text uppercase" aria-hidden="true">
          <span className="h-px flex-1 bg-line-2" />
          or
          <span className="h-px flex-1 bg-line-2" />
        </div>
        <Suspense>
          <GoogleSignInButton />
        </Suspense>
        {showE2EForm ? <E2ESignInForm /> : null}
      </div>
      {/* A session that ended mid-use can render this page under the old URL; keep that URL as `next` (B5). */}
      <SignInUrl />

    </main>
  );
}
