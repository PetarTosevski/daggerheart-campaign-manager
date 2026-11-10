import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

import { installExpoCrypto } from "./crypto";
import { secureTokenStorage } from "./secure-store";

installExpoCrypto();

function convexUrl(): string {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL is not set");
  }
  return url;
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new ConvexReactClient(convexUrl()));
  return (
    <ConvexAuthProvider client={client} storage={secureTokenStorage}>
      {children}
    </ConvexAuthProvider>
  );
}
