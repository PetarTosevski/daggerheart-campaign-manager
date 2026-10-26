"use client";

import "./globals.css";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/**
 * The root layout itself failed (rule 11). This replaces the root layout, so it brings its own html, body and global
 * styles (Next 16 global-error); the reason, a retry and the way back to the main menu.
 */
export default function GlobalError(props: RouteErrorProps) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[#0d1417]">
        <title>Something went wrong · Campaign Ledger</title>
        <RouteError {...props} title="Something went wrong" what="The app failed to load." />
      </body>
    </html>
  );
}
