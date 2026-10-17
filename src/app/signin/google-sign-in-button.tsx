"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";

export function GoogleSignInButton() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);

  return (
    <BrandButton
      variant="primary"
      size="xl"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("google", { redirectTo: "/" }).catch(() => setPending(false));
      }}
    >
      {pending ? "Redirecting to Google…" : "Sign in with Google"}
    </BrandButton>
  );
}
