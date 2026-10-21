"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { brandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

/** The props Next 16 passes to every `error.tsx` and `global-error.tsx`. */
export type RouteErrorProps = { error: Error & { digest?: string }; retry: () => void };

type Back = { href: string; label: string };

/**
 * The shared body of every route segment's `error.tsx` (rule 11, CL1): what failed, the reason from the error-code
 * mapping (never a stack trace), a 'Try again' that calls Next's `retry` and a way back. `layout="page"` fills the
 * screen (segments without chrome around them); `layout="inline"` sits under the campaign chrome, which stays.
 */
export function RouteError({
  error,
  retry,
  title,
  what,
  back = { href: "/", label: "Back to the main menu" },
  layout = "page",
}: RouteErrorProps & { title: string; what: string; back?: Back; layout?: "page" | "inline" }) {
  const body = (
    <div className="flex w-full max-w-[640px] flex-col gap-5">
      <h1 className="m-0 font-display text-[32px] leading-tight font-bold text-parchment sm:text-[40px]">{title}</h1>
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-xl border border-[#6a2a2a] bg-black/35 px-5 py-4 text-[16px] text-[#f0d4cf]"
      >
        <p className="m-0 font-semibold">{what}</p>
        <p className="m-0 text-[#c9d2cf]">{errorMessage(error)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={brandButton({ variant: "solid", size: "lg" })} onClick={() => retry()}>
          Try again
        </button>
        <Link href={back.href} className={brandButton({ variant: "outline", size: "lg" })}>
          {back.label}
        </Link>
      </div>
    </div>
  );

  if (layout === "inline") {
    return <main className="mx-auto flex max-w-[1344px] flex-col px-4 pt-7 pb-14 sm:px-12">{body}</main>;
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0d1417] p-6 font-sans text-[#e6ecea]">
      {body}
    </main>
  );
}

/**
 * A campaign section's `error.tsx` body: it renders under the campaign chrome (the layout above the boundary), so the
 * section nav stays; the way back is the campaign dashboard.
 */
export function CampaignRouteError(props: RouteErrorProps & { title: string; what: string }) {
  const { campaignId } = useParams<{ campaignId: string }>();
  return (
    <RouteError
      {...props}
      layout="inline"
      back={{ href: `/campaigns/${encodeURIComponent(campaignId)}`, label: "Back to the dashboard" }}
    />
  );
}
