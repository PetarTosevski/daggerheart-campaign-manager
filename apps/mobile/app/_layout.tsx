import { useConvexAuth } from "@convex-dev/auth/react";
import { Redirect, Slot, useSegments } from "expo-router";

import { AppAuthProvider } from "../src/auth/provider";

export default function RootLayout() {
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

function SessionGate() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const route = routeName(useSegments());
  const href = isLoading
    ? null
    : !isAuthenticated && route !== "sign-in"
      ? "/sign-in"
      : isAuthenticated && route !== "campaign"
        ? "/campaign"
        : null;
  return (
    <>
      <Slot />
      {href ? <Redirect href={href} /> : null}
    </>
  );
}
