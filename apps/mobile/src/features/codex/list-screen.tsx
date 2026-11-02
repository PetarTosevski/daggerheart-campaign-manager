import { useMutation, useQuery } from "convex/react";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { frameName } from "../../../../../src/lib/campaign-display";
import type { CodexKind } from "../../../../../src/lib/codex/schema";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { useWritesEnabled } from "../../shell/offline";
import { Loading } from "../../ui/loading";
import { Button } from "../../ui/button";

import { EntryRow } from "./entry-row";
import {
  emptyMessage,
  filterEntries,
  headerLine,
  kindLabel,
  toListRows,
  visibleEntries,
} from "./list-model";
import { codexStyles } from "./styles";

export function CodexListScreen() {
  const campaign = useCampaign();
  const router = useRouter();
  const data = useQuery(api.codex.list, { campaignId: campaign._id });
  const create = useMutation(api.codex.create);
  const importPins = useMutation(api.codex.importPins);
  const writes = useWritesEnabled();
  const isGmUser = campaign.role === "gm";
  const [kind, setKind] = useState<CodexKind>("character");
  const [groups, setGroups] = useState<Record<CodexKind, string>>({ character: "all", location: "all" });
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (data === undefined) return <Loading label="Loading characters and locations" />;

  const frameId = campaign.frameId;
  const { entries, gm } = visibleEntries(data, frameId, preview && isGmUser);
  const grp = groups[kind];
  const { shown, groupTabs } = filterEntries(entries, kind, grp, search, frameId, gm);
  const listEntries = toListRows(shown, gm);
  const counts = (k: CodexKind) => entries.filter((entry) => entry.kind === k).length;

  async function addEntry() {
    if (!writes) return;
    setActionError(null);
    try {
      const result = await create({ campaignId: campaign._id, kind, idempotencyKey: Crypto.randomUUID() });
      setSearch("");
      setGroups((current) => ({ ...current, [kind]: "all" }));
      router.push(`/campaign/${campaign._id}/codex/${result.entryId}`);
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function fromMap() {
    if (!writes) return;
    setActionError(null);
    try {
      const result = await importPins({ campaignId: campaign._id, idempotencyKey: Crypto.randomUUID() });
      setImportMsg(
        result.added ? `Added ${result.added} location${result.added === 1 ? "" : "s"} from the map.` : "Every map pin is already in the list.",
      );
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  return (
    <ScrollView contentContainerStyle={codexStyles.stack}>
      <Text style={codexStyles.eyebrow}>
        {campaign.name} · {frameName(frameId)}
      </Text>
      <Text accessibilityRole="header" style={codexStyles.title}>
        Characters & Locations
      </Text>
      <Text style={codexStyles.subhead}>{headerLine(data, gm && isGmUser && !preview)}</Text>
      {isGmUser ? (
        <Button
          accessibilityLabel={preview ? "Back to GM view" : "Player view preview"}
          onPress={() => setPreview((current) => !current)}
          variant={preview ? "solid" : "outline"}
        >
          {preview ? "Back to GM view" : "Player view"}
        </Button>
      ) : null}
      {preview ? (
        <View style={codexStyles.previewBanner}>
          <Text style={codexStyles.previewText}>
            Player view: only known entries and revealed images. GM notes are hidden.
          </Text>
        </View>
      ) : null}

      <View accessibilityRole="tablist" style={codexStyles.kindRow}>
        {(["character", "location"] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: kind === k }}
            onPress={() => {
              setKind(k);
              setImportMsg("");
            }}
            style={[codexStyles.kindTab, kind === k ? codexStyles.kindTabOn : null]}
          >
            <Text style={[codexStyles.tabText, kind === k ? codexStyles.tabTextOn : null]}>
              {kindLabel(k)} · {counts(k)}
            </Text>
          </Pressable>
        ))}
      </View>

      {groupTabs.length ? (
        <View accessibilityRole="tablist" style={codexStyles.tabRow}>
          {groupTabs.map((tab) => (
            <Pressable
              key={tab.key || "none"}
              accessibilityRole="tab"
              accessibilityState={{ selected: grp === tab.key }}
              onPress={() => setGroups((current) => ({ ...current, [kind]: tab.key }))}
              style={[codexStyles.tab, grp === tab.key ? codexStyles.tabOn : null]}
            >
              <Text style={[codexStyles.tabText, grp === tab.key ? codexStyles.tabTextOn : null]}>
                {tab.label} · {tab.count}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        accessibilityLabel="Search"
        onChangeText={setSearch}
        placeholder={kind === "location" ? "Search locations" : "Search characters"}
        style={codexStyles.input}
        value={search}
      />

      {gm && isGmUser && !preview ? (
        <View style={codexStyles.row}>
          <Button accessibilityLabel={kind === "location" ? "New location" : "New character"} disabled={!writes} onPress={() => void addEntry()} variant="solid">
            {kind === "location" ? "+ New location" : "+ New character"}
          </Button>
          {kind === "location" ? (
            <Button disabled={!writes} onPress={() => void fromMap()} variant="outline">
              From map
            </Button>
          ) : null}
        </View>
      ) : null}
      {gm && kind === "location" && importMsg ? (
        <Text accessibilityRole="status" style={codexStyles.muted}>
          {importMsg}
        </Text>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={codexStyles.error}>
          {actionError}
        </Text>
      ) : null}

      {shown.length === 0 ? (
        <View style={codexStyles.card}>
          <Text style={codexStyles.muted}>{emptyMessage(kind, gm && isGmUser && !preview, search.trim().length > 0)}</Text>
        </View>
      ) : (
        listEntries.map((row) => (
          <EntryRow
            entry={row}
            gm={gm && isGmUser && !preview}
            key={row._id}
            onPress={() => {
              const previewParam = preview && isGmUser ? "?preview=1" : "";
              router.push(`/campaign/${campaign._id}/codex/${row._id}${previewParam}`);
            }}
            selected={false}
          />
        ))
      )}
    </ScrollView>
  );
}
