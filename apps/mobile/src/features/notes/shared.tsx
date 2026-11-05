import { useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { pageMeta } from "../../../../../src/lib/domain/notes";
import type { SharedRow, SharedTab } from "../../../../../convex/notesSharing";
import { api, type Id } from "../../convex";
import { Entries } from "./entries";
import type { NotesSlotProps, NotesView } from "./slots";
import { notesStyles } from "./styles";

const TABS = [
  { id: "players", label: "Shared by players" },
  { id: "gm", label: "Shared by GM" },
] as const satisfies readonly { id: SharedTab; label: string }[];

const VIEW_OF: Record<SharedTab, NotesView> = { players: "shared-players", gm: "shared-gm" };

function useShared(campaignId: Id<"campaigns">, tab: SharedTab): SharedRow[] | undefined {
  return useQuery(api.notesSharing.shared, { campaignId, tab });
}

function byOwner(rows: readonly SharedRow[]): { owner: string; rows: SharedRow[] }[] {
  const groups: { owner: string; rows: SharedRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.owner === row.ownerName) last.rows.push(row);
    else groups.push({ owner: row.ownerName, rows: [row] });
  }
  return groups;
}

export function SharedSection({ campaignId, view, pageId, onPage }: NotesSlotProps) {
  const [chosen, setChosen] = useState<SharedTab | null>(null);
  const tab: SharedTab = chosen ?? (view === "shared-gm" ? "gm" : "players");
  const rows = useShared(campaignId, tab);

  function rowButton(row: SharedRow, showOwner: boolean) {
    const current = (view === VIEW_OF[tab] || (row.own && view === "page")) && pageId === row.pageId;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: current }}
        key={row.pageId}
        onPress={() => onPage(row.pageId, row.own ? "page" : VIEW_OF[tab])}
        style={{ paddingVertical: 6 }}
      >
        <Text style={notesStyles.line}>{row.title}</Text>
        <Text style={notesStyles.muted}>{row.own ? row.chip : showOwner ? row.ownerName : row.chip}</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={notesStyles.label}>Shared</Text>
      <View style={notesStyles.toolbar}>
        {TABS.map(({ id, label }) => (
          <Pressable accessibilityRole="tab" key={id} onPress={() => setChosen(id)}>
            <Text style={[notesStyles.chip, tab === id ? { backgroundColor: colorsHighlight } : undefined]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {rows === undefined ? (
        <Text style={notesStyles.muted}>Loading shared pages…</Text>
      ) : rows.length === 0 ? (
        <Text style={notesStyles.empty}>Nothing shared yet.</Text>
      ) : tab === "players" ? (
        byOwner(rows).map((group) => (
          <View key={group.owner}>
            <Text style={notesStyles.label}>{group.owner}</Text>
            {group.rows.map((row) => rowButton(row, false))}
          </View>
        ))
      ) : (
        rows.map((row) => rowButton(row, true))
      )}
    </View>
  );
}

const colorsHighlight = "#e3b45a33";

export function SharedPageView(props: NotesSlotProps) {
  const tab: SharedTab = props.view === "shared-gm" ? "gm" : "players";
  const rows = useShared(props.campaignId, tab);
  if (props.pageId === null) {
    return (
      <View accessibilityLabel="Shared page" style={notesStyles.paper}>
        <Text style={notesStyles.tape}>Shared pages</Text>
        <Text style={notesStyles.line}>Pick a page under Shared.</Text>
      </View>
    );
  }
  if (rows === undefined) {
    return (
      <View accessibilityLabel="Shared page" style={notesStyles.paper}>
        <Text style={notesStyles.line}>Loading the page…</Text>
      </View>
    );
  }
  const row = rows.find((r) => r.pageId === props.pageId);
  if (row === undefined) {
    return (
      <View accessibilityLabel="Shared page" style={notesStyles.paper}>
        <Text style={notesStyles.tape}>Not shared</Text>
        <Text style={notesStyles.line}>This page is not shared with you. Pick one under Shared.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={notesStyles.meta}>{`${row.ownerName}'s page · read only`}</Text>
      <View accessibilityLabel="Shared page" style={notesStyles.paper}>
        <Text style={notesStyles.tape}>{row.title}</Text>
        <View style={notesStyles.toolbar}>
          <Text style={notesStyles.meta}>{pageMeta({ kind: row.kind, createdAt: row.createdAt })}</Text>
          <Text style={notesStyles.chip}>{row.chip}</Text>
        </View>
        <Entries {...props} pageId={row.pageId} />
      </View>
    </View>
  );
}
