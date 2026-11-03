import { useState } from "react";
import { Text, TextInput, View } from "react-native";

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
} from "../../../../../src/lib/lorekeeper/copy";
import type { ConversationVisibility } from "../../../../../convex/lib/validators/lorekeeper";
import { Button } from "../../ui/button";
import { QUESTION_MAX, counterText } from "./composer-model";
import { lkStyles } from "./styles";

const LEFT_FROM = 10;

export type ComposerProps = {
  disabled: string | null;
  questionsLeft?: number;
  streaming: boolean;
  sending: boolean;
  onAsk: (question: string) => Promise<boolean>;
  onStop?: () => void;
  webSearch: boolean;
  onWebSearch: (on: boolean) => void;
  visibility: { value: ConversationVisibility; onChange: (next: ConversationVisibility) => void } | null;
  notice: { text: string; newConversation: boolean } | null;
  onNewConversation: () => void;
};

export function Composer(props: ComposerProps) {
  const { disabled, questionsLeft, streaming, sending, onAsk, onStop, webSearch, onWebSearch, visibility, notice, onNewConversation } =
    props;
  const [draft, setDraft] = useState("");
  const blocked = disabled !== null || streaming || sending;
  const counter = counterText(draft.length);
  const showLeft = questionsLeft !== undefined && questionsLeft <= LEFT_FROM;

  const send = async (text: string) => {
    const question = text.trim();
    if (question.length === 0 || question.length > QUESTION_MAX || blocked) return;
    const typed = text === draft;
    if (typed) setDraft("");
    const ok = await onAsk(question);
    if (!ok && typed) setDraft((now) => (now === "" ? text : now));
  };

  return (
    <View accessibilityLabel="Ask the Lorekeeper" style={lkStyles.compose}>
      {disabled !== null ? (
        <View accessibilityRole="alert" style={lkStyles.notice}>
          <Text>{disabled}</Text>
          {showLeft ? <Text>{questionsLeftLabel(Math.max(0, questionsLeft ?? 0))}</Text> : null}
        </View>
      ) : null}
      <View style={lkStyles.sugRow}>
        {SUGGESTIONS.map((suggestion) => (
          <Button key={suggestion.key} disabled={blocked} onPress={() => void send(suggestion.question)} variant="outline">
            {suggestion.label}
          </Button>
        ))}
      </View>
      <TextInput
        accessibilityLabel={COMPOSER_LABEL}
        editable={disabled === null}
        maxLength={QUESTION_MAX}
        multiline
        onChangeText={setDraft}
        placeholder={COMPOSER_PLACEHOLDER}
        placeholderTextColor={lkStyles.muted.color}
        style={lkStyles.input}
        value={draft}
      />
      {counter ? <Text style={lkStyles.muted}>{counter}</Text> : null}
      <View style={lkStyles.acts}>
        {streaming ? (
          <Button accessibilityLabel={STOP_LABEL} disabled={!onStop} onPress={() => onStop?.()}>
            {STOP_LABEL}
          </Button>
        ) : (
          <Button disabled={blocked} onPress={() => void send(draft)}>
            {ASK_LABEL}
          </Button>
        )}
      </View>
      <Text style={lkStyles.muted}>{WEB_TOGGLE_LABEL}</Text>
      <View accessibilityLabel={WEB_TOGGLE_GROUP_LABEL} style={lkStyles.acts}>
        <Button onPress={() => onWebSearch(true)} variant={webSearch ? "primary" : "outline"}>
          {WEB_TOGGLE_ON}
        </Button>
        <Button onPress={() => onWebSearch(false)} variant={!webSearch ? "primary" : "outline"}>
          {WEB_TOGGLE_OFF}
        </Button>
        {visibility ? (
          <Button
            onPress={() => visibility.onChange(visibility.value === "private" ? "campaign" : "private")}
            variant="outline"
          >
            {visibility.value === "private" ? VISIBILITY_PRIVATE : VISIBILITY_PUBLIC}
          </Button>
        ) : null}
      </View>
      {disabled === null && (notice || showLeft) ? (
        <View accessibilityRole={notice ? "alert" : "text"} style={lkStyles.notice}>
          {notice ? <Text>{notice.text}</Text> : null}
          {showLeft ? <Text>{questionsLeftLabel(Math.max(0, questionsLeft ?? 0))}</Text> : null}
          {notice?.newConversation ? (
            <Button onPress={onNewConversation} variant="outline">
              Start a new conversation
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
