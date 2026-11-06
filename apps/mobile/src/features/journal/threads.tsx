import { useQuery } from "convex/react";
import { Pressable, Text, View } from "react-native";

import { glyphFor } from "../../../../../src/lib/domain/notes";
import { api, type Id } from "../../convex";
import { EntryText } from "../notes/mentions";
import { journalColors, js } from "./styles";
import { Card, LoadingLine } from "./ui";

/**
 * Threads raised (website: src/components/journal/threads; Q2): the caller's own open threads (open tasks and
 * unresolved Fears) on their Notes pages linked to the session (`journalThreads.raised`, per viewer, so a player sees
 * their own pages only). Each row: the bullet glyph (read only here), the text with its @mentions, and 'In Notes',
 * which opens the page on the Notes sub-tab.
 */
export function ThreadsRaised({
  ids,
  onOpenPage,
}: {
  ids: { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };
  onOpenPage: (pageId: string) => void;
}) {
  const threads = useQuery(api.journalThreads.raised, ids);
  return (
    <Card heading="Threads raised">
      {threads === undefined ? (
        <LoadingLine>Loading threads…</LoadingLine>
      ) : threads.length === 0 ? (
        <Text style={js.muted}>No threads raised on this session&apos;s pages.</Text>
      ) : (
        // EntryText writes in the notes' ink, so the rows sit on paper as they do in Notes.
        <View style={js.paper}>
          {threads.map((row) => (
          <View key={row.entryId} style={js.row}>
            <Text accessibilityLabel={row.kind === "fear" ? "Looming Fear" : "Open task"} style={js.paperText}>
              {glyphFor(row)}
            </Text>
            <View style={{ flex: 1 }}>
              <EntryText campaignId={ids.campaignId} text={row.text} />
            </View>
            <Pressable
              accessibilityLabel={`In Notes: ${row.pageTitle}`}
              accessibilityRole="button"
              onPress={() => onOpenPage(row.pageId)}
              style={js.link}
            >
              <Text style={[js.linkText, { color: journalColors.paperInk }]}>In Notes</Text>
            </Pressable>
          </View>
          ))}
        </View>
      )}
    </Card>
  );
}
