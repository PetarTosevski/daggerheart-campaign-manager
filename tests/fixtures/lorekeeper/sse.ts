import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Recorded-shape Messages API streams for the D13 tests (invented text, the API's event shapes), and a fetch
 * Response that serves one in chunks of any size, so tests cover events split across chunk boundaries.
 */
export type SseFixture = "answer-cited" | "refusal" | "max-tokens" | "overloaded" | "web-search";

export function sseFixture(name: SseFixture): string {
  return readFileSync(fileURLToPath(new URL(`./${name}.sse`, import.meta.url)), "utf8");
}

/** A 200 `text/event-stream` Response streaming `text` as UTF-8 in chunks of `chunkBytes` bytes. */
export function sseResponse(text: string, chunkBytes = 17): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkBytes));
      offset += chunkBytes;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
