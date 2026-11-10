"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef } from "react";

import { DRAFT_MAX_BYTES, DRAFT_SCHEMA_VERSION, utf8Bytes } from "@/lib/config/preferences";
import { DRAFT_DEBOUNCE_MS, type DraftScope } from "@/lib/party/wizard-draft";

import { api } from "../../../../../../../convex/_generated/api";

/**
 * Unsent drafts on the account (config U6f, Q15 b): the character wizard (one per campaign) and the custom frame form
 * keep their draft in `userDrafts` (`convex/drafts.ts`), so another device picks it up. A stored draft is read once,
 * when the form opens, through a zod parser; a draft of another `schemaVersion` or shape is ignored (the form starts
 * empty). Saves go out from the change handlers (rule 13): typing is debounced (`DRAFT_DEBOUNCE_MS` after the last
 * key), a click (a choice, a step change) saves at once. The pure parts (envelope parser, wizard draft schema, typed
 * fields) live in src/lib/party/wizard-draft.ts, shared with the phone app.
 */

// The custom frame form (src/app/(gm)/new/custom-frame-form.tsx) still imports `parseDraft` from here.
export { parseDraft } from "@/lib/party/wizard-draft";

/**
 * The caller's draft of `scope`: `stored` is undefined while it loads (or while `enabled` is false: the query is
 * skipped, for a viewer who may not read the draft), then `drafts.get`'s answer (parse it with `parseDraft`).
 * `save(data, { typed })` writes the draft (debounced when `typed`), `flush()` sends a waiting save now, `clear()`
 * drops any waiting save and deletes the draft. A refused or failed save is dropped: a draft is a convenience, and
 * the next change saves again. The three actions keep their identity while the scope is the same.
 */
export function useAccountDraft(scope: DraftScope, { enabled = true }: { enabled?: boolean } = {}) {
  const stored = useQuery(api.drafts.get, enabled ? scope : "skip");
  const saveDraft = useMutation(api.drafts.save);
  const clearDraft = useMutation(api.drafts.clear);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<string | null>(null);
  const scopeKey = JSON.stringify(scope);

  const actions = useMemo(() => {
    const target = JSON.parse(scopeKey) as DraftScope;

    const cancel = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      waiting.current = null;
    };

    const flush = () => {
      const data = waiting.current;
      cancel();
      if (data === null) return;
      saveDraft({ ...target, schemaVersion: DRAFT_SCHEMA_VERSION, data }).catch(() => undefined);
    };

    const save = (value: object, { typed = false }: { typed?: boolean } = {}) => {
      const data = JSON.stringify(value);
      if (utf8Bytes(data) > DRAFT_MAX_BYTES) return; // the server refuses it; keep the last saved draft
      if (timer.current !== null) clearTimeout(timer.current);
      waiting.current = data;
      if (typed) timer.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
      else flush();
    };

    const clear = () => {
      cancel();
      clearDraft(target).catch(() => undefined);
    };

    return { save, flush, clear };
  }, [scopeKey, saveDraft, clearDraft]);

  return { stored, ...actions };
}
