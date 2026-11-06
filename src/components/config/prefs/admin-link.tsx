"use client";

import { useQuery } from "convex/react";
import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { api } from "../../../../convex/_generated/api";
import type { PreferencesSlotProps } from "../slots";

/**
 * The App admin link in the Preferences popover (config AU6, design `.pm-adm`): 'App admin · Limits, costs and feature
 * switches · only you', to /admin. Only the app owner sees it (`appAdmin.me`); while that loads, when signed out and for
 * everyone else it renders nothing, so it never flashes. This is UX only (CF22): the admin functions are the gate.
 */
export function AppAdminLink(props: PreferencesSlotProps): ReactNode {
  void props;
  const me = useQuery(api.appAdmin.me);
  if (!me?.isOwner) return null;
  return (
    <Link
      href="/admin"
      // The design's gold card (`.pm-adm`; user 2026-11-05 chose it over neutral glass).
      className="mt-2.5 flex w-full items-center gap-3 rounded-xl bg-[#2d2614] px-3 py-2.5 text-left text-[#f3cf86] no-underline shadow-[inset_0_0_0_1px_rgba(227,180,90,0.5)] hover:bg-[#3a3119] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3cf86]"
    >
      <Lock aria-hidden="true" className="size-4 flex-none" />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-sm font-semibold">App admin</b>
        <em className="text-xs not-italic text-[#d8c49a]">Limits, costs and feature switches · only you</em>
      </span>
      <ArrowRight aria-hidden="true" className="size-4 flex-none" />
    </Link>
  );
}
