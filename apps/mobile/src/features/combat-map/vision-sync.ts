import { useMutation, useQuery } from "convex/react";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import { decodeExplored, exploredGrows } from "../../../../../src/lib/domain/combat-map/vision";

import { api, type Id } from "../../convex";

import type { CombatPlayerView } from "./contract";
import { unionMask, type FogMasks } from "./fog-paint";

/**
 * A player's fog and the vision writes, ported from the website's `src/components/combat-map/vision/use-vision.ts`
 * (dcm-gdzi.12). That file imports the web's Convex client and `@/` paths, so the phone cannot import it; the hooks
 * below follow it line for line, with the pure parts (`decodeExplored`, `exploredGrows`, `unionMask`) shared. Only the
 * player's own client calls these: the GM's map never marks a character's explored area or seen adversaries.
 */

export type ViewOk = Extract<CombatPlayerView, { state: "ok" }>;

/** The character's stored explored samples (R11), decoded; `mask` null while loading or with nothing stored yet. */
export function useStoredExplored(campaignId: Id<"campaigns">, ok: ViewOk | null): { mask: Uint8Array | null; loaded: boolean } {
  const row = useQuery(api.combatVision.explored, ok ? { campaignId, characterId: ok.characterId } : "skip");
  // Memoised on text and numbers, not on the view object: every live update sends a new view, and a new mask would
  // rebuild the fog image (dcm-gdzi.14).
  const length = ok ? ok.vision.sw * ok.vision.sh : 0;
  const bits = ok && row && row.mapId === ok.mapId && row.length === length ? row.bits : null;
  const mask = useMemo(() => (bits === null ? null : decodeExplored(bits, length)), [bits, length]);
  return { mask, loaded: row !== undefined };
}

/** The fog masks of a character's view: seen, clear and explored (stored or seen now). Same masks while the text is the same. */
export function useFogMasks(ok: ViewOk | null, stored: Uint8Array | null): FogMasks | null {
  const vision = ok?.vision ?? null;
  const sw = vision?.sw ?? 0;
  const sh = vision?.sh ?? 0;
  const scale = vision?.scale ?? 0;
  const seenBits = vision?.seen ?? null;
  const clearBits = vision?.clear ?? null;
  return useMemo(() => {
    if (seenBits === null || clearBits === null) return null;
    const length = sw * sh;
    const seen = decodeExplored(seenBits, length);
    const clear = decodeExplored(clearBits, length);
    return { sw, sh, scale, seen, clear, explored: unionMask(stored, seen) };
  }, [sw, sh, scale, seenBits, clearBits, stored]);
}

/** At most one explored-area write per this many milliseconds; the first change of view is sent at once (web value). */
export const EXPLORED_THROTTLE_MS = 500;

type ExploredWrite = { mapId: Id<"combatMaps">; characterId: Id<"characters">; bits: string };

/**
 * Keeps the player's explored area on the server (R11), as the website's `useExploredSync` does. This is the
 * documented exception to "no mutations from effects" that the website uses: the write is a sync of server-derived
 * data, not a user action.
 * - The need is derived during render: `exploredGrows(stored, seen)` is true only when the character sees a sample
 *   the stored row lacks.
 * - The effect depends only on that boolean and the encoded mask (strings, never a fresh object) and returns at once
 *   when nothing grows.
 * - One write at once when none went out in the last EXPLORED_THROTTLE_MS and none is in flight; otherwise one write
 *   is scheduled and sends the newest mask. After a write the stored row updates, `grows` turns false and nothing more
 *   is sent. A failed or refused write is not retried for the same mask.
 */
export function useExploredSync(
  campaignId: Id<"campaigns">,
  ok: ViewOk | null,
  masks: FogMasks | null,
  stored: Uint8Array | null,
  storedLoaded: boolean,
) {
  const markExplored = useMutation(api.combatVision.markExplored);
  // Called from the effect and its timer; not a dependency (only the view decides when to write).
  const write$ = useEffectEvent((args: ExploredWrite & { campaignId: Id<"campaigns"> }) => markExplored(args));
  const last = useRef(0);
  const latest = useRef<ExploredWrite | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const grows = ok !== null && masks !== null && storedLoaded && exploredGrows(stored ?? new Uint8Array(0), masks.seen);
  const bits = ok?.vision.seen ?? null;
  const mapId = ok?.mapId ?? null;
  const characterId = ok?.characterId ?? null;

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!grows || bits === null || mapId === null || characterId === null) return;
    latest.current = { mapId, characterId, bits };
    if (timer.current !== null) return; // the scheduled write sends this newer mask
    const send = () => {
      timer.current = null;
      const write = latest.current;
      if (write === null) return;
      latest.current = null;
      inFlight.current = true;
      last.current = Date.now();
      Promise.resolve()
        .then(() => write$({ campaignId, ...write }))
        .catch(() => {
          // The next change of view tries again; explored areas are a convenience, never an error card.
        })
        .finally(() => {
          inFlight.current = false;
          if (latest.current !== null && timer.current === null) timer.current = setTimeout(send, EXPLORED_THROTTLE_MS);
        });
    };
    if (inFlight.current) return; // sent when the write in flight settles
    const wait = last.current + EXPLORED_THROTTLE_MS - Date.now();
    if (wait <= 0) send();
    else timer.current = setTimeout(send, wait);
  }, [grows, bits, mapId, characterId, campaignId]);
}

/**
 * Records the adversaries the player's character sees as seen by the party this scene (the website's `useSeenSync`;
 * convex/lib/spotlightSeen.ts), so spotlight names and revive lines that depend on "seen" work for phone players.
 * The same documented exception: the need comes from the server (`playerView.unseenAdversaries`), the effect depends
 * only on that list's text, and after `markSeen` the view answers an empty list, so nothing more is sent. A failed
 * write is not retried for the same list.
 */
export function useSeenSync(campaignId: Id<"campaigns">, ok: ViewOk | null) {
  const markSeen = useMutation(api.combatVision.markSeen);
  // The mutation function is not a reason to send again (only the list is); an effect event reads the current one.
  const send = useEffectEvent((args: { campaignId: Id<"campaigns">; characterId: string; tokenIds: string[] }) => markSeen(args));
  const characterId = ok?.characterId ?? null;
  const unseen = ok?.unseenAdversaries.join(",") ?? "";
  useEffect(() => {
    if (characterId === null || unseen === "") return;
    Promise.resolve(send({ campaignId, characterId, tokenIds: unseen.split(",") })).catch(() => {
      // Best effort: the next change of view sends the list again.
    });
  }, [unseen, characterId, campaignId]);
}
