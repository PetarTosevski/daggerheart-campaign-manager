"use client";

import "./log.css";

import { useMutation, useQuery } from "convex/react";
import { Plus, X } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { addPending, clock, hiddenPending, isPending, removePending, textPending } from "@/lib/journal/log";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { JournalLogLine } from "../../../../convex/journalLog";
import { SESSION_TEXT_MAX } from "../../../../convex/lib/validators/sessions";
import type { SessionLogProps } from "../slots";
import { Card } from "../ui";

import { LOG_ICONS } from "./model";

/**
 * The session log (JL, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, Log & recap, centre).
 * `journalLog.list` oldest first: time, an icon per kind, title and sub line. Caption 'Written by the Combat Map as you
 * play · edit anything'.
 *
 * GM: × on a GM line deletes it (`sessionPlay.removeLog`), on any other line hides it (`journalLog.hide`; the feed row
 * itself stays). 'Show N hidden' lists the hidden lines dimmed, each with Unhide. A click on a title re-words it
 * (`journalLog.setText`; Enter or leaving the field saves, Escape cancels; an empty text on a generated line restores
 * its own words). 'Add a log entry…' + Add (`sessionPlay.addLog`, keyed). Every write is optimistic.
 * Players (user Q5): the same log read only, without hidden lines (the server leaves them out).
 */
export function SessionLog({ campaignId, sessionId, isGm }: SessionLogProps) {
  const log = useQuery(api.journalLog.list, { campaignId, sessionId });
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useMutation(api.sessionPlay.addLog).withOptimisticUpdate(addPending);
  const remove = useMutation(api.sessionPlay.removeLog).withOptimisticUpdate(removePending);
  const hide = useMutation(api.journalLog.hide).withOptimisticUpdate(hiddenPending(true));
  const unhide = useMutation(api.journalLog.unhide).withOptimisticUpdate(hiddenPending(false));
  const reword = useMutation(api.journalLog.setText).withOptimisticUpdate(textPending);

  const caption = isGm ? "Written by the Combat Map as you play · edit anything" : "Written by the Combat Map as you play";

  if (log === undefined) {
    return (
      <Card heading="Session log" actions={<span className="jl-caption">{caption}</span>}>
        <p role="status" className="jr-muted jr-m0">
          Loading the session log…
        </p>
      </Card>
    );
  }

  const hiddenCount = log.lines.filter((l) => l.hidden).length;
  const lines = log.lines.filter((l) => !l.hidden || showHidden);

  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((err: unknown) => setError(errorMessage(err)));
  }

  function onX(line: JournalLogLine) {
    if (line.source === "gm") {
      run(remove({ campaignId, sessionId, logId: line.sourceId }));
    } else {
      run(hide({ campaignId, sessionId, source: line.source, sourceId: line.sourceId }));
    }
  }

  function onUnhide(line: JournalLogLine) {
    if (line.source === "gm") return;
    run(unhide({ campaignId, sessionId, source: line.source, sourceId: line.sourceId }));
  }

  function onReword(line: JournalLogLine, text: string) {
    const next = text.trim();
    if (next === line.title) return;
    // A GM line can't be emptied (delete it with ×); an empty text on a generated line restores its own words.
    if (next === "" && line.source === "gm") return;
    run(reword({ campaignId, sessionId, source: line.source, sourceId: line.sourceId, text: next }));
  }

  return (
    <Card heading="Session log" className="jl-card" actions={<span className="jl-caption">{caption}</span>}>
      {lines.length === 0 ? (
        <p className="jr-muted jr-m0 jl-empty">
          {log.lines.length === 0
            ? "Nothing logged yet. Rolls, Fear, combat and scenes from the Combat Map show here as you play."
            : "Every line is hidden."}
        </p>
      ) : (
        <ol className="jl-list" aria-label="Session log lines, oldest first">
          {lines.map((line) => (
            <LogRow key={line.key} line={line} isGm={isGm} onX={onX} onUnhide={onUnhide} onReword={onReword} />
          ))}
        </ol>
      )}
      {log.truncated ? (
        <p className="jr-muted jl-note">The log is too long to show whole: the earliest lines are here, later ones are not.</p>
      ) : null}
      {isGm && hiddenCount > 0 ? (
        <BrandButton variant="neutral" size="sm" className="mt-2.5" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? `Hide ${hiddenCount} hidden` : `Show ${hiddenCount} hidden`}
        </BrandButton>
      ) : null}
      {error ? (
        <p role="alert" className="jl-error">
          {error}
        </p>
      ) : null}
      {isGm ? (
        <AddForm
          sessionId={sessionId}
          onAdd={(text) => {
            setError(null);
            return add({ campaignId, sessionId, text, idempotencyKey: crypto.randomUUID() }).then(
              () => null,
              (err: unknown) => errorMessage(err),
            );
          }}
          onError={setError}
        />
      ) : null}
    </Card>
  );
}

