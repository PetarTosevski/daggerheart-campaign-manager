import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

import {
  countMentions,
  formatToken,
  MAX_MENTIONS,
  parseTokens,
  renderParts,
  type TextPart,
} from "../../../../../src/lib/domain/notes";
import { api, type Id } from "../../convex";
import { Sheet } from "../../ui/sheet";
import { notesStyles } from "./styles";

type CodexRef = { _id: string; kind: "character" | "location"; name: string; role: string };

function displayName(ref: Pick<CodexRef, "kind" | "name">): string {
  return ref.name.trim() || (ref.kind === "location" ? "Unnamed location" : "Unnamed character");
}

function roleTip(ref: Pick<CodexRef, "kind" | "role">): string {
  return ref.role.trim() || (ref.kind === "location" ? "Location" : "Character");
}

function pickerOptions(entries: readonly CodexRef[], query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  const ranked: { rank: number; option: { id: string; name: string; kind: "character" | "location"; tip: string } }[] =
    [];
  for (const e of entries) {
    const name = e.name.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const rank = lower.startsWith(q) ? 0 : lower.split(/[\s,'’-]+/).some((word) => word.startsWith(q)) ? 1 : -1;
    if (rank < 0) continue;
    ranked.push({ rank, option: { id: e._id, name, kind: e.kind, tip: roleTip(e) } });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.option.name.localeCompare(b.option.name));
  return ranked.slice(0, limit).map((r) => r.option);
}

function visibleRefs(entries: readonly CodexRef[], ids: ReadonlySet<string>) {
  const refs = new Map<string, { name: string; kind: "character" | "location"; role: string }>();
  for (const e of entries) {
    if (ids.has(e._id)) refs.set(e._id, { name: displayName(e), kind: e.kind, role: e.role });
  }
  return refs;
}

export function EntryText({ campaignId, text }: { campaignId: Id<"campaigns">; text: string }) {
  const parts = parseTokens(text);
  if (!parts.some((p) => p.type === "mention")) return <Text style={notesStyles.line}>{text}</Text>;
  return <MentionedText campaignId={campaignId} parts={parts} />;
}

function MentionedText({ campaignId, parts }: { campaignId: Id<"campaigns">; parts: TextPart[] }) {
  const data = useQuery(api.codex.list, { campaignId });
  const router = useRouter();
  const ids = new Set(parts.flatMap((p) => (p.type === "mention" ? [p.id] : [])));
  const rendered = renderParts(parts, data === undefined ? new Map() : visibleRefs(data.entries, ids));
  return (
    <Text style={notesStyles.line}>
      {rendered.map((p, i) =>
        p.type === "text" ? (
          <Text key={i}>{p.text}</Text>
        ) : (
          <Text
            accessibilityRole="link"
            key={i}
            onPress={() => router.push(`/campaign/${campaignId}/codex/${p.id}`)}
            style={{ color: "#5a4a2a", textDecorationLine: "underline" }}
          >
            {p.text}
          </Text>
        ),
      )}
    </Text>
  );
}

export function MentionInput({
  campaignId,
  label,
  placeholder,
  defaultValue = "",
  autoFocus,
  onSubmit,
  onCancel,
  onBlurText,
}: {
  campaignId: Id<"campaigns">;
  label: string;
  placeholder: string;
  defaultValue?: string;
  autoFocus?: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  onBlurText?: (text: string) => void;
}) {
  const entries = useQuery(api.codex.list, { campaignId });
  const [value, setValue] = useState(defaultValue);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");

  const atMatch = useMemo(() => /(?:^|\s)@([^\s@]*)$/.exec(value), [value]);
  const options = useMemo(() => {
    if (!atMatch || entries === undefined) return [];
    return pickerOptions(entries.entries, atMatch[1] ?? "");
  }, [atMatch, entries]);

  function insertMention(name: string, id: string) {
    if (countMentions(value) >= MAX_MENTIONS) return;
    const prefix = atMatch ? value.slice(0, atMatch.index + (atMatch[0].startsWith(" ") ? 1 : 0)) : value;
    const token = formatToken(name, id);
    const next = `${prefix}${token} `;
    setValue(next);
    setPickerOpen(false);
    setMentionQuery("");
  }

  function onChangeText(text: string) {
    setValue(text);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
    if (match) {
      setMentionQuery(match[1] ?? "");
      setPickerOpen(true);
    } else {
      setPickerOpen(false);
    }
  }

  return (
    <View style={{ flex: 1, gap: 4 }}>
      <TextInput
        accessibilityLabel={label}
        autoFocus={autoFocus}
        multiline
        onBlur={() => onBlurText?.(value)}
        onChangeText={onChangeText}
        onSubmitEditing={() => onSubmit(value.trim())}
        placeholder={placeholder}
        placeholderTextColor={notesStyles.muted.color}
        returnKeyType="done"
        style={[notesStyles.pageTitle, { minHeight: 44 }]}
        value={value}
      />
      {onCancel ? (
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text style={notesStyles.chip}>Cancel</Text>
        </Pressable>
      ) : null}
      <Sheet onClose={() => setPickerOpen(false)} open={pickerOpen && options.length > 0} title="Mention">
        <ScrollView style={{ maxHeight: 240 }}>
          {countMentions(value) >= MAX_MENTIONS ? (
            <Text style={notesStyles.muted}>This entry already has the maximum mentions.</Text>
          ) : (
            options.map((opt) => (
              <Pressable key={opt.id} onPress={() => insertMention(opt.name, opt.id)} style={{ paddingVertical: 8 }}>
                <Text style={notesStyles.line}>{opt.name}</Text>
                <Text style={notesStyles.muted}>{opt.tip}</Text>
              </Pressable>
            ))
          )}
          {mentionQuery && options.length === 0 ? (
            <Text style={notesStyles.muted}>No matches for @{mentionQuery}</Text>
          ) : null}
        </ScrollView>
      </Sheet>
    </View>
  );
}
