"use client";

import { useId, useState } from "react";

import {
  ASK_LABEL,
  COMPOSER_LABEL,
  COMPOSER_PLACEHOLDER,
  STOP_LABEL,
  SUGGESTIONS,
  VISIBILITY_PRIVATE,
  VISIBILITY_PUBLIC,
  WEB_TOGGLE_GROUP_LABEL,
  WEB_TOGGLE_LABEL,
  WEB_TOGGLE_OFF,
  WEB_TOGGLE_ON,
  questionsLeftLabel,
} from "@/lib/lorekeeper/copy";

import type { ConversationVisibility } from "../../../../convex/lib/validators/lorekeeper";
import { QUESTION_MAX, counterText, sendsOnKey } from "./model";

/** 'questions left today' shows from this many down (and with every cap reason). */
const LEFT_FROM = 10;

export type ComposerProps = {
  /** Why asking is off (not set up, a cap), or null. */
  disabled: string | null;
  /** `lorekeeperUsage.mine().questionsLeft`, once loaded. */
  questionsLeft?: number;
  /** An answer of the caller's streams here: 'Ask' becomes 'Stop' (Q11). */
  streaming: boolean;
  /** `ask` is on its way (blocks a double send). */
  sending: boolean;
  /** Sends a question; resolves false when it failed (the draft comes back). */
  onAsk: (question: string) => Promise<boolean>;
  /** Stops the streaming answer; absent until the server has written it (the button waits, disabled). */
  onStop?: () => void;
  webSearch: boolean;
  onWebSearch: (on: boolean) => void;
  /** The conversation's visibility (Q3) when the caller may change it. */
  visibility: { value: ConversationVisibility; onChange: (next: ConversationVisibility) => void } | null;
  /** Why the last ask failed; `newConversation` offers 'Start a new conversation'. */
  notice: { text: string; newConversation: boolean } | null;
  onNewConversation: () => void;
};

/**
 * The composer (board): suggestion chips, the question box (Enter sends, Shift+Enter a new line, 1,000 characters with
 * the count near the end), 'Ask' / 'Stop', the 'If the books don’t say' toggle and, not on the board, who can read
 * the conversation (Q3), the questions left today and why asking is off.
 *
 * dcm-bxp.82.10 (user answer 2026-10-22): while asking is off (a cap, not set up) the notice takes the question box's
 * spot so it is seen without scrolling at 1440x900 and 390x844: it comes first in the composer, and the composer
 * (`data-blocked`, chat.css) moves above the conversation, since at 390 px the column's bottom is below the first
 * screen. Any other notice (a failed ask, the questions left) stays under the toggles.
 */
export function Composer(props: ComposerProps) {
  const { disabled, questionsLeft, streaming, sending, onAsk, onStop, webSearch, onWebSearch, visibility, notice, onNewConversation } = props;
  const [draft, setDraft] = useState("");
  const counterId = useId();
  const noticeId = useId();
  const blocked = disabled !== null || streaming || sending;
  const counter = counterText(draft.length);
  const showLeft = questionsLeft !== undefined && questionsLeft <= LEFT_FROM;
  const left = showLeft ? <span className="lk-left">{questionsLeftLabel(Math.max(0, questionsLeft))}</span> : null;

  const send = async (text: string) => {
    const question = text.trim();
    if (question.length === 0 || question.length > QUESTION_MAX || blocked) return;
    const typed = text === draft;
    if (typed) setDraft("");
    const ok = await onAsk(question);
    if (!ok && typed) setDraft((now) => (now === "" ? text : now));
  };

  return (
    <div className="lk-compose" aria-label="Ask the Lorekeeper" role="group" data-blocked={disabled !== null ? "" : undefined}>
      {disabled !== null ? (
        <div id={noticeId} className="lk-notice lk-notice-blocked" role="alert">
          <span>{disabled}</span>
          {left}
        </div>
      ) : null}
      <div className="lk-sugs">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion.key} type="button" className="lk-sug" disabled={blocked} onClick={() => void send(suggestion.question)}>
            {suggestion.label}
          </button>
        ))}
      </div>
      <div className="lk-inrow">
        <textarea
          className="lk-in"
          rows={1}
          placeholder={COMPOSER_PLACEHOLDER}
          aria-label={COMPOSER_LABEL}
          aria-describedby={[counter ? counterId : null, disabled || notice ? noticeId : null].filter(Boolean).join(" ") || undefined}
          maxLength={QUESTION_MAX}
          value={draft}
          disabled={disabled !== null}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (!sendsOnKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
            event.preventDefault();
            void send(draft);
          }}
        />
        {streaming ? (
          <button type="button" className="lk-send" disabled={!onStop} onClick={onStop}>
            {STOP_LABEL}
          </button>
        ) : (
          <button type="button" className="lk-send" disabled={blocked} onClick={() => void send(draft)}>
            {ASK_LABEL}
          </button>
        )}
      </div>
      {counter ? (
        <span id={counterId} className="lk-counter" aria-live="polite">
          {counter}
        </span>
      ) : null}
      <div className="lk-togglerow">
        <span className="lk-lbl">{WEB_TOGGLE_LABEL}</span>
        <div className="lk-toggle" role="group" aria-label={WEB_TOGGLE_GROUP_LABEL}>
          <button type="button" aria-pressed={webSearch} onClick={() => onWebSearch(true)}>
            {WEB_TOGGLE_ON}
          </button>
          <button type="button" aria-pressed={!webSearch} onClick={() => onWebSearch(false)}>
            {WEB_TOGGLE_OFF}
          </button>
        </div>
        {visibility ? (
          <button
            type="button"
            className="lk-visibility"
            aria-pressed={visibility.value === "private"}
            onClick={() => visibility.onChange(visibility.value === "private" ? "campaign" : "private")}
          >
            <span aria-hidden="true">{visibility.value === "private" ? "🔒" : "👁"}</span> Private
          </button>
        ) : null}
        {visibility ? (
          <span className="lk-vistext">{visibility.value === "private" ? VISIBILITY_PRIVATE : VISIBILITY_PUBLIC}</span>
        ) : null}
      </div>
      {disabled === null && (notice || showLeft) ? (
        <div id={noticeId} className="lk-notice" role={notice ? "alert" : "status"}>
          {notice ? <span>{notice.text}</span> : null}
          {left}
          {notice?.newConversation ? (
            <button type="button" className="lk-act lk-act-dark" onClick={onNewConversation}>
              Start a new conversation
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
