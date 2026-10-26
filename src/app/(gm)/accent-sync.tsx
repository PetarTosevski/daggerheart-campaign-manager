"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../../convex/_generated/api";

/** Applies the GM's accent colour (Settings → Display) to the whole app. */
export function AccentSync() {
  const settings = useQuery(api.settings.get);
  const accent = settings?.accent;
  useEffect(() => {
    if (accent) document.documentElement.style.setProperty("--brand", accent);
  }, [accent]);
  return null;
}
