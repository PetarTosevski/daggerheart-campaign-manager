"use client";

import { useQuery } from "convex/react";
import { Lock } from "lucide-react";
import { useEffect } from "react";

import { SlotBoundary } from "@/components/party/session/boundary";
import { setReadOnlyBannerMessage } from "@/lib/convex-errors";

import { api } from "../../convex/_generated/api";

/** The banner's heading line and the text shown when the owner wrote no message. */
export const READ_ONLY_BANNER_TITLE = "Read-only right now.";
export const READ_ONLY_BANNER_DEFAULT = "Everyone can read, but nothing can be changed.";

/**
 * Read-only mode's banner (config AU5, Q31 a): while the app owner has read-only mode on (`appStatus.get` answers
 * `{ readOnly: true, message }`), every page shows it, with the owner's message when there is one. Mounted by the (gm)
 * layout and the sign-in page. It also hands the message to `errorMessage`, so a refused write (`READ_ONLY_MODE`)
 * says the same thing. Renders nothing while loading, while the mode is off, or if the query fails (its own boundary,
 * rule 11: a banner never takes a page down).
 */
export function ReadOnlyBanner() {
  return (
    <SlotBoundary>
      <Banner />
    </SlotBoundary>
  );
}

function Banner() {
  const status = useQuery(api.appStatus.get, {});
  const message = status?.message ?? null;
  // Syncs an external store (the error text module), not React state.
  useEffect(() => {
    setReadOnlyBannerMessage(message);
    return () => setReadOnlyBannerMessage(null);
  }, [message]);
  if (!status) return null;
  return (
    <div
      role="status"
      data-testid="read-only-banner"
      className="flex w-full items-center justify-center gap-2.5 border-b border-[#e3b45a]/60 bg-[#2d2614] px-4 py-2.5 text-center text-[14px] leading-snug text-[#f3cf86]"
    >
      <Lock aria-hidden="true" className="size-4 flex-none" />
      <p className="m-0">
        <b className="font-semibold">{READ_ONLY_BANNER_TITLE}</b> {message ?? READ_ONLY_BANNER_DEFAULT}
      </p>
    </div>
  );
}
