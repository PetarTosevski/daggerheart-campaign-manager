"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BrandButton, brandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";

/** A shared /join/<code> link: asks before joining, then opens the campaign. */
export function JoinByLink({ code }: { code: string }) {
  const join = useMutation(api.members.joinByCode);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ink p-6 text-center text-parchment">
      <h1 className="font-display text-[30px] font-bold">Join a campaign</h1>
      <p className="max-w-md text-muted-text">
        You were invited with the code <span className="font-display tracking-[0.15em] text-brand">{code.toUpperCase()}</span>.
        Join as a player?
      </p>
      {error ? (
        <p role="alert" className="max-w-md text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className={brandButton({ variant: "outline", size: "lg" })}>
          Not now
        </Link>
        <BrandButton
          variant="primary"
          size="lg"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            join({ code })
              .then((result) => {
                if (result.ok) return router.replace(`/campaigns/${result.campaignId}`);
                setError(result.message);
                setPending(false);
              })
              .catch((e) => {
                setError(errorMessage(e));
                setPending(false);
              });
          }}
        >
          {pending ? "Joining…" : "Join campaign"}
        </BrandButton>
      </div>
    </main>
  );
}
