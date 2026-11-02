import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { RollResult } from "../../ui/roll-result";
import { AlertLine, Panel, PanelBoundary, QueryLoading } from "./chrome";
import { useIntent } from "./intent";

const PAGE = 15;

type FeedRow = FunctionReturnType<typeof api.feed.list>["page"][number];

export function RollFeed({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  return (
    <PanelBoundary title="Roll Feed">
      <RollFeedBody campaignId={campaignId} isGm={isGm} />
    </PanelBoundary>
  );
}

function RollFeedBody({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.feed.list,
    { campaignId },
    { initialNumItems: PAGE },
  );
  const undo = useIntent(api.actionLog.undo);
  return (
    <Panel title="Roll Feed">
      {isGm ? <GmRoll campaignId={campaignId} /> : null}
      {isGm && results.length > 0 ? <ClearFeed campaignId={campaignId} /> : null}
      <QueryLoading label="Loading rolls" value={status === "LoadingFirstPage" ? undefined : status} />
      {status === "LoadingFirstPage" ? null : results.length === 0 ? (
        <Text style={styles.empty}>No rolls yet. Roll from a character sheet and it shows up here for everyone.</Text>
      ) : (
        <View accessibilityLabel="Rolls" style={styles.list}>
          {results.map((row) => (
            <FeedRowView campaignId={campaignId} isGm={isGm} key={row._id} onUndo={(entryId) => void undo.fire({ entryId })} row={row} />
          ))}
        </View>
      )}
      {isGm ? <CountedRolls campaignId={campaignId} results={results} /> : null}
      <AlertLine message={undo.error} />
      {status === "CanLoadMore" ? (
        <Button accessibilityLabel="Show older rolls" onPress={() => loadMore(PAGE)} variant="outline">
          Show older rolls
        </Button>
      ) : null}
    </Panel>
  );
}

function CountedRolls({
  campaignId,
  results,
}: {
  campaignId: Id<"campaigns">;
  results: FeedRow[];
}) {
  const candidates = results
    .filter((row) => row.kind === "roll" && row.roll?.kind === "action" && !row.undone)
    .slice(0, 100)
    .map((row) => row._id);
  const counted = useQuery(
    api.countdownRolls.countedRows,
    candidates.length > 0 ? { campaignId, entryIds: candidates } : "skip",
  );
  const ids = new Set(counted ?? []);
  if (ids.size === 0) return null;
  return (
    <View style={styles.list}>
      {results
        .filter((row) => ids.has(row._id))
        .map((row) => (
          <TickCountdowns campaignId={campaignId} entryId={row._id} key={row._id} summary={row.summary} />
        ))}
    </View>
  );
}

function FeedRowView({
  campaignId,
  isGm,
  onUndo,
  row,
}: {
  campaignId: Id<"campaigns">;
  isGm: boolean;
  onUndo: (entryId: FeedRow["_id"]) => void;
  row: FeedRow;
}) {
  const revealable = "revealable" in row && row.revealable;
  return (
    <View accessibilityLabel={row.summary} style={styles.row}>
      <Text style={[styles.summary, row.undone ? styles.undone : null]}>{row.summary}</Text>
      {row.roll?.manual ? <Text style={styles.tag}>manual</Text> : null}
      {row.visibility === "gm" ? <Text style={styles.tag}>hidden</Text> : null}
      {row.undone ? <Text style={styles.tag}>undone</Text> : null}
      {row.roll ? <RollResult dice={row.roll.dice} /> : null}
      <View style={styles.actions}>
        {row.canUndo && row.kind !== "rest" ? (
          <Button accessibilityLabel={`Undo ${row.summary}`} onPress={() => onUndo(row._id)} variant="outline">
            Undo
          </Button>
        ) : null}
        {isGm && revealable ? <RevealRow campaignId={campaignId} entryId={row._id} summary={row.summary} /> : null}
        {isGm ? <RemoveRow campaignId={campaignId} entryId={row._id} summary={row.summary} /> : null}
      </View>
    </View>
  );
}

function GmRoll({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const roll = useIntent(api.rolls.gmRoll);
  const writes = useWritesEnabled();
  return (
    <View accessibilityLabel="GM roll" style={styles.actions}>
      <Button
        accessibilityLabel="Roll in secret"
        disabled={!writes}
        onPress={() => void roll.fire({ campaignId, dice: [{ count: 1, sides: 12 }], modifier: 0 })}
        variant="outline"
      >
        Roll in secret
      </Button>
      <AlertLine message={roll.error} />
    </View>
  );
}

function ClearFeed({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const clear = useMutation(api.feed.clear);
  const writes = useWritesEnabled();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.actions}>
      {confirm ? (
        <Button
          accessibilityLabel="Clear for everyone"
          disabled={!writes}
          onPress={() => {
            setError(null);
            Promise.resolve(clear({ campaignId }))
              .then(() => setConfirm(false))
              .catch((caught: unknown) => setError(errorMessage(caught)));
          }}
          variant="danger"
        >
          Clear for everyone
        </Button>
      ) : (
        <Button accessibilityLabel="Clear feed" disabled={!writes} onPress={() => setConfirm(true)} variant="outline">
          Clear feed
        </Button>
      )}
      <AlertLine message={error} />
    </View>
  );
}

function RevealRow({
  campaignId,
  entryId,
  summary,
}: {
  campaignId: Id<"campaigns">;
  entryId: FeedRow["_id"];
  summary: string;
}) {
  const reveal = useMutation(api.rolls.reveal);
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);
  return (
    <View>
      <Button
        accessibilityLabel={`Reveal ${summary}`}
        disabled={!writes}
        onPress={() => {
          setError(null);
          Promise.resolve(reveal({ campaignId, entryId })).catch((caught: unknown) => setError(errorMessage(caught)));
        }}
        variant="outline"
      >
        Reveal
      </Button>
      <AlertLine message={error} />
    </View>
  );
}

