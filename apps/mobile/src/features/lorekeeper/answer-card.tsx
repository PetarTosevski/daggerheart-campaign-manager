import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Share, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { lorekeeperMessages } from "../../../../../src/lib/errors/lorekeeper";
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
} from "../../../../../src/lib/lorekeeper/copy";
import type { MessageView } from "../../../../../convex/lorekeeper";
import { api, type Id } from "../../convex";
import {
  type AnswerAction,
  type BookTitles,
  answerActions,
  answerCopyText,
  firstBookQuote,
  isLocalMessage,
  isStoppedEarly,
  pinDraft,
  quoteChip,
  quoteSection,
  safeUrl,
  verdictTone,
} from "../../../../../src/lib/lorekeeper/answer-model";
import { BookSheet, type BookPage } from "./book-sheet";
import { PinSheet } from "./pin-sheet";
import { MiniSigil } from "./sigil";
import { lkStyles } from "./styles";

export const STOPPED_TEXT = "Stopped.";
export const SHARED_TEXT = "Shared";

export type AnswerCardProps = {
  campaignId: Id<"campaigns">;
  answer: MessageView;
  question: string;
  titles: BookTitles;
  isGm: boolean;
  mine: boolean;
  sentToGm: boolean;
  onRetry?: () => void;
};

