import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import { configMessages } from "../../../../../src/lib/errors/config";
import { EMPTY_INTRO, NEW_CONVERSATION_LABEL, YOU_LABEL } from "../../../../../src/lib/lorekeeper/copy";
import type { ConversationView, MessageView } from "../../../../../convex/lorekeeper";
import type { ConversationVisibility } from "../../../../../convex/lib/validators/lorekeeper";
import { api, type Id } from "../../convex";
import { AnswerCard, ThinkingRow } from "./answer-card";
import type { BookTitles } from "../../../../../src/lib/lorekeeper/answer-model";
import { askFailure, disabledReason, usagePeriod } from "../../../../../src/lib/lorekeeper/composer-model";
import { Composer } from "./composer";
import { askerNames } from "../../../../../src/lib/lorekeeper/names";
import { resolveSelection, useSelection } from "./selection";
import type { LorekeeperChatProps } from "./slots";
import { lkStyles } from "./styles";

const PAGE = 40;

type Pending = { question: string; conversationId?: Id<"lorekeeperConversations"> };
type Notice = { text: string; newConversation: boolean };
type AskFn = (
  question: string,
  target: { conversationId?: Id<"lorekeeperConversations">; webSearch: boolean; visibility: ConversationVisibility },
) => Promise<boolean>;

