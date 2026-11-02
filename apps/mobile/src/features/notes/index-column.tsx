import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import {
  groupEmptyText,
  matches,
  PAGE_GROUPS,
  pageCountLabel,
  visibilityLabel,
  type PageKind,
  type Visibility,
} from "../../../../../src/lib/domain/notes";
import type { Id } from "../../convex";
import { api } from "../../convex";
import { SessionPicker } from "./session-picker";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";
import { ownPages, pageParam, selectedPage, useJournal, type OwnPage } from "./use-journal";

const VISIBILITY_MARK: Record<Visibility, string> = {
  gm: "👁",
  private: "🔒",
  players: "👥",
  everyone: "🌐",
  chosen: "✓",
};

export function PageGroups(props: NotesSlotProps) {
  const { campaignId, search, matchingPageIds, onPage, view: currentView, pageId } = props;
  const view = useJournal();
  const createPage = useMutation(api.notes.createPage);
  const [open, setOpen] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<PageKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (view === undefined) {
    return (
      <Text accessibilityRole="text" style={notesStyles.muted}>
        Loading pages…
      </Text>
    );
  }

  const pages = ownPages(view);
  const current = currentView === "page" ? selectedPage(view, pageId) : null;
  const searching = search.trim() !== "";
  const shown = (page: OwnPage) =>
    !searching ||
    matchingPageIds === null ||
    ("_id" in page ? matchingPageIds.has(page._id) : matches(page.title, search));

  async function add(kind: PageKind, sessionId?: Id<"sessions"> | null) {
    setBusy(kind);
    setError(null);
    try {
      const id = await createPage({ campaignId, kind, ...(sessionId ? { sessionId } : {}) });
      onPage(id, "page");
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  function pick(page: OwnPage) {
    onPage(pageParam(page), "page");
    setOpen(false);
  }

  return (
    <View accessibilityLabel="Your pages" style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)}>
        <Text style={notesStyles.line}>
          {open ? "▾" : "▸"} Pages{current ? ` · ${current.title}` : ""}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 12 }}>
          {PAGE_GROUPS.map((group) => {
            const items = pages.filter((p) => p.kind === group.kind && shown(p));
            return (
              <View accessibilityLabel={group.label} key={group.kind} style={{ gap: 6 }}>
                <View style={notesStyles.row}>
                  <Text style={notesStyles.label}>{group.label}</Text>
                  <Pressable
                    accessibilityLabel={group.addLabel}
                    accessibilityRole="button"
                    disabled={busy !== null}
                    onPress={() => {
                      if (group.kind === "log") setPicking(true);
                      else add(group.kind).catch((e: unknown) => setError(errorMessage(e)));
                    }}
                  >
                    <Text style={notesStyles.chip}>＋</Text>
                  </Pressable>
                </View>
                {items.map((page) => {
                  const mark = VISIBILITY_MARK[page.visibility];
                  const label = visibilityLabel(page.visibility, view.isGm);
                  const count = pageCountLabel("entryCount" in page ? page : { openCount: 0, entryCount: 0 });
                  const isCurrent = current !== null && pageParam(current) === pageParam(page);
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: isCurrent }}
                      key={pageParam(page)}
                      onPress={() => pick(page)}
                    >
                      <View style={notesStyles.row}>
                        <Text accessibilityLabel={label}>{mark}</Text>
                        <Text style={notesStyles.line}>{page.title}</Text>
                        {count ? <Text style={notesStyles.muted}>{count}</Text> : null}
                      </View>
                      <Text style={notesStyles.muted}>{label}</Text>
                    </Pressable>
                  );
                })}
                {items.length === 0 ? <Text style={notesStyles.empty}>{groupEmptyText(searching)}</Text> : null}
              </View>
            );
          })}
          {error ? (
            <Text accessibilityRole="alert" style={notesStyles.error}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
      <SessionPicker
        campaignId={campaignId}
        confirmLabel="Add the page"
        onClose={() => setPicking(false)}
        onPick={(sessionId) => add("log", sessionId)}
        open={picking}
        title="New session log"
      />
    </View>
  );
}
