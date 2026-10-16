"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Test-only sign-in, rendered only in builds with NEXT_PUBLIC_E2E_AUTH=true. */
export function E2ESignInForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      aria-label="Test sign-in"
      className="flex flex-col gap-3 border-t pt-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const form = new FormData(event.currentTarget);
        signIn("e2e", {
          email: String(form.get("email") ?? ""),
          secret: String(form.get("secret") ?? ""),
        })
          .then(() => router.push("/"))
          .catch(() => setError("Test sign-in failed."));
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" required className="rounded-md border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Secret
        <input name="secret" type="password" required className="rounded-md border px-3 py-2" />
      </label>
      <Button type="submit" variant="outline">
        Test sign-in
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
