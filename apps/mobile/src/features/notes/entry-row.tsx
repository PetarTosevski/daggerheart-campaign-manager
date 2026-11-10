import { useRef } from "react";
import { Pressable, Text, View } from "react-native";

import {
  authorSuffix,
  BULLETS,
  bulletTip,
  glyphFor,
  isDimmed,
  isStruck,
  matches,
  toPlainText,
} from "../../../../../src/lib/domain/notes";
import type { Id } from "../../convex";
import type { EntryRow as Row } from "../../../../../convex/notesEntries";
import { EntryText, MentionInput } from "./mentions";
import { notesStyles } from "./styles";

export type RowActions = {
  cycle: (entryId: Id<"journalEntries">) => void;
  toggleStar: (entryId: Id<"journalEntries">) => void;
  moveUp: (entryId: Id<"journalEntries">) => void;
  remove: (entryId: Id<"journalEntries">) => void;
  saveText: (entryId: Id<"journalEntries">, text: string) => void;
};

export function EntryRowView({
  campaignId,
  row,
  first,
  search,
  editing,
  onEdit,
  actions,
}: {
  campaignId: Id<"campaigns">;
  row: Row;
  first: boolean;
  search: string;
  editing: boolean;
  onEdit: (entryId: Id<"journalEntries"> | null) => void;
  actions: RowActions;
}) {
  const spec = BULLETS[row.kind];
  const pending = false;
  const saved = useRef(false);
  const hit = search.trim() !== "" && matches(toPlainText(row.text), search);
  const struck = isStruck(row);
  const textStyle = {
    ...(struck ? { textDecorationLine: "line-through" as const } : {}),
    ...(isDimmed(row) ? { opacity: struck ? 0.55 : 0.6 } : {}),
    ...(spec.textColor && !row.added ? { color: spec.textColor } : {}),
  };
  const hasActions = row.canStar || row.canEdit || row.canMove || row.canDelete;

  function save(text: string) {
    if (saved.current) return;
    saved.current = true;
    onEdit(null);
    const next = text.trim();
    if (next && next !== row.text) actions.saveText(row._id, next);
  }

  return (
    <View style={[notesStyles.row, hit ? { backgroundColor: "rgba(227,180,90,0.15)" } : undefined]}>
      <Pressable
        accessibilityLabel={bulletTip(row)}
        accessibilityRole="button"
        accessibilityState={{ disabled: !row.canCycle }}
        disabled={!row.canCycle}
        onPress={() => row.canCycle && actions.cycle(row._id)}
      >
        <Text style={{ color: spec.color, fontSize: 18 }}>{glyphFor(row)}</Text>
      </Pressable>
      {editing ? (
        <MentionInput
          autoFocus
          campaignId={campaignId}
          defaultValue={row.text}
          label="Edit entry"
          onBlurText={save}
          onCancel={() => onEdit(null)}
          onSubmit={save}
          placeholder="Edit entry"
        />
      ) : (
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[notesStyles.line, textStyle]}>
            <EntryText campaignId={campaignId} text={row.text} />
            {row.added && row.authorLabel !== "" ? (
              <Text style={notesStyles.meta}>{authorSuffix(row.authorLabel)}</Text>
            ) : null}
          </Text>
          {hasActions ? (
            <View style={notesStyles.toolbar}>
              {row.canStar ? (
                <Pressable accessibilityRole="button" onPress={() => actions.toggleStar(row._id)}>
                  <Text style={notesStyles.chip}>{row.star ? "★" : "☆"}</Text>
                </Pressable>
              ) : null}
              {row.canEdit ? (
                <Pressable accessibilityRole="button" onPress={() => onEdit(row._id)}>
                  <Text style={notesStyles.chip}>Edit</Text>
                </Pressable>
              ) : null}
              {row.canMove && !first ? (
                <Pressable accessibilityRole="button" onPress={() => actions.moveUp(row._id)}>
                  <Text style={notesStyles.chip}>Up</Text>
                </Pressable>
              ) : null}
              {row.canDelete ? (
                <Pressable accessibilityRole="button" onPress={() => actions.remove(row._id)}>
                  <Text style={notesStyles.chip}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {pending ? <Text style={notesStyles.muted}>Saving…</Text> : null}
        </View>
      )}
    </View>
  );
}
