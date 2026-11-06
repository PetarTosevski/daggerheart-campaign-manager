import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";

import { DRAFT_MAX_BYTES, DRAFT_SCHEMA_VERSION, utf8Bytes } from "../../../../../../src/lib/config/preferences";
import { DRAFT_DEBOUNCE_MS, type DraftScope } from "../../../../../../src/lib/party/wizard-draft";
import { api } from "../../../convex";

/** Runs a draft write and drops its failure (a refused or failed save is not worth an error; the next change saves). */
function quietly(run: () => unknown): void {
  void (async () => {
    try {
      await run();
    } catch {
      // dropped on purpose
    }
  })();
}

/**
 * Unsent drafts on the account (config U6f), as on the website (party/new/draft.ts `useAccountDraft`): the draft lives
 * in `userDrafts` through `drafts.get` / `drafts.save` / `drafts.clear`, so another device (or the website) picks it up.
 * `stored` is undefined while it loads, then `drafts.get`'s answer (parse it with `wizardFromDraft`). Saves go out from
 * the change handlers (rule 13): typing is debounced (`DRAFT_DEBOUNCE_MS` after the last key), a tap saves at once.
 * A refused or failed save is dropped: a draft is a convenience, and the next change saves again. Leaving the screen
 * sends a waiting typed save.
 */
export function useAccountDraft(scope: DraftScope) {
  const stored = useQuery(api.drafts.get, scope);
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
      quietly(() => saveDraft({ ...target, schemaVersion: DRAFT_SCHEMA_VERSION, data }));
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
      quietly(() => clearDraft(target));
    };

    return { save, flush, clear };
  }, [scopeKey, saveDraft, clearDraft]);

  // Leaving the screen sends a typed change that is still waiting for its pause.
  useEffect(() => () => actions.flush(), [actions]);

  return { stored, ...actions };
}
