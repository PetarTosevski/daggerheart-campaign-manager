"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useLayoutEffect, useRef, useState } from "react";

import { EMPTY_INTRO, NEW_CONVERSATION_LABEL, YOU_LABEL } from "@/lib/lorekeeper/copy";
import { askLocally, isLocalMessage, setVisibilityLocally, setWebSearchLocally, stopLocally } from "@/lib/optimistic/lorekeeper";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ConversationView, MessageView } from "../../../../convex/lorekeeper";
import type { ConversationVisibility } from "../../../../convex/lib/validators/lorekeeper";
import { AnswerCard, ThinkingRow } from "../answer/answer-card";
import type { BookTitles } from "../answer/model";
import { Composer } from "../composer/composer";
import { askFailure, disabledReason, usagePeriod } from "../composer/model";
import { askerNames } from "../conversations/names";
import { Sigil } from "../sigil";
import type { LorekeeperChatProps } from "../slots";
import { ChatBoundary } from "./boundary";
import { resolveSelection, useSelection } from "./selection";

/** Messages per page of history (newest first; 'Show earlier messages' loads more). */
const PAGE = 40;

type Pending = { question: string; conversationId?: Id<"lorekeeperConversations"> };
type Notice = { text: string; newConversation: boolean };
type AskFn = (question: string, target: { conversationId?: Id<"lorekeeperConversations">; webSearch: boolean; visibility: ConversationVisibility }) => Promise<boolean>;

/**
 * The chat column (D13 L6, board Lorekeeper.dc.html): the stream (role=log) and the composer, for the conversation
 * the 'Conversations' menu picked (../chat/selection.ts; by default the caller's most recent one). Holds what must
 * survive switching to the conversation a first question just created: the pending question and the last failure.
 */
export function ChatView({ campaignId, access, variant }: LorekeeperChatProps) {
  const available = useQuery(api.lorekeeper.available, { campaignId });
  const lists = useQuery(api.lorekeeper.listConversations, { campaignId });
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  const usage = useQuery(api.lorekeeperUsage.mine, { campaignId, ...usagePeriod(new Date()) });
  const asks = useQuery(api.lorekeeperAsks.mine, { campaignId });
  // The GM may pin an answer a player sent them (Ask the GM); players never read this list.
  const openAsks = useQuery(api.lorekeeperAsks.listOpen, access.isGm ? { campaignId } : "skip");
  const roster = useQuery(api.members.roster, { campaignId });
  const [selection, select] = useSelection(campaignId);
  const current = resolveSelection(selection, lists?.mine);
  const ask = useMutation(api.lorekeeper.ask).withOptimisticUpdate((store, args) => askLocally(store, args));
  const [pending, setPending] = useState<Pending | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [newWeb, setNewWeb] = useState(true);
  const [newVisibility, setNewVisibility] = useState<ConversationVisibility>("campaign");

  const titles: BookTitles = new Map((library?.books ?? []).map((book) => [book.bookId as string, book.title]));
  const sent = new Set([...(asks ?? []), ...(openAsks ?? [])].map((row) => row.messageId as string));
  const names = askerNames(roster);

  const askQuestion: AskFn = async (question, target) => {
    setNotice(null);
    setSending(true);
    if (target.conversationId === undefined) setPending({ question });
    try {
      const result = await ask({
        campaignId,
        question,
        webSearch: target.webSearch,
        ...(target.conversationId !== undefined ? { conversationId: target.conversationId } : { visibility: target.visibility }),
      });
      if (target.conversationId === undefined) {
        setPending({ question, conversationId: result.conversationId });
        select(result.conversationId);
      }
      return true;
    } catch (error) {
      setPending(null);
      setNotice(askFailure(error));
      return false;
    } finally {
      setSending(false);
    }
  };

  const startNew = () => {
    setNotice(null);
    select("new");
  };

  const shared = {
    campaignId,
    isGm: access.isGm,
    available,
    disabled: disabledReason(available, usage ?? undefined),
    questionsLeft: usage?.questionsLeft,
    titles,
    sent,
    names,
    pending,
    sending,
    notice,
    onAsk: askQuestion,
    onNewConversation: startNew,
    newWeb,
    setNewWeb,
    newVisibility,
    setNewVisibility,
  };

  return (
    <div className="lk-chatcol" data-variant={variant}>
      {current === undefined ? (
        <div className="lk-stream" role="log" aria-live="polite" aria-label="Conversation">
          <p role="status" className="lk-muted lk-loading">
            Loading…
          </p>
        </div>
      ) : (
        <ChatBoundary key={current} label="The conversation" action={{ label: NEW_CONVERSATION_LABEL, run: startNew }}>
          <ConversationPane {...shared} conversationId={current === "new" ? null : current} />
        </ChatBoundary>
      )}
    </div>
  );
}

