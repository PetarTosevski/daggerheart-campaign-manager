/**
 * Keeps the AppError code of a failed Convex Auth call alive through the Next.js auth proxy (dcm-bxp.128.1).
 *
 * Root cause: the proxy (`proxyAuthActionToConvex`, @convex-dev/auth/nextjs/server) calls `fetchAction("auth:signIn")`
 * and, on a throw, answers `{ error: error.message }` and nothing else. A `ConvexError` thrown by Convex Auth's
 * callbacks reaches `fetchAction` as `{ status: "error", errorMessage, errorData }`. On a dev deployment `errorMessage`
 * still reads `Uncaught ConvexError: {"code":"EMAIL_TAKEN"}`, so the browser can parse the code out of it. On a
 * production deployment Convex redacts it to `[Request ID: ...] Server Error` and keeps only `errorData`, which the
 * proxy drops.
 *
 * Fix: `ConvexHttpClient` uses the global `fetch`, so `src/proxy.ts` installs {@link withAuthErrorCode} around it. For
 * a Convex action response that carries `errorData.code`, the wrapper rewrites `errorMessage` to the dev-style text
 * `ConvexError: {"code":"X"}`. Only the code is copied (an upper-case identifier, nothing else from `errorData`), so no
 * stack, request id or secret reaches the browser. `authErrorText` (src/app/signin/password-form.tsx) reads it.
 */

const CODE = /^[A-Z][A-Z0-9_]*$/;

type FetchFn = typeof fetch;

/** The message for a Convex error body, or null when the body has no usable `errorData.code`. */
export function messageWithCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { status, errorData } = body as { status?: unknown; errorData?: unknown };
  if (status !== "error" || typeof errorData !== "object" || errorData === null) return null;
  const code = (errorData as { code?: unknown }).code;
  if (typeof code !== "string" || !CODE.test(code)) return null;
  return `ConvexError: ${JSON.stringify({ code })}`;
}

function isActionCall(input: Parameters<FetchFn>[0], convexUrl: string): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith(convexUrl) && url.endsWith("/api/action");
}

/** Wraps `fetch` so failed Convex action responses name their AppError code in `errorMessage`. */
export function withAuthErrorCode(inner: FetchFn, convexUrl: string | undefined): FetchFn {
  if (!convexUrl) return inner;
  return async (input, init) => {
    const response = await inner(input, init);
    if (!isActionCall(input, convexUrl)) return response;
    try {
      const body: unknown = await response.clone().json();
      const message = messageWithCode(body);
      if (message === null) return response;
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(JSON.stringify({ ...(body as object), errorMessage: message }), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  };
}
