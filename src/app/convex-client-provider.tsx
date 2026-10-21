"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

// initialAuthTokenReuse (experimental in convex 1.46, pinned in package.json):
// once the server confirms the token the page was rendered with, keep using it
// and schedule its refresh before it expires, instead of fetching a fresh one
// at once. That second token cost a POST /api/auth and a second Authenticate,
// which made the server run every subscribed query twice on each hard load.
// tests/e2e/auth-single-run.spec.ts fails if the double run comes back.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
  initialAuthTokenReuse: true,
});

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>
  );
}
