"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { safeNextPath } from "@/lib/safe-next";

export function GoogleSignInButton() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);
  const next = safeNextPath(useSearchParams().get("next"));

  return (
    <BrandButton
      variant="primary"
      size="xl"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("google", { redirectTo: next }).catch(() => setPending(false));
      }}
    >
      {pending ? "Redirecting to Google…" : "Sign in with Google"}
    </BrandButton>
  );
}