type PaneProps = {
  campaignId: Id<"campaigns">;
  conversationId: Id<"lorekeeperConversations"> | null;
  isGm: boolean;
  available: boolean | undefined;
  disabled: string | null;
  questionsLeft: number | undefined;
  titles: BookTitles;
  sent: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
  pending: Pending | null;
  sending: boolean;
  notice: Notice | null;
  onAsk: AskFn;
  onNewConversation: () => void;
  newWeb: boolean;
  setNewWeb: (on: boolean) => void;
  newVisibility: ConversationVisibility;
  setNewVisibility: (next: ConversationVisibility) => void;
};

/** One conversation: its messages (paginated, newest first from the server, shown oldest first) and the composer. */
function ConversationPane(props: PaneProps) {
  const { campaignId, conversationId } = props;
  const conversation = useQuery(api.lorekeeper.getConversation, conversationId ? { campaignId, conversationId } : "skip");
  const history = usePaginatedQuery(api.lorekeeper.listMessages, conversationId ? { campaignId, conversationId } : "skip", { initialNumItems: PAGE });
  const stop = useMutation(api.lorekeeper.stop).withOptimisticUpdate((store, args) => {
    if (conversationId) stopLocally(store, args, conversationId);
  });
  const setWebSearch = useMutation(api.lorekeeper.setWebSearch).withOptimisticUpdate((store, args) => setWebSearchLocally(store, args));
  const setVisibility = useMutation(api.lorekeeper.setVisibility).withOptimisticUpdate((store, args) => setVisibilityLocally(store, args));

  const mine = conversation?.mine ?? false;
  const loading = conversationId !== null && (conversation === undefined || history.status === "LoadingFirstPage");
  const messages = [...history.results].reverse();
  const newest = history.results[0];
  const streamingAnswer = mine && newest?.role === "answer" && (newest.status === "pending" || newest.status === "streaming") ? newest : null;
  const showPending =
    props.pending !== null &&
    ((props.pending.conversationId === undefined && conversationId === null) || (props.pending.conversationId === conversationId && loading));

  // The composer asks in this conversation when it is the caller's; otherwise (new, or another member's) it starts one.
  const target = mine && conversation ? { conversationId: conversation._id, webSearch: conversation.webSearch, visibility: conversation.visibility } : null;
  const webSearch = target ? target.webSearch : props.newWeb;
  const visibility = target ? target.visibility : props.newVisibility;

  return (
    <>
      <Stream
        {...props}
        conversation={conversation ?? null}
        messages={messages}
        loading={loading}
        showPending={showPending}
        canLoadMore={history.status === "CanLoadMore"}
        onLoadMore={() => history.loadMore(PAGE)}
        onRetry={
          target
            ? (question) => void props.onAsk(question, { conversationId: target.conversationId, webSearch, visibility })
            : undefined
        }
      />
      <Composer
        disabled={props.disabled}
        questionsLeft={props.questionsLeft}
        streaming={streamingAnswer !== null}
        sending={props.sending}
        onAsk={(question) => props.onAsk(question, { ...(target ? { conversationId: target.conversationId } : {}), webSearch, visibility })}
        onStop={
          streamingAnswer && !isLocalMessage(streamingAnswer._id)
            ? () => void stop({ campaignId, answerId: streamingAnswer._id })
            : undefined
        }
        webSearch={webSearch}
        onWebSearch={(on) => {
          if (target) void setWebSearch({ campaignId, conversationId: target.conversationId, webSearch: on });
          else props.setNewWeb(on);
        }}
        visibility={{
          value: visibility,
          onChange: (next) => {
            if (target) void setVisibility({ campaignId, conversationId: target.conversationId, visibility: next });
            else props.setNewVisibility(next);
          },
        }}
        notice={props.notice}
        onNewConversation={props.onNewConversation}
      />
    </>
  );
}

