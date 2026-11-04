import { convexSiteUrl } from "@/lib/auth/verify-jwt";

/**
 * The owner's export download (config AU5 over AD11, docs/tasks/TASK-CONFIG-AD11.md): `GET <site>/admin/export?id=…`
 * with the Convex Auth token in the `Authorization` header (never in the URL), then the answer saved as a file. The
 * route checks the owner on every request and answers `{ code }` with 401 / 403 / 404 otherwise.
 */

/** The file name when the response doesn't say (`Content-Disposition` is exposed by the route's CORS headers). */
export const EXPORT_FALLBACK_NAME = "dualityheart-export.json";

export type ExportFetch = { ok: true; blob: Blob; filename: string } | { ok: false; code: string };

/** The deployment's HTTP actions origin, derived from NEXT_PUBLIC_CONVEX_URL (cloud: `.convex.site`; local: port + 1). */
export function exportSiteUrl(): string | null {
  return convexSiteUrl({ NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL });
}

/** The URL of one export's download. The id is the only query parameter; the token goes in a header. */
export function exportDownloadUrl(siteUrl: string, exportId: string): string {
  const url = new URL("/admin/export", siteUrl);
  url.searchParams.set("id", exportId);
  return url.toString();
}

/** The file name from `attachment; filename="…"`, or the fallback. */
export function exportFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"/\\]+)"/);
  return match?.[1] ?? EXPORT_FALLBACK_NAME;
}

/** Fetches the export with the bearer token. A refusal answers its `code` (UNAUTHENTICATED, FORBIDDEN, NOT_FOUND). */
export async function fetchExport(siteUrl: string, exportId: string, token: string): Promise<ExportFetch> {
  const response = await fetch(exportDownloadUrl(siteUrl, exportId), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : "UNKNOWN";
    return { ok: false, code };
  }
  return { ok: true, blob: await response.blob(), filename: exportFilename(response.headers.get("Content-Disposition")) };
}

/** Saves a blob as a file through a temporary object URL and a download link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
