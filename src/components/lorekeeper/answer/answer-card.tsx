"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { lorekeeperMessages } from "@/lib/errors/lorekeeper";
import {
  ACTION_LABELS,
  ASK_GM_SENT,
  ERROR_TEXT,
  GM_CALL_LABEL,
  PHASE_TEXT,
  RETRIED_NOTE,
  TRY_AGAIN_LABEL,
  VERDICT_COPY,
  WEB_DISCLAIMER,
  WEB_DISCLAIMER_TITLE,
} from "@/lib/lorekeeper/copy";
import { askGmLocally, isLocalMessage } from "@/lib/optimistic/lorekeeper";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { MessageView } from "../../../../convex/lorekeeper";
import { MiniSigil } from "../sigil";
import { BookDialog, type BookPage } from "./book-dialog";
import {
  answerActions,
  answerCopyText,
  firstBookQuote,
  isStoppedEarly,
  pinDraft,
  quoteChip,
  quoteSection,
  safeUrl,
  verdictClass,
  type AnswerAction,
  type BookTitles,
} from "./model";
import { PinDialog } from "./pin-dialog";

/** Not in copy.ts: the note on an answer the asker stopped (Q11), and the Copy confirmation. */
export const STOPPED_TEXT = "Stopped.";
export const COPIED_TEXT = "Copied";

export type AnswerCardProps = {
  campaignId: Id<"campaigns">;
  answer: MessageView;
  /** The question this answer replies to (the pin dialog's title, 'Try again'). */
  question: string;
  titles: BookTitles;
  isGm: boolean;
  /** The caller asked this conversation (their own answers get Ask the GM / Pin / Try again). */
  mine: boolean;
  /** This answer was sent to the GM and is still open (`lorekeeperAsks.mine` for the asker, `listOpen` for the GM). */
  sentToGm: boolean;
  /** Re-asks `question` (the error card's 'Try again'); absent when the caller cannot ask here. */
  onRetry?: () => void;
};

/**
 * The thinking row (board): the mini sigil, three dots (static under reduced motion, lorekeeper.css) and the phase
 * text (L11): 'Searching your books…', then 'Checking again with a stronger model…' and 'Searching the internet…'
 * while an uncertain answer waits for the final check. The text is a polite live region, so a screen reader hears
 * each step once; it changes in place, with no animation.
 */
export function ThinkingRow({ phase = "books" }: { phase?: MessageView["phase"] }) {
  return (
    <div className="lk-a">
      <MiniSigil />
      <PhaseStatus phase={phase} />
    </div>
  );
}

/** The dots and the phase text in a polite live region (the thinking row's, and under a kept answer, L12). */
function PhaseStatus({ phase = "books" }: { phase?: MessageView["phase"] }) {
  return (
    <div className="lk-thinking">
      <span className="lk-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span role="status" aria-live="polite" aria-atomic="true">
        {PHASE_TEXT[phase]}
      </span>
    </div>
  );
}

/**
 * One answer in the stream: the thinking row (with the run's phase, L11) while no text is shown, then the board's parchment card with the
 * verdict pill, the prose (plain text), up to three quotes with their '📖 <book> · p.<page>' chips (a chip opens the
 * page), the 'Suggested GM call' box, the unofficial internet block and the actions. Stopped and failed answers keep
 * the card with a note ('Try again' re-asks the same question). L12: while the internet pass runs under a kept book
 * answer, its status stays under that answer; an early Stop shows its note and no actions.
 */
export function AnswerCard(props: AnswerCardProps) {
  const { answer } = props;
  const inFlight = answer.status === "pending" || answer.status === "streaming";
  if (inFlight && answer.text === "") return <ThinkingRow phase={answer.phase} />;
  if (answer.status === "error") return <ErrorCard {...props} />;
  return <ParchmentCard {...props} inFlight={inFlight} />;
}