function Stream(
  props: PaneProps & {
    conversation: ConversationView | null;
    messages: MessageView[];
    loading: boolean;
    showPending: boolean;
    canLoadMore: boolean;
    onLoadMore: () => void;
    onRetry?: (question: string) => void;
  },
) {
  const { messages, conversation, loading, showPending } = props;
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  // Only drives the 'Jump to latest' button; set from the scroll event handler, never from an effect.
  const [away, setAway] = useState(false);
  const last = messages[messages.length - 1];
  const mine = conversation?.mine ?? false;
  const asker = mine ? YOU_LABEL : conversation ? (props.names.get(conversation.userId) ?? "A player") : YOU_LABEL;

  // What was last seen at the end of the log, so an arrival can be told from an answer growing. A ref, not state.
  const seen = useRef<{ id?: string; live: boolean; pending: boolean; loading: boolean } | null>(null);

  // LK2: an arrival (open or conversation switch, a new question or answer, the pending question, an answer starting
  // to stream) always brings the log to its end, even if the reader had scrolled up. Between arrivals the stream is
  // followed only while the reader is at the bottom; after scrolling up, 'Jump to latest' returns. DOM only, no state.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = last?._id as string | undefined;
    const live = last?.status === "streaming";
    const before = seen.current;
    const arrived =
      before === null || before.id !== id || before.pending !== showPending || before.loading !== loading || (live && !before.live);
    seen.current = { id, live: live || (before !== null && before.id === id && before.live), pending: showPending, loading };
    if (arrived) stuck.current = true;
    if (stuck.current) el.scrollTop = el.scrollHeight;
  }, [last?._id, last?.text.length, last?.status, showPending, loading]);

  const empty = !loading && messages.length === 0 && !showPending;

  return (
    <div className="lk-streamwrap">
    <div
      ref={ref}
      className="lk-stream"
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      onScroll={(event) => {
        const el = event.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        stuck.current = atBottom;
        setAway(!atBottom);
      }}
    >
      {props.canLoadMore ? (
        <button type="button" className="lk-act lk-act-dark lk-earlier" onClick={props.onLoadMore}>
          Show earlier messages
        </button>
      ) : null}
      {loading && !showPending ? (
        <p role="status" className="lk-muted lk-loading">
          Loading…
        </p>
      ) : null}
      {empty ? (
        <div className="lk-intro">
          <Sigil />
          {/* dcm-bxp.82.10: 'not set up' is said once, by the composer's notice; the intro then has no text. */}
          {props.available === false ? null : <p className="lk-muted">{EMPTY_INTRO}</p>}
        </div>
      ) : null}
      {messages.map((message, index) => {
        if (message.role === "question") {
          return (
            <div key={message._id} className="lk-q">
              <span className="lk-who">{asker}</span>
              <div className="lk-qb">{message.text}</div>
            </div>
          );
        }
        const before = messages[index - 1];
        const question = before?.role === "question" ? before.text : "";
        return (
          <AnswerCard
            key={message._id}
            campaignId={props.campaignId}
            answer={message}
            question={question}
            titles={props.titles}
            isGm={props.isGm}
            mine={mine}
            sentToGm={props.sent.has(message._id)}
            onRetry={props.onRetry && question ? () => props.onRetry?.(question) : undefined}
          />
        );
      })}
      {showPending && props.pending ? (
        <>
          <div className="lk-q">
            <span className="lk-who">{YOU_LABEL}</span>
            <div className="lk-qb">{props.pending.question}</div>
          </div>
          <ThinkingRow />
        </>
      ) : null}
    </div>
      {away ? (
        <button
          type="button"
          className="lk-act lk-act-dark lk-jump"
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            stuck.current = true;
            el.scrollTop = el.scrollHeight;
            setAway(false);
          }}
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}