// "Remember me" support for the sign-in flow.
//
// Supabase (@supabase/ssr) writes its auth cookies with a long lifetime, so a
// session survives a browser restart by default. When the user opts out of being
// remembered, we strip the lifetime hints so the auth cookies become session
// cookies that the browser clears when it closes. A small companion cookie
// (`ww-remember`) records the choice so both the server client and the
// middleware apply it consistently on every cookie refresh.

export const REMEMBER_COOKIE = "ww-remember";

// ~400 days — the effective maximum lifetime browsers honor for a cookie.
export const REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/**
 * Whether the current request wants a persistent session. Defaults to true when
 * the flag is absent so behavior is unchanged unless the user opts out.
 */
export function shouldRemember(value: string | undefined | null): boolean {
  return value !== "0";
}

type WritableCookieOptions = {
  maxAge?: number;
  expires?: Date;
} & Record<string, unknown>;

/**
 * Returns cookie options unchanged when remembering; otherwise removes `maxAge`
 * and `expires` so the cookie becomes a session cookie.
 */
export function applyRemember<T extends WritableCookieOptions | undefined>(
  options: T,
  remember: boolean,
): T {
  if (remember) return options;
  const next: WritableCookieOptions = { ...(options ?? {}) };
  delete next.maxAge;
  delete next.expires;
  return next as T;
}