function ErrorCard({ answer, onRetry }: AnswerCardProps) {
  const text = (answer.errorCode && lorekeeperMessages[answer.errorCode]) || ERROR_TEXT;
  return (
    <article className="lk-a" aria-label="The Lorekeeper's answer">
      <MiniSigil />
      <div className="lk-ab lk-ab-error">
        <p>{text}</p>
        {onRetry ? (
          <div className="lk-acts">
            <button type="button" className="lk-act" onClick={onRetry}>
              {TRY_AGAIN_LABEL}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ParchmentCard(props: AnswerCardProps & { inFlight: boolean }) {
  const { campaignId, answer, titles, inFlight } = props;
  const parts = answer.parts;
  const [bookPage, setBookPage] = useState<BookPage | null>(null);
  const openQuote = (bookId: Id<"lorekeeperBooks">, page: number) => setBookPage({ bookId, page, title: titles.get(bookId) ?? "Rulebook" });

  return (
    <article className="lk-a" aria-label="The Lorekeeper's answer" aria-busy={inFlight || undefined}>
      <MiniSigil />
      <div className="lk-ab">
        {parts ? (
          <span className={verdictClass(parts.verdict)}>
            <span aria-hidden="true">{VERDICT_COPY[parts.verdict].icon}</span>
            {VERDICT_COPY[parts.verdict].label}
          </span>
        ) : null}
        {answer.checkedAgain ? <span className="lk-retried">{RETRIED_NOTE}</span> : null}
        {answer.text ? <p>{answer.text}</p> : null}
        {(parts?.quotes ?? []).map((quote, index) => (
          <div key={`${index}:${quote.kind === "book" ? `${quote.bookId}:${quote.page}` : quote.title}`} className="lk-quotebox">
            <blockquote className="lk-quote">{quote.text}</blockquote>
            <div className="lk-cite">
              {quote.kind === "book" ? (
                <button
                  type="button"
                  className="lk-chip"
                  title="Open the page"
                  onClick={() => openQuote(quote.bookId, quote.page)}
                >
                  {quoteChip(quote, titles)}
                </button>
              ) : (
                <span className="lk-chip">{quoteChip(quote, titles)}</span>
              )}
              <span>{quoteSection(quote)}</span>
            </div>
          </div>
        ))}
        {parts?.call ? (
          <div className="lk-call">
            <span className="lk-lbl">{GM_CALL_LABEL}</span>
            <p>{parts.call}</p>
          </div>
        ) : null}
        {/* L12: the kept book answer is shown while the internet pass runs; its status stays under it. */}
        {inFlight && answer.phase === "web" ? <PhaseStatus phase="web" /> : null}
        {parts?.web && parts.web.length > 0 ? (
          <div className="lk-web">
            <div className="lk-disc">
              <span aria-hidden="true">⚠</span>
              <span>
                <strong>{WEB_DISCLAIMER_TITLE}</strong> {WEB_DISCLAIMER}
              </span>
            </div>
            {parts.web.map((result, index) => {
              const href = safeUrl(result.url);
              return (
                <div key={`${index}:${result.url}`} className="lk-res">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener nofollow">
                      <strong>{result.title}</strong>
                    </a>
                  ) : (
                    <strong>{result.title}</strong>
                  )}
                  <span className="d">{result.site}</span>
                  {result.snippet ? <p>{result.snippet}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {answer.status === "stopped" ? <span className="lk-retried">{STOPPED_TEXT}</span> : null}
        {answer.status === "done" || (answer.status === "stopped" && answer.text && !isStoppedEarly(answer)) ? (
          <Actions {...props} onOpenBook={() => {
            const quote = firstBookQuote(parts);
            if (quote) openQuote(quote.bookId, quote.page);
          }} />
        ) : null}
      </div>
      <BookDialog campaignId={campaignId} page={bookPage} onClose={() => setBookPage(null)} />
    </article>
  );
}

function Actions({ campaignId, answer, question, titles, isGm, mine, sentToGm, onOpenBook }: AnswerCardProps & { onOpenBook: () => void }) {
  const actions: AnswerAction[] = answer.status === "done" ? answerActions(answer, { isGm, mine, askedOfGm: sentToGm }) : ["copy"];
  const send = useMutation(api.lorekeeperAsks.send).withOptimisticUpdate((store, args) => askGmLocally(store, args));
  const [pinning, setPinning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  if (actions.length === 0 || isLocalMessage(answer._id)) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerCopyText(answer, titles));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the text instead.");
    }
  };

  return (
    <>
      <div className="lk-acts">
        {actions.map((action) => {
          switch (action) {
            case "copy":
              return (
                <button key={action} type="button" className="lk-act" onClick={copy}>
                  {ACTION_LABELS.copy}
                </button>
              );
            case "openInBook":
              return (
                <button key={action} type="button" className="lk-act" onClick={onOpenBook}>
                  {ACTION_LABELS.openInBook}
                </button>
              );
            case "pinRuling":
              return (
                <button key={action} type="button" className="lk-act" onClick={() => setPinning(true)}>
                  {ACTION_LABELS.pinRuling}
                </button>
              );
            case "askGm":
              return (
                <button
                  key={action}
                  type="button"
                  className="lk-act"
                  disabled={sentToGm}
                  onClick={async () => {
                    setError(null);
                    try {
                      await send({ campaignId, messageId: answer._id });
                    } catch (caught) {
                      setError(errorMessage(caught));
                    }
                  }}
                >
                  {sentToGm ? ASK_GM_SENT : ACTION_LABELS.askGm}
                </button>
              );
            case "showOnMap":
              return (
                <Link key={action} href={`/campaigns/${campaignId}/combat-map`} className="lk-act lk-actlink">
                  {ACTION_LABELS.showOnMap}
                </Link>
              );
          }
        })}
        <span role="status" className="lk-copied">
          {copied ? COPIED_TEXT : ""}
        </span>
      </div>
      {error ? (
        <p role="alert" className="lk-cardnote">
          {error}
        </p>
      ) : null}
      {pinning ? <PinDialog campaignId={campaignId} answerId={answer._id} draft={pinDraft(question, answer)} onClose={() => setPinning(false)} /> : null}
    </>
  );
}
