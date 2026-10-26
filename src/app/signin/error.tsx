"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

/** The sign-in page failed to render (rule 11): the reason, a retry and a way back. */
export default function SignInError(props: RouteErrorProps) {
  return <RouteError {...props} title="Sign in" what="The sign-in page failed to load." />;
}
