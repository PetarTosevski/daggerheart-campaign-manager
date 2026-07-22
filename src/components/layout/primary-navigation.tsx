"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Sprout } from "lucide-react";

import { signOutAction } from "@/app/(app)/dashboard/actions";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Campaign" },
  { href: "/characters", label: "Characters" },
] as const;

/**
 * Persistent primary navigation and app identity. Lives in the authenticated
 * shell so it stays mounted across route navigation. It is presentation and
 * navigation only; it holds no campaign state.
 */
export function PrimaryNavigation({
  userEmail,
}: {
  userEmail?: string | null;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-stone-900/8 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#3f1e25] text-amber-100 shadow-sm">
            <Sprout className="size-5" aria-hidden="true" />
          </div>
          <span className="truncate font-semibold tracking-tight text-stone-900">
            The Witherwild
          </span>
          <nav aria-label="Primary" className="ml-1 hidden sm:block">
            <ul className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "rounded-md px-3 py-1.5 text-sm font-medium outline-none motion-safe:transition-colors focus-visible:ring-2 focus-visible:ring-amber-700/40",
                        active
                          ? "bg-stone-900/5 text-stone-900"
                          : "text-stone-500 hover:text-stone-900",
                      ].join(" ")}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {userEmail ? (
            <span className="hidden max-w-[16rem] truncate text-xs text-stone-500 sm:inline">
              Signed in as {userEmail}
            </span>
          ) : null}
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="border-stone-300 bg-white/70 text-stone-700 hover:bg-white"
            >
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