function RemoveRow({
  campaignId,
  entryId,
  summary,
}: {
  campaignId: Id<"campaigns">;
  entryId: FeedRow["_id"];
  summary: string;
}) {
  const remove = useMutation(api.feed.remove);
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);
  return (
    <View>
      <Button
        accessibilityLabel={`Delete from the feed: ${summary}`}
        disabled={!writes}
        onPress={() => {
          setError(null);
          Promise.resolve(remove({ campaignId, entryId })).catch((caught: unknown) => setError(errorMessage(caught)));
        }}
        variant="danger"
      >
        Delete
      </Button>
      <AlertLine message={error} />
    </View>
  );
}

function TickCountdowns({
  campaignId,
  entryId,
  summary,
}: {
  campaignId: Id<"campaigns">;
  entryId: FeedRow["_id"];
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.actions}>
      <Button accessibilityLabel={`Tick countdowns for ${summary}`} onPress={() => setOpen(true)} variant="outline">
        Tick countdowns
      </Button>
      {open ? <TickSheet campaignId={campaignId} entryId={entryId} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

function TickSheet({
  campaignId,
  entryId,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  entryId: FeedRow["_id"];
  onClose: () => void;
}) {
  const preview = useQuery(api.countdownRolls.preview, { campaignId, entryId });
  const apply = useIntent(api.countdownRolls.applyRoll);
  const writes = useWritesEnabled();
  const chosen = (preview?.countdowns ?? []).filter((row) => !row.ticked).map((row) => row.countdownId);
  return (
    <View accessibilityLabel="Tick countdowns" style={styles.sheet}>
      <QueryLoading label="Loading countdown ticks" value={preview} />
      {preview?.countdowns.map((row) => (
        <Text key={row.countdownId} style={styles.summary}>
          {`${row.name}: ${row.ticked ? "already ticked" : `tick ${row.amount}`}`}
        </Text>
      ))}
      <Button
        accessibilityLabel="Apply roll to countdowns"
        disabled={!writes || chosen.length === 0}
        onPress={() => void apply.fire({ campaignId, entryId, countdownIds: chosen })}
        variant="primary"
      >
        Apply
      </Button>
      <Button accessibilityLabel="Close tick countdowns" onPress={onClose} variant="outline">
        Close
      </Button>
      <AlertLine message={apply.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: space[2],
  },
  row: {
    backgroundColor: colors.ink2,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  summary: {
    color: colors.body,
    fontFamily: textType.sans.fontFamily,
    fontSize: 15,
    fontWeight: textType.sans.fontWeight,
  },
  undone: {
    textDecorationLine: "line-through",
  },
  tag: {
    color: colors.subtle,
    fontFamily: textType.sans.fontFamily,
    fontSize: 12,
    fontWeight: textType.sans.fontWeight,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  empty: {
    color: colors.mutedText,
    fontFamily: textType.serif.fontFamily,
    fontSize: 16,
    fontStyle: textType.serif.fontStyle,
    fontWeight: textType.serif.fontWeight,
  },
  sheet: {
    gap: space[2],
  },
});
