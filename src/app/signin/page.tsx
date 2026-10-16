import { E2ESignInForm } from "./e2e-sign-in-form";
import { GoogleSignInButton } from "./google-sign-in-button";

// Inlined at build time: only the e2e build renders the test-only form.
const showE2EForm = process.env.NEXT_PUBLIC_E2E_AUTH === "true";

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <GoogleSignInButton />
      {showE2EForm ? <E2ESignInForm /> : null}
    </main>
  );
}
