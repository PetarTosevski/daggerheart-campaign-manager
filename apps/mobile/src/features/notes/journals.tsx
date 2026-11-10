import { useQuery } from "convex/react";
import { Pressable, Text, View } from "react-native";

import { pageCountLabel, pageMeta } from "../../../../../src/lib/domain/notes";
import type { JournalViewPage } from "../../../../../convex/notesJournals";
import { api } from "../../convex";
import { TearOutButton } from "./bin";
import { Entries } from "./entries";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";

function pagesLabel(count: number): string {
  return count === 1 ? "1 page" : `${count} pages`;
}

export function JournalsList({ campaignId, access, view, journalId, onView }: NotesSlotProps) {
  const players = useQuery(api.notesJournals.playerJournals, access.isGm ? { campaignId } : "skip");
  const past = useQuery(api.notesJournals.pastJournals, { campaignId });
  const current = (id: string) => (view === "journal" && journalId === id ? "page" : undefined);

  return (
    <View style={{ gap: 12 }}>
      {access.isGm ? (
        <View style={{ gap: 8 }}>
          <Text style={notesStyles.label}>Players&apos; journals</Text>
          {players === undefined ? (
            <Text style={notesStyles.muted}>Loading journals…</Text>
          ) : players.length === 0 ? (
            <Text style={notesStyles.empty}>No player has written yet.</Text>
          ) : (
            players.map((row) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: current(row.journalId) !== undefined }}
                key={row.journalId}
                onPress={() => onView("journal", row.journalId)}
              >
                <Text style={notesStyles.line}>{row.name}</Text>
                <Text style={notesStyles.muted}>
                  {row.sub} · {pagesLabel(row.pageCount)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        <Text style={notesStyles.label}>Past journals</Text>
        {past === undefined ? (
          <Text style={notesStyles.muted}>Loading past journals…</Text>
        ) : past.length === 0 ? (
          <Text style={notesStyles.empty}>No past journals.</Text>
        ) : (
          past.map((row) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: current(row.journalId) !== undefined }}
              key={row.journalId}
              onPress={() => onView("journal", row.journalId)}
            >
              <Text style={notesStyles.line}>{row.name}</Text>
              <Text style={notesStyles.muted}>{pagesLabel(row.pageCount)}</Text>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

export function JournalView(props: NotesSlotProps) {
  const { campaignId, journalId, pageId, onPage } = props;
  const data = useQuery(api.notesJournals.journalView, journalId ? { campaignId, journalId } : "skip");
  if (journalId === null) {
    return (
      <View accessibilityLabel="Journal" style={notesStyles.paper}>
        <Text style={notesStyles.tape}>Journal</Text>
        <Text style={notesStyles.line}>Pick a journal from the list.</Text>
      </View>
    );
  }
  if (data === undefined) {
    return (
      <View accessibilityLabel="Journal" style={notesStyles.paper}>
        <Text style={notesStyles.line}>Loading the journal…</Text>
      </View>
    );
  }
  const selected: JournalViewPage | null = data.pages.find((p) => p._id === pageId) ?? data.pages[0] ?? null;
  const status = data.departed ? "Past journal · read only" : "read only";

  return (
    <View style={{ gap: 12 }}>
      <View>
        <Text accessibilityRole="header" style={notesStyles.title}>
          {data.title}
        </Text>
        <Text style={notesStyles.meta}>{status}</Text>
      </View>
      {data.pages.length > 0 ? (
        <View style={{ gap: 6 }}>
          {data.pages.map((page) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selected?._id === page._id }}
              key={page._id}
              onPress={() => onPage(page._id, "journal")}
            >
              <Text style={notesStyles.line}>{page.title}</Text>
              {pageCountLabel(page) ? <Text style={notesStyles.muted}>{pageCountLabel(page)}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {selected === null ? (
        <View accessibilityLabel="Journal" style={notesStyles.paper}>
          <Text style={notesStyles.tape}>Nothing to read</Text>
          <Text style={notesStyles.line}>No page of this journal is shared with you.</Text>
        </View>
      ) : (
        <View accessibilityLabel="Read-only page" style={notesStyles.paper}>
          <Text style={notesStyles.tape}>{selected.title}</Text>
          <View style={notesStyles.toolbar}>
            <Text style={notesStyles.meta}>
              {pageMeta({ kind: selected.kind, createdAt: selected.createdAt }, selected.session ?? null)}
            </Text>
            <Text style={notesStyles.chip}>{selected.chip}</Text>
            {selected.canBin && !data.own ? (
              <TearOutButton {...props} pageId={selected._id} view="journal" onPage={onPage} />
            ) : null}
          </View>
          <Entries {...props} pageId={selected._id} />
        </View>
      )}
    </View>
  );
}
