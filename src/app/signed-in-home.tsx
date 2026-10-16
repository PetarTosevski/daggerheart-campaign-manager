"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { api } from "../../convex/_generated/api";

export function SignedInHome() {
  const viewer = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  const router = useRouter();

  if (viewer === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <p>
        Signed in as <span data-testid="viewer-email">{viewer.email}</span>.
        Campaign frames and the live table view arrive in the next phases.
      </p>
      <Button
        variant="outline"
        onClick={() => void signOut().then(() => router.push("/signin"))}
      >
        Sign out
      </Button>
    </div>
  );
}
