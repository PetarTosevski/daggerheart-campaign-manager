import { useMutation } from "convex/react";
import { Pressable, Text, View } from "react-native";

import {
  authorSuffix,
  BULLETS,
  bulletTip,
  glyphFor,
  isDimmed,
  isStruck,
  THREADS_COPY,
  threadPageLink,
} from "../../../../../src/lib/domain/notes";
import type { ThreadRow } from "../../../../../convex/notesThreads";
import { api, type Id } from "../../convex";
import { useOpenThreads } from "../journal/data";
import { EntryText } from "./mentions";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";


function ThreadRowView({
  campaignId,
  row,
  onCycle,
  onOpen,
}: {
  campaignId: Id<"campaigns">;
  row: ThreadRow;
  onCycle: () => void;
  onOpen: () => void;
}) {
  const spec = BULLETS[row.kind];
  const tip = bulletTip(row);
  const struck = isStruck(row);
  const textStyle = {
    ...(struck ? { textDecorationLine: "line-through" as const } : {}),
    ...(isDimmed(row) ? { opacity: struck ? 0.55 : 0.6 } : {}),
    ...(spec.textColor && !row.added ? { color: spec.textColor } : {}),
  };
  return (
    <View style={notesStyles.row}>
      <Pressable accessibilityLabel={tip} accessibilityRole="button" onPress={onCycle}>
        <Text style={{ color: spec.color, fontSize: 18 }}>{glyphFor(row)}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[notesStyles.line, textStyle]}>
          <EntryText campaignId={campaignId} text={row.text} />
          {row.added && row.authorLabel !== "" ? (
            <Text style={notesStyles.meta}>{authorSuffix(row.authorLabel)}</Text>
          ) : null}
        </Text>
        <Pressable accessibilityRole="button" onPress={onOpen}>
          <Text style={notesStyles.meta}>{threadPageLink(row.pageTitle)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ThreadsView({ campaignId, onPage }: NotesSlotProps) {
  // One `notesThreads.threads` for the Journal (its header button and Campaign so far read it too).
  const threads = useOpenThreads();
  const cycle = useMutation(api.notesEntries.cycle);
  return (
    <View accessibilityLabel={THREADS_COPY.title} style={notesStyles.paper}>
      <Text style={notesStyles.tape}>{THREADS_COPY.title}</Text>
      <Text style={notesStyles.line}>{THREADS_COPY.intro}</Text>
      {threads === undefined ? (
        <Text style={notesStyles.muted}>Loading …</Text>
      ) : threads.length === 0 ? (
        <Text style={notesStyles.line}>{THREADS_COPY.empty}</Text>
      ) : (
        threads.map((row) => (
          <ThreadRowView
            campaignId={campaignId}
            key={row._id}
            onCycle={() => void cycle({ campaignId, entryId: row._id })}
            onOpen={() => onPage(row.pageId, "page")}
            row={row}
          />
        ))
      )}
    </View>
  );
}