export function ThinkingRow({ phase = "books" }: { phase?: MessageView["phase"] }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <MiniSigil />
      <Text accessibilityLiveRegion="polite" style={lkStyles.muted}>
        {PHASE_TEXT[phase]}
      </Text>
    </View>
  );
}

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
    <View accessibilityLabel="The Lorekeeper's answer" style={lkStyles.answer}>
      <MiniSigil />
      <Text style={lkStyles.answerInk}>{text}</Text>
      {onRetry ? (
        <View style={lkStyles.acts}>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={lkStyles.muted}>{TRY_AGAIN_LABEL}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ParchmentCard(props: AnswerCardProps & { inFlight: boolean }) {
  const { campaignId, answer, titles, inFlight } = props;
  const parts = answer.parts;
  const [bookPage, setBookPage] = useState<BookPage | null>(null);
  const openQuote = (bookId: Id<"lorekeeperBooks">, page: number) =>
    setBookPage({ bookId, page, title: titles.get(bookId) ?? "Rulebook" });
  const tone = parts ? verdictTone(parts.verdict) : "ok";
  const pillStyle = tone === "ok" ? lkStyles.pillOk : tone === "amber" ? lkStyles.pillAmber : lkStyles.pillRed;

  return (
    <View accessibilityLabel="The Lorekeeper's answer" style={lkStyles.answer}>
      <MiniSigil />
      {parts ? (
        <Text style={[lkStyles.verdict, pillStyle]}>
          {VERDICT_COPY[parts.verdict].icon} {VERDICT_COPY[parts.verdict].label}
        </Text>
      ) : null}
      {answer.checkedAgain ? <Text style={lkStyles.muted}>{RETRIED_NOTE}</Text> : null}
      {answer.text ? <Text style={lkStyles.answerInk}>{answer.text}</Text> : null}
      {(parts?.quotes ?? []).map((quote, index) => (
        <View key={`${index}:${quote.kind === "book" ? `${quote.bookId}:${quote.page}` : quote.title}`}>
          <Text style={lkStyles.answerInk}>{quote.text}</Text>
          {quote.kind === "book" ? (
            <Pressable accessibilityRole="button" onPress={() => openQuote(quote.bookId, quote.page)}>
              <Text style={lkStyles.muted}>{quoteChip(quote, titles)}</Text>
            </Pressable>
          ) : (
            <Text style={lkStyles.muted}>{quoteChip(quote, titles)}</Text>
          )}
          <Text style={lkStyles.muted}>{quoteSection(quote)}</Text>
        </View>
      ))}
      {parts?.call ? (
        <View>
          <Text style={lkStyles.muted}>{GM_CALL_LABEL}</Text>
          <Text style={lkStyles.answerInk}>{parts.call}</Text>
        </View>
      ) : null}
      {inFlight && answer.phase === "web" ? <ThinkingRow phase="web" /> : null}
      {parts?.web && parts.web.length > 0 ? (
        <View>
          <Text style={lkStyles.muted}>
            {WEB_DISCLAIMER_TITLE} {WEB_DISCLAIMER}
          </Text>
          {parts.web.map((result, index) => {
            const href = safeUrl(result.url);
            return (
              <View key={`${index}:${result.url}`}>
                {href ? (
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(href)}>
                    <Text style={lkStyles.answerInk}>{result.title}</Text>
                  </Pressable>
                ) : (
                  <Text style={lkStyles.answerInk}>{result.title}</Text>
                )}
                <Text style={lkStyles.muted}>{result.site}</Text>
                {result.snippet ? <Text style={lkStyles.answerInk}>{result.snippet}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {answer.status === "stopped" ? <Text style={lkStyles.muted}>{STOPPED_TEXT}</Text> : null}
      {answer.status === "done" || (answer.status === "stopped" && answer.text && !isStoppedEarly(answer)) ? (
        <Actions
          {...props}
          onOpenBook={() => {
            const quote = firstBookQuote(parts);
            if (quote) openQuote(quote.bookId, quote.page);
          }}
        />
      ) : null}
      <BookSheet campaignId={campaignId} onClose={() => setBookPage(null)} page={bookPage} />
    </View>
  );
}

function Actions({ campaignId, answer, question, titles, isGm, mine, sentToGm, onOpenBook }: AnswerCardProps & { onOpenBook: () => void }) {
  const router = useRouter();
  const actions: AnswerAction[] = answer.status === "done" ? answerActions(answer, { isGm, mine, askedOfGm: sentToGm }) : ["copy"];
  const send = useMutation(api.lorekeeperAsks.send);
  const [pinning, setPinning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (actions.length === 0 || isLocalMessage(answer._id)) return null;

  // React Native has no clipboard API: Copy opens the system share sheet, which offers Copy among its targets.
  const copy = async () => {
    setError(null);
    try {
      const result = await Share.share({ message: answerCopyText(answer, titles) });
      if (result.action !== Share.sharedAction) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't share. Select the text instead.");
    }
  };

  return (
    <>
      <View style={lkStyles.acts}>
        {actions.map((action) => {
          switch (action) {
            case "copy":
              return (
                <Pressable key={action} accessibilityRole="button" onPress={() => void copy()}>
                  <Text style={lkStyles.muted}>{ACTION_LABELS.copy}</Text>
                </Pressable>
              );
            case "openInBook":
              return (
                <Pressable key={action} accessibilityRole="button" onPress={onOpenBook}>
                  <Text style={lkStyles.muted}>{ACTION_LABELS.openInBook}</Text>
                </Pressable>
              );
            case "pinRuling":
              return (
                <Pressable key={action} accessibilityRole="button" onPress={() => setPinning(true)}>
                  <Text style={lkStyles.muted}>{ACTION_LABELS.pinRuling}</Text>
                </Pressable>
              );
            case "askGm":
              return (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  disabled={sentToGm}
                  onPress={async () => {
                    setError(null);
                    try {
                      await send({ campaignId, messageId: answer._id });
                    } catch (caught) {
                      setError(errorMessage(caught));
                    }
                  }}
                >
                  <Text style={lkStyles.muted}>{sentToGm ? ASK_GM_SENT : ACTION_LABELS.askGm}</Text>
                </Pressable>
              );
            case "showOnMap":
              return (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  onPress={() => router.push(`/campaign/${campaignId}/combat-map`)}
                >
                  <Text style={lkStyles.muted}>{ACTION_LABELS.showOnMap}</Text>
                </Pressable>
              );
          }
        })}
        {copied ? <Text style={lkStyles.muted}>{SHARED_TEXT}</Text> : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={lkStyles.muted}>
          {error}
        </Text>
      ) : null}
      <PinSheet
        answerId={answer._id}
        campaignId={campaignId}
        draft={pinDraft(question, answer)}
        onClose={() => setPinning(false)}
        open={pinning}
      />
    </>
  );
}
