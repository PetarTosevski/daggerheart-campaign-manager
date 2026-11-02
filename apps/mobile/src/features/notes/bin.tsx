import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { binDaysLeft, daysLeftLabel } from "../../../../../src/lib/domain/notes";
import type { BinRow } from "../../../../../convex/notesBin";
import { api, type Id } from "../../convex";
import { Entries } from "./entries";
import { selectedPage, useJournal } from "./use-journal";
import type { NotesSlotProps } from "./slots";
import { toPageRef } from "./slots";
import { notesStyles } from "./styles";

export function TearOutButton({ campaignId, pageId, view, onPage }: NotesSlotProps) {
  const journal = useJournal();
  const binPage = useMutation(api.notesBin.binPage);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = toPageRef(pageId);
  if (ref === null || pageId === null) return null;
  const isArmed = armed === pageId;

  function tearOut() {
    if (ref === null) return;
    setArmed(null);
    setError(null);
    const back = view === "journal" ? "journal" : "page";
    binPage({ campaignId, page: ref })
      .then((id) => {
        void id;
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    onPage(null, back);
  }

  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => (isArmed ? tearOut() : setArmed(pageId))}>
        <Text style={notesStyles.chip}>{isArmed ? "Tap again to tear out" : "Tear out page"}</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
      {journal && selectedPage(journal, pageId) ? null : null}
    </View>
  );
}

export function TornOutPages({ campaignId, pageId, view, onPage }: NotesSlotProps) {
  const rows = useQuery(api.notesBin.bin, { campaignId });
  const restore = useMutation(api.notesBin.restorePage);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  function restoreRow(row: BinRow) {
    setError(null);
    const viewing = view === "bin" && pageId === row._id;
    restore({ campaignId, page: row._id })
      .then(() => {
        if (row.from === null) onPage(row._id, "page");
        else if (viewing) onPage(null, "page");
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={notesStyles.label}>Torn-out pages</Text>
      {rows === undefined ? (
        <Text style={notesStyles.muted}>Loading …</Text>
      ) : rows.length === 0 ? (
        <Text style={notesStyles.empty}>Nothing torn out.</Text>
      ) : (
        rows.map((row) => (
          <View key={row._id} style={notesStyles.row}>
            <Pressable accessibilityRole="button" onPress={() => onPage(row._id, "bin")} style={{ flex: 1 }}>
              <Text style={notesStyles.line}>{row.title}</Text>
              <Text style={notesStyles.muted}>
                {daysLeftLabel(binDaysLeft(row.binnedAt, Math.max(now, row.binnedAt)))}
                {row.from !== null ? ` · from ${row.from}'s journal` : ""}
              </Text>
            </Pressable>
            <Pressable accessibilityLabel={`Restore ${row.title}`} accessibilityRole="button" onPress={() => restoreRow(row)}>
              <Text style={notesStyles.chip}>Restore</Text>
            </Pressable>
          </View>
        ))
      )}
      {error ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function BinView(props: NotesSlotProps) {
  const { campaignId, pageId, onPage } = props;
  const rows = useQuery(api.notesBin.bin, { campaignId });
  const restore = useMutation(api.notesBin.restorePage);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  if (rows === undefined) {
    return (
      <View accessibilityLabel="Torn-out page" style={notesStyles.paper}>
        <Text style={notesStyles.line}>Loading the page…</Text>
      </View>
    );
  }
  const row = rows.find((r) => r._id === pageId);
  if (row === undefined) {
    return (
      <View accessibilityLabel="Torn-out page" style={notesStyles.paper}>
        <Text style={notesStyles.tape}>Torn out</Text>
        <Text style={notesStyles.line}>Pick a page under Torn-out pages.</Text>
      </View>
    );
  }
  const id: Id<"journalPages"> = row._id;
  return (
    <View accessibilityLabel="Torn-out page" style={notesStyles.paper}>
      <Text style={notesStyles.tape}>{row.title}</Text>
      <View style={notesStyles.toolbar}>
        <Text style={notesStyles.meta}>
          Torn out · {daysLeftLabel(binDaysLeft(row.binnedAt, Math.max(now, row.binnedAt)))}
          {row.from !== null ? ` · from ${row.from}'s journal` : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(null);
            restore({ campaignId, page: id })
              .then(() => onPage(row.from === null ? id : null, "page"))
              .catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          <Text style={notesStyles.chip}>Restore page</Text>
        </Pressable>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
      <Entries {...props} />
    </View>
  );
}
