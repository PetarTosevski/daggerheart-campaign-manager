"use client";

import { useMutation } from "convex/react";
import { Pencil } from "lucide-react";
import { useId, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import { SESSION_TEXT_MAX } from "../../../../convex/lib/validators/sessions";
import { Parchment } from "../ui";
import { patchPrep, useRun, type PlanIds } from "./scenes";

/**
 * 'GM prep' (JP1, design Plan view, the parchment under the scenes): the session's hooks text (`sessionPrep.hooks`,
 * the old 'Hooks & loose threads' field). Read as paper: lines starting '- ' are bullets, other lines paragraphs.
 * 'Edit' turns it into a textarea; leaving it saves (`setHooks`, optimistic) and shows the paper again.
 */

/** A block of the prep note: a run of '- ' lines (a bullet list) or one plain line. */
export type PrepBlock = { kind: "list"; items: string[] } | { kind: "line"; text: string };

/** Splits the hooks text into blocks: consecutive '- ' lines form one list; blank lines are dropped. */
export function prepBlocks(text: string): PrepBlock[] {
  const blocks: PrepBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("- ")) {
      const item = line.slice(2).trim();
      const last = blocks.at(-1);
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else {
      blocks.push({ kind: "line", text: line });
    }
  }
  return blocks;
}

export function GmPrep({ ids, hooks }: { ids: PlanIds; hooks: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const { error, run } = useRun();
  const fieldId = useId();
  const setHooks = useMutation(api.sessionPrep.setHooks).withOptimisticUpdate((store, args) =>
    patchPrep(store, { campaignId: args.campaignId, sessionId: args.sessionId }, (prep) => ({ ...prep, hooks: args.hooks.trim() })),
  );

  function save() {
    const text = draft;
    setDraft(null);
    if (text !== null && text.trim() !== hooks) run(setHooks({ ...ids, hooks: text }));
  }

  const blocks = prepBlocks(hooks);
  return (
    <Parchment className="jp-prep">
      <div className="jp-prep-top">
        {draft === null ? (
          <>
            <span className="jr-parchment-lbl jr-m0">GM prep</span>
            <button type="button" className="jp-prep-edit" aria-label="Edit GM prep" onClick={() => setDraft(hooks)}>
              <Pencil aria-hidden="true" />
              Edit
            </button>
          </>
        ) : (
          <label htmlFor={fieldId} className="jr-parchment-lbl jr-m0">
            GM prep
          </label>
        )}
      </div>
      {draft !== null ? (
        <>
          <textarea
            id={fieldId}
            className="jp-prep-ta"
            rows={5}
            // The field opens because the GM pressed Edit, so focus belongs in it.
            autoFocus
            value={draft}
            maxLength={SESSION_TEXT_MAX.hooks}
            placeholder={"- A rumour to drop\n- An NPC to bring back"}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
          <p className="jp-prep-hint">Start a line with “- ” for a bullet. Saved when you leave the field.</p>
        </>
      ) : blocks.length === 0 ? (
        <p className="jp-prep-empty">Rumours to drop, NPCs to bring back, questions left from last time.</p>
      ) : (
        blocks.map((block, i) =>
          block.kind === "list" ? (
            // Blocks have no ids; the list is rebuilt from the text on every render and holds no state.
            <ul key={i} className="jp-prep-list">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ) : (
            <p key={i} className="jp-prep-line">
              {block.text}
            </p>
          ),
        )
      )}
      {error ? (
        <p role="alert" className="jp-error">
          {error}
        </p>
      ) : null}
    </Parchment>
  );
}
