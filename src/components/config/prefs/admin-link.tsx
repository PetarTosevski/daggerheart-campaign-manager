"use client";

import { useQuery } from "convex/react";
import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { brandButton } from "@/components/brand/buttons";

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
      className={brandButton({ variant: "neutral", className: "mt-2.5 w-full justify-start gap-3 text-left" })}
    >
      <Lock aria-hidden="true" className="size-4 flex-none" />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-sm font-semibold">App admin</b>
        <em className="text-xs not-italic opacity-80">Limits, costs and feature switches · only you</em>
      </span>
      <ArrowRight aria-hidden="true" className="size-4 flex-none" />
    </Link>
  );
}
