import { useMutation, useQuery } from "convex/react";
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
  threadsButtonLabel,
} from "../../../../../src/lib/domain/notes";
import type { ThreadRow } from "../../../../../convex/notesThreads";
import { api, type Id } from "../../convex";
import { EntryText } from "./mentions";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";

function useThreads(campaignId: Id<"campaigns">) {
  return useQuery(api.notesThreads.threads, { campaignId });
}

export function ThreadsButton({ campaignId, view, onView }: NotesSlotProps) {
  const threads = useThreads(campaignId);
  const on = view === "threads";
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onView(on ? "page" : "threads")}>
      <Text style={notesStyles.chip}>
        {threads === undefined ? "Open threads · …" : threadsButtonLabel(threads.length)}
      </Text>
    </Pressable>
  );
}

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
  const threads = useThreads(campaignId);
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