function LogRow({
  line,
  isGm,
  onX,
  onUnhide,
  onReword,
}: {
  line: JournalLogLine;
  isGm: boolean;
  onX: (line: JournalLogLine) => void;
  onUnhide: (line: JournalLogLine) => void;
  onReword: (line: JournalLogLine, text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();
  const { Icon, label } = LOG_ICONS[line.icon];
  const pending = isPending(line);
  const xLabel = line.source === "gm" ? `Delete log line: ${line.title}` : `Hide log line: ${line.title}`;

  function save() {
    if (draft === null) return;
    setDraft(null);
    onReword(line, draft);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
    }
  }

  return (
    <li className="jl-row" data-hidden={line.hidden ? "true" : undefined} data-source={line.source}>
      <time className="jl-time" dateTime={new Date(line.at).toISOString()}>
        {clock(line.at)}
      </time>
      <span className="jl-icon" data-icon={line.icon} title={label}>
        <Icon aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
      <div className="jl-body">
        {draft !== null ? (
          <>
            <label htmlFor={inputId} className="sr-only">
              Re-word the line
            </label>
            <input
              id={inputId}
              className="jl-edit"
              // The field opens on a click of the title, so focus follows the user's action.
              autoFocus
              maxLength={SESSION_TEXT_MAX.log}
              value={draft}
              placeholder={line.source === "gm" ? undefined : "Empty restores the line's own words"}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={save}
            />
          </>
        ) : isGm && !pending ? (
          <button type="button" className="jl-title jl-title-btn" onClick={() => setDraft(line.title)}>
            {line.title}
            <span className="sr-only">, re-word</span>
          </button>
        ) : (
          <span className="jl-title">{line.title}</span>
        )}
        {line.sub || line.edited || line.hidden ? (
          <span className="jl-sub">
            {line.sub}
            {line.edited ? <span className="jl-tag">{line.sub ? " · edited" : "edited"}</span> : null}
            {line.hidden ? <span className="jl-tag">{line.sub || line.edited ? " · hidden" : "hidden"}</span> : null}
          </span>
        ) : null}
      </div>
      {isGm ? (
        line.hidden ? (
          <BrandButton variant="neutral" size="sm" className="jl-unhide" onClick={() => onUnhide(line)} aria-label={`Unhide log line: ${line.title}`}>
            Unhide
          </BrandButton>
        ) : (
          <BrandButton variant={line.source === "gm" ? "danger" : "neutral"} size="sm" icon aria-label={xLabel} disabled={pending} onClick={() => onX(line)}>
            <X aria-hidden="true" />
          </BrandButton>
        )
      ) : null}
    </li>
  );
}

function AddForm({
  sessionId,
  onAdd,
  onError,
}: {
  sessionId: Id<"sessions">;
  onAdd: (text: string) => Promise<string | null>;
  onError: (message: string | null) => void;
}) {
  const [text, setText] = useState("");
  const inputId = `jl-add-${sessionId}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    const line = text.trim();
    if (line === "") return;
    setText("");
    void onAdd(line).then((failure) => {
      if (failure === null) return;
      onError(failure);
      setText((now) => (now === "" ? line : now));
    });
  }

  return (
    <form className="jl-add" onSubmit={submit}>
      <label htmlFor={inputId} className="sr-only">
        New log entry
      </label>
      <input
        id={inputId}
        className="jl-add-in"
        type="text"
        placeholder="Add a log entry…"
        maxLength={SESSION_TEXT_MAX.log}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <BrandButton type="submit" variant="neutral" className="flex-none">
        <Plus aria-hidden="true" />
        Add
      </BrandButton>
    </form>
  );
}
