"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function GoogleSignInButton() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);

  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("google", { redirectTo: "/" }).catch(() => setPending(false));
      }}
    >
      {pending ? "Redirecting to Google…" : "Sign in with Google"}
    </Button>
  );
}
