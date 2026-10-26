/**
 * A same-site path to return to after sign-in, or "/". Rejects anything that
 * could leave the site: absolute URLs, protocol-relative `//host` and `/\host`.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !/^\/(?![/\\])/.test(next)) return "/";
  return next;
}