export function LorekeeperChat(props: LorekeeperChatProps) {
  const { campaignId, access } = props;
  const available = useQuery(api.lorekeeper.available, { campaignId });
  // Config L1 / U4 (as on the website): who may ask and whether the internet pass is allowed in this campaign (live).
  const rules = useQuery(api.lorekeeper.access, { campaignId });
  // Config AF1: the admin's Lorekeeper internet search switch. On the phone the toggle stays hidden until both the
  // campaign and the switch say yes (loading counts as off).
  const flags = useQuery(api.features.mine, {});
  const lists = useQuery(api.lorekeeper.listConversations, { campaignId });
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  const usage = useQuery(api.lorekeeperUsage.mine, { campaignId, ...usagePeriod(new Date()) });
  const asks = useQuery(api.lorekeeperAsks.mine, { campaignId });
  const openAsks = useQuery(api.lorekeeperAsks.listOpen, access.isGm ? { campaignId } : "skip");
  const roster = useQuery(api.members.roster, { campaignId });
  const [selection, select] = useSelection(campaignId);
  const current = resolveSelection(selection, lists?.mine);
  const ask = useMutation(api.lorekeeper.ask);
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
    disabled:
      available !== false && rules?.canAsk === false ? configMessages.LOREKEEPER_GM_ONLY : disabledReason(available, usage ?? undefined),
    webAllowed: rules?.webAllowed === true && flags?.lorekeeperWeb === true,
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

  if (current === undefined) {
    return (
      <View style={lkStyles.chatCol}>
        <Text style={lkStyles.muted}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={lkStyles.chatCol}>
      <ConversationPane {...shared} conversationId={current === "new" ? null : current} />
    </View>
  );
}

type PaneProps = {
  campaignId: Id<"campaigns">;
  conversationId: Id<"lorekeeperConversations"> | null;
  isGm: boolean;
  available: boolean | undefined;
  disabled: string | null;
  webAllowed: boolean;
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

function ConversationPane(props: PaneProps) {
  const { campaignId, conversationId } = props;
  const conversation = useQuery(api.lorekeeper.getConversation, conversationId ? { campaignId, conversationId } : "skip");
  const history = usePaginatedQuery(
    api.lorekeeper.listMessages,
    conversationId ? { campaignId, conversationId } : "skip",
    { initialNumItems: PAGE },
  );
  const stop = useMutation(api.lorekeeper.stop);
  const setWebSearch = useMutation(api.lorekeeper.setWebSearch);
  const setVisibility = useMutation(api.lorekeeper.setVisibility);

  const mine = conversation?.mine ?? false;
  const loading = conversationId !== null && (conversation === undefined || history.status === "LoadingFirstPage");
  const messages = [...history.results].reverse();
  const newest = history.results[0];
  const streamingAnswer =
    mine && newest?.role === "answer" && (newest.status === "pending" || newest.status === "streaming") ? newest : null;
  const showPending =
    props.pending !== null &&
    ((props.pending.conversationId === undefined && conversationId === null) ||
      (props.pending.conversationId === conversationId && loading));

  const target = mine && conversation ? { conversationId: conversation._id, webSearch: conversation.webSearch, visibility: conversation.visibility } : null;
  // With the internet pass not allowed, asks never request it (the server skips it either way).
  const webSearch = props.webAllowed && (target ? target.webSearch : props.newWeb);
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
        notice={props.notice}
        onAsk={(question) => props.onAsk(question, { ...(target ? { conversationId: target.conversationId } : {}), webSearch, visibility })}
        onNewConversation={props.onNewConversation}
        onStop={streamingAnswer ? () => void stop({ campaignId, answerId: streamingAnswer._id }) : undefined}
        onWebSearch={(on) => {
          if (target) void setWebSearch({ campaignId, conversationId: target.conversationId, webSearch: on });
          else props.setNewWeb(on);
        }}
        questionsLeft={props.questionsLeft}
        sending={props.sending}
        streaming={streamingAnswer !== null}
        visibility={{
          value: visibility,
          onChange: (next) => {
            if (target) void setVisibility({ campaignId, conversationId: target.conversationId, visibility: next });
            else props.setNewVisibility(next);
          },
        }}
        webAllowed={props.webAllowed}
        webSearch={webSearch}
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
  const listRef = useRef<FlatList<MessageView | "pending">>(null);
  const mine = conversation?.mine ?? false;
  const asker = mine ? YOU_LABEL : conversation ? (props.names.get(conversation.userId) ?? "A player") : YOU_LABEL;
  const empty = !loading && messages.length === 0 && !showPending;
  const data: (MessageView | "pending")[] = showPending && props.pending ? [...messages, "pending"] : messages;

  return (
    <View style={lkStyles.stream}>
      {props.canLoadMore ? (
        <Pressable accessibilityRole="button" onPress={props.onLoadMore}>
          <Text style={lkStyles.muted}>Show earlier messages</Text>
        </Pressable>
      ) : null}
      {loading && !showPending ? <Text style={lkStyles.muted}>Loading…</Text> : null}
      {empty ? (
        <View>
          {props.available === false ? null : <Text style={lkStyles.muted}>{EMPTY_INTRO}</Text>}
        </View>
      ) : null}
      <FlatList
        ref={listRef}
        contentContainerStyle={lkStyles.streamContent}
        data={data}
        keyExtractor={(item, index) => (item === "pending" ? "pending" : item._id)}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item, index }) => {
          if (item === "pending" && props.pending) {
            return (
              <View>
                <View style={lkStyles.question}>
                  <Text style={lkStyles.who}>{YOU_LABEL}</Text>
                  <Text style={lkStyles.questionText}>{props.pending.question}</Text>
                </View>
                <ThinkingRow />
              </View>
            );
          }
          if (item === "pending") return null;
          const message = item;
          if (message.role === "question") {
            return (
              <View style={lkStyles.question}>
                <Text style={lkStyles.who}>{asker}</Text>
                <Text style={lkStyles.questionText}>{message.text}</Text>
              </View>
            );
          }
          const msgIndex = messages.findIndex((row) => row._id === message._id);
          const before = msgIndex > 0 ? messages[msgIndex - 1] : undefined;
          const question = before?.role === "question" ? before.text : "";
          return (
            <AnswerCard
              answer={message}
              campaignId={props.campaignId}
              isGm={props.isGm}
              mine={mine}
              onRetry={props.onRetry && question ? () => props.onRetry?.(question) : undefined}
              question={question}
              sentToGm={props.sent.has(message._id)}
              titles={props.titles}
            />
          );
        }}
      />
      <Pressable accessibilityRole="button" onPress={props.onNewConversation}>
        <Text style={lkStyles.muted}>{NEW_CONVERSATION_LABEL}</Text>
      </Pressable>
    </View>
  );
}
