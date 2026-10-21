"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/** A frame introduction failed to render (rule 11): the reason, a retry and a way back. */
export default function FrameIntroError(props: RouteErrorProps) {
  return <RouteError {...props} title="Campaign frame" what="This campaign frame failed to load." back={{ href: "/new", label: "Back to the frames" }} />;
}
