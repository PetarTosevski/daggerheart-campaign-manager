import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import {
  addPlaceholder,
  BULLETS,
  emptyLine,
  ENTRY_KINDS,
  KEY_LEGEND,
  migrationTip,
  openTasks,
  parseQuickKey,
  type EntryKind,
} from "../../../../../src/lib/domain/notes";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { EntryRowView, type RowActions } from "./entry-row";
import { MentionInput } from "./mentions";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";
import { pageRefOf, useEntryMutations, usePageEntries } from "./use-entries";

function isTemplate(pageId: string | null): boolean {
  return pageId === null || pageId.startsWith("template-");
}

export function Entries({ campaignId, pageId, search }: NotesSlotProps) {
  const page = pageRefOf(pageId);
  const loaded = usePageEntries(campaignId, page);
  const mutations = useEntryMutations();
  const [editing, setEditing] = useState<Id<"journalEntries"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ pageId: string | null; data: NonNullable<ReturnType<typeof usePageEntries>> } | null>(
    null,
  );
  if (loaded !== undefined && (last?.data !== loaded || last.pageId !== pageId)) setLast({ pageId, data: loaded });
  const data = loaded ?? (last && isTemplate(last.pageId) && !isTemplate(pageId) ? last.data : undefined);

  if (data === undefined) {
    return (
      <Text accessibilityRole="text" style={notesStyles.muted}>
        Loading entries…
      </Text>
    );
  }

  function run(intent: () => Promise<unknown>) {
    setError(null);
    intent().catch((e: unknown) => setError(errorMessage(e)));
  }

  const actions: RowActions = {
    cycle: (entryId) => run(() => mutations.cycle({ campaignId, entryId })),
    toggleStar: (entryId) => run(() => mutations.toggleStar({ campaignId, entryId })),
    moveUp: (entryId) => run(() => mutations.moveUp({ campaignId, entryId })),
    remove: (entryId) => run(() => mutations.remove({ campaignId, entryId })),
    saveText: (entryId, text) => run(() => mutations.setText({ campaignId, entryId, text })),
  };

  return (
    <View style={{ gap: 12 }}>
      {data.entries.length === 0 ? <Text style={notesStyles.line}>{emptyLine(data.kind)}</Text> : null}
      {data.entries.map((row, index) => (
        <EntryRowView
          actions={actions}
          campaignId={campaignId}
          editing={editing === row._id}
          first={index === 0}
          key={row._id}
          onEdit={setEditing}
          row={row}
          search={search}
        />
      ))}
      {data.canAdd ? (
        <AddRow campaignId={campaignId} onAdd={(kind, text) => run(() => mutations.add({ campaignId, page, kind, text }))} />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
      <KeyLegend />
    </View>
  );
}

function AddRow({
  campaignId,
  onAdd,
}: {
  campaignId: Id<"campaigns">;
  onAdd: (kind: EntryKind, text: string) => void;
}) {
  const [kind, setKind] = useState<EntryKind>("task");
  const spec = BULLETS[kind];

  return (
    <View style={{ gap: 8 }}>
      <Text style={notesStyles.label}>Bullet type</Text>
      <View style={notesStyles.toolbar}>
        {ENTRY_KINDS.map((k) => (
          <Pressable accessibilityRole="button" key={k} onPress={() => setKind(k)}>
            <Text style={[notesStyles.chip, k === kind ? { backgroundColor: spec.color, color: "#1a1408" } : undefined]}>
              {BULLETS[k].label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={notesStyles.row}>
        <Text style={{ color: spec.color, fontSize: 18 }}>{spec.glyph}</Text>
        <MentionInput
          campaignId={campaignId}
          label="New entry"
          onSubmit={(raw) => {
            const parsed = parseQuickKey(raw, kind);
            if (parsed.text) onAdd(parsed.kind, parsed.text);
          }}
          placeholder={addPlaceholder(kind)}
        />
      </View>
    </View>
  );
}

function KeyLegend() {
  return (
    <View style={notesStyles.card}>
      <Text style={notesStyles.label}>KEY</Text>
      <Text style={notesStyles.cardText}>
        {KEY_LEGEND.map((item) => item.text).join(" · ")}
      </Text>
    </View>
  );
}

export function MigrateButton({ campaignId, pageId, onPage }: NotesSlotProps) {
  const page = pageRefOf(pageId);
  const data = usePageEntries(campaignId, page);
  const migrate = useMutation(api.notesEntries.migrateOpen);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (data !== undefined && !data.canArrange) return null;
  const noOpen = data === undefined || openTasks(data.entries).length === 0;

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      const { pageId: target } = await migrate({ campaignId, page });
      onPage(target, "page");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <View>
      <Pressable accessibilityRole="button" disabled={noOpen || pending} onPress={() => void onClick()}>
        <Text style={notesStyles.chip}>➜ Migrate open tasks</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
      {!noOpen && data ? (
        <Text style={notesStyles.muted}>{migrationTip(data.migrateTarget ?? null)}</Text>
      ) : null}
    </View>
  );
}
