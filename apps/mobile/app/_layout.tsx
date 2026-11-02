import { useConvexAuth } from "@convex-dev/auth/react";
import { Redirect, Slot, useSegments } from "expo-router";

import { AppAuthProvider } from "../src/auth/provider";
import { useBrandFonts } from "../src/theme/fonts";

export { RouteErrorBoundary as ErrorBoundary } from "../src/shell/route-error";

export default function RootLayout() {
  useBrandFonts();
  return (
    <AppAuthProvider>
      <SessionGate />
    </AppAuthProvider>
  );
}

function routeName(segments: readonly string[]): string {
  const parts = segments.filter((segment) => segment.length > 0 && !segment.startsWith("("));
  const leaf = parts[parts.length - 1];
  if (!leaf || leaf === "index") return "index";
  return leaf;
}

function signedOutAllowed(segments: readonly string[]): boolean {
  const root = segments[0];
  if (root === undefined) return true;
  if (root === "sign-in" || root === "(auth)" || root === "auth") return true;
  return false;
}

function SessionGate() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const segments = useSegments();
  const route = routeName(segments);
  const href = isLoading
    ? null
    : !isAuthenticated && !signedOutAllowed(segments)
      ? "/sign-in"
      : isAuthenticated && route === "sign-in"
        ? "/home"
        : isAuthenticated && route === "index"
          ? "/home"
          : null;
  return (
    <>
      <Slot />
      {href ? <Redirect href={href} /> : null}
    </>
  );
}
