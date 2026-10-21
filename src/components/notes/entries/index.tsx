"use client";

import "./entries.css";

import { useMutation } from "convex/react";
import { useRef, useState, type KeyboardEvent } from "react";

import { errorMessage } from "@/lib/convex-errors";
import {
  addPlaceholder,
  BULLETS,
  emptyLine,
  ENTRY_KINDS,
  KEY_LEGEND,
  migrationTip,
  openTasks,
  parseQuickKey,
  type EntryKind,
} from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PageEntries } from "../../../../convex/notesEntries";
import type { PageRef } from "../../../../convex/lib/validators/notes";
import { MentionInput } from "../mentions";
import type { NotesSlotProps } from "../slots";
import { EntryRowView, type RowActions } from "./row";
import { pageRefOf, useEntryMutations, usePageEntries } from "./use-entries";

/**
 * A page's entries (D11 N3; board Notes.dc.html l.139-165, 195-280; B3, B4, Q3, D5): the rows, the 'Bullet type'
 * radiogroup and the add row (also for readers who may add, Q3), the kind's empty line and the KEY legend. Everything
 * comes from `notesEntries.entries` for the page in `pageId` (a page id or `template-<i>`; none: the first default
 * page); every click is one intent with an optimistic update (src/lib/optimistic/notes-entries.ts).
 */
export function Entries({ campaignId, pageId, search }: NotesSlotProps) {
  const page = pageRefOf(pageId);
  const loaded = usePageEntries(campaignId, page);
  const mutations = useEntryMutations();
  const [editing, setEditing] = useState<Id<"journalEntries"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The first write on a default page creates the journal, so `pageId` turns from `template-<i>` into the new page's
  // id and the subscription reloads (dcm-bxp.102). Until it answers, the template's last answer stays on screen so the
  // add row stays mounted: focus, the chosen bullet kind and typed text survive. Stored during render, the way React
  // keeps a value from an earlier render (no effect, no copied props).
  const [last, setLast] = useState<{ pageId: string | null; data: PageEntries } | null>(null);
  if (loaded !== undefined && (last?.data !== loaded || last.pageId !== pageId)) setLast({ pageId, data: loaded });
  const data = loaded ?? (last && isTemplate(last.pageId) && !isTemplate(pageId) ? last.data : undefined);

  if (data === undefined) {
    return (
      <p role="status" className="bj-muted">
        Loading entries…
      </p>
    );
  }

  /** Runs one intent; a refusal shows its message (the optimistic guess rolls back by itself). */
  function run(intent: () => Promise<unknown>) {
    setError(null);
    intent().catch((e: unknown) => setError(errorMessage(e)));
  }

  const actions: RowActions = {
    cycle: (entryId) => run(() => mutations.cycle({ campaignId, entryId })),
    toggleStar: (entryId) => run(() => mutations.toggleStar({ campaignId, entryId })),
    moveUp: (entryId) => run(() => mutations.moveUp({ campaignId, entryId })),
    remove: (entryId) => run(() => mutations.remove({ campaignId, entryId })),
    saveText: (entryId, text) => run(() => mutations.setText({ campaignId, entryId, text })),
  };

  return (
    <div className="bj-entries">
      {data.entries.length === 0 && <p className="bj-line">{emptyLine(data.kind)}</p>}
      {data.entries.length > 0 && (
        <ul className="bj-rows" aria-label="Entries">
          {data.entries.map((row, index) => (
            <EntryRowView
              key={row._id}
              campaignId={campaignId}
              row={row}
              first={index === 0}
              search={search}
              editing={editing === row._id}
              onEdit={setEditing}
              actions={actions}
            />
          ))}
        </ul>
      )}
      {data.canAdd && (
        <AddRow campaignId={campaignId} onAdd={(kind, text) => run(() => mutations.add({ campaignId, page, kind, text }))} />
      )}
      {error && (
        <p role="alert" className="bj-entry-error">
          {error}
        </p>
      )}
      <KeyLegend />
    </div>
  );
}

/** `?page=` names a default page that has not been written yet. */
function isTemplate(pageId: string | null): boolean {
  return pageId === null || pageId.startsWith("template-");
}

/** The 'Bullet type' chips (a radiogroup: aria-checked only, arrow keys move) and the add input (B4). */
function AddRow({ campaignId, onAdd }: { campaignId: Id<"campaigns">; onAdd: (kind: EntryKind, text: string) => void }) {
  const [kind, setKind] = useState<EntryKind>("task");
  const box = useRef<HTMLDivElement>(null);
  const spec = BULLETS[kind];

  function pick(next: EntryKind, focus: "input" | "chip") {
    setKind(next);
    if (focus === "input") box.current?.querySelector<HTMLInputElement>(".bj-addrow input")?.focus();
    else box.current?.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus();
  }

  function onChipKey(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = (ENTRY_KINDS.indexOf(kind) + step + ENTRY_KINDS.length) % ENTRY_KINDS.length;
    pick(ENTRY_KINDS[index]!, "chip");
  }

  return (
    <div className="bj-addbox" ref={box}>
      <div role="radiogroup" aria-label="Bullet type" className="bj-kinds">
        {ENTRY_KINDS.map((k) => {
          const checked = k === kind;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              data-kind={k}
              className="bj-chip"
              title={BULLETS[k].tip}
              onClick={() => pick(k, "input")}
              onKeyDown={onChipKey}
            >
              <span className="bj-chip-glyph" aria-hidden="true" style={{ color: checked ? "var(--bj-paper)" : BULLETS[k].color }}>
                {BULLETS[k].glyph}
              </span>
              {BULLETS[k].label}
            </button>
          );
        })}
      </div>
      <div className="bj-addrow">
        <span className="bj-addbul" aria-hidden="true" style={{ color: spec.color }}>
          {spec.glyph}
        </span>
        <MentionInput
          campaignId={campaignId}
          label="New entry"
          placeholder={addPlaceholder(kind)}
          onSubmit={(raw) => {
            const parsed = parseQuickKey(raw, kind);
            if (parsed.text) onAdd(parsed.kind, parsed.text);
          }}
        />
      </div>
    </div>
  );
}

/** The KEY under every page (board l.160). */
function KeyLegend() {
  return (
    <div className="bj-keybox">
      <div className="bj-keyhead">KEY</div>
      <div className="bj-key">
        {KEY_LEGEND.map((item) => (
          <span key={item.text} style={item.color ? { color: item.color } : undefined}>
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * '➜ Migrate open tasks' for the page toolbar (B3, B6): the owner only; disabled without open tasks; the tooltip names
 * the target page or a new one. The target page opens after the move.
 */
export function MigrateButton({ campaignId, pageId, onPage }: NotesSlotProps) {
  const page: PageRef = pageRefOf(pageId);
  const data = usePageEntries(campaignId, page);
  const migrate = useMutation(api.notesEntries.migrateOpen);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (data !== undefined && !data.canArrange) return null;
  const noOpen = data === undefined || openTasks(data.entries).length === 0;

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      const { pageId: target } = await migrate({ campaignId, page });
      onPage(target, "page");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="bj-ghost bj-paper-btn"
        disabled={noOpen || pending}
        title={migrationTip(data?.migrateTarget ?? null)}
        onClick={() => void onClick()}
      >
        ➜ Migrate open tasks
      </button>
      {error && (
        <span role="alert" className="bj-entry-error">
          {error}
        </span>
      )}
    </>
  );
}
