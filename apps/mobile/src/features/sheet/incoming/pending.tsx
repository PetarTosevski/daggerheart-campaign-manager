import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import * as Crypto from "expo-crypto";

import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { DOMAINS } from "../../../../../../src/lib/srd/domains";
import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";

import {
  afterAnswer,
  armorQuestion,
  damageLine,
  hitLine,
  playableCards,
  promptMode,
  reactionCard,
  stepFor,
  stepText,
  type HitChoice,
  type HitView,
} from "./model";

function useRespond(campaignId: Id<"campaigns">, characterId: Id<"characters">) {
  const run = useMutation(api.adversaryActions.respond);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ requestId: string; message: string } | null>(null);
  const writes = useWritesEnabled();

  async function answer(view: HitView, choice: HitChoice) {
    if (!writes) return;
    setError(null);
    setBusy(view.requestId);
    try {
      const res = (await run({
        campaignId,
        requestId: view.requestId,
        characterId,
        choice,
        idempotencyKey: Crypto.randomUUID(),
      })) as { status: string };
      if (res.status === "declined") setError({ requestId: view.requestId, message: "This hit was called off." });
    } catch (caught) {
      setError({ requestId: view.requestId, message: errorMessage(caught) });
    } finally {
      setBusy(null);
    }
  }

  return { answer, busy, error };
}

export function PendingHits({
  campaignId,
  characterId,
  characterName,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  characterName: string;
}) {
  const views = useQuery(api.adversaryActionsReads.pending, { campaignId, characterId });
  const respond = useRespond(campaignId, characterId);
  if (views === undefined || views.length === 0) return null;
  const owed = views.filter((v) => v.awaiting);
  const waiting = views.filter((v) => !v.awaiting);
  return (
    <View style={styles.wrap}>
      {owed.map((view) => (
        <HitCard
          busy={respond.busy === view.requestId}
          characterName={characterName}
          error={respond.error?.requestId === view.requestId ? respond.error.message : null}
          key={view.requestId}
          onAnswer={(choice) => void respond.answer(view, choice)}
          view={view}
        />
      ))}
      {waiting.map((view) => (
        <Text accessibilityRole="text" key={view.requestId} style={styles.waiting} testID="incoming-hit-line">
          <Text style={styles.waitingStrong}>{hitLine(view)}</Text>
          {" · waiting for the others"}
        </Text>
      ))}
    </View>
  );
}

function HitCard({
  view,
  characterName,
  busy,
  error,
  onAnswer,
}: {
  view: HitView;
  characterName: string;
  busy: boolean;
  error: string | null;
  onAnswer: (choice: HitChoice) => void;
}) {
  const mode = promptMode(view);
  const target = view.role === "target";
  const cards = playableCards(view);
  const title = target ? `${view.attackerLabel} hit ${characterName}` : hitLine(view);
  return (
    <View
      accessibilityLabel={`Incoming hit: ${title}`}
      accessibilityRole="none"
      style={styles.card}
      testID="incoming-hit"
    >
      <Text style={styles.kicker}>{target ? "You were hit" : `${characterName} can react`}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {target ? (
        <>
          <Text style={styles.body}>{damageLine(view)}</Text>
          <Text style={styles.body}>{armorQuestion(view)}</Text>
        </>
      ) : null}
      {cards.length > 0 ? (
        <View accessibilityLabel="Reaction cards" style={styles.cards}>
          {cards.map((cardId) => (
            <ReactionCardItem cardId={cardId} disabled={busy} key={cardId} onUse={() => onAnswer({ kind: "card", cardId })} />
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        {mode === "armorOne" ? (
          <>
            <Button disabled={busy} onPress={() => onAnswer({ kind: "armor", slots: 1 })} variant="solid">
              Mark
            </Button>
            <Button disabled={busy} onPress={() => onAnswer({ kind: "noArmor" })} variant="outline">
              Don&apos;t
            </Button>
          </>
        ) : null}
        {mode === "armorMany" ? <ArmorCounts busy={busy} onAnswer={onAnswer} view={view} /> : null}
        {mode === "ok" ? (
          <Button disabled={busy} onPress={() => onAnswer({ kind: "noArmor" })} variant="solid">
            OK
          </Button>
        ) : null}
        {mode === "ally" ? (
          <Button disabled={busy} onPress={() => onAnswer({ kind: "pass" })} variant="outline">
            Pass
          </Button>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function ArmorCounts({
  view,
  busy,
  onAnswer,
}: {
  view: HitView;
  busy: boolean;
  onAnswer: (choice: HitChoice) => void;
}) {
  const max = view.maxSlots ?? 0;
  const counts = Array.from({ length: max }, (_, i) => i + 1);
  const none = stepFor(view, 0);
  return (
    <>
      {counts.map((n) => {
        const step = stepFor(view, n);
        const label = step ? `Mark ${n}: ${stepText(step)}` : `Mark ${n}`;
        return (
          <Button accessibilityLabel={label} disabled={busy} key={n} onPress={() => onAnswer({ kind: "armor", slots: n })} variant="solid">
            {label}
          </Button>
        );
      })}
      <Button
        accessibilityLabel={none ? `Don't: ${stepText(none)}` : "Don't"}
        disabled={busy}
        onPress={() => onAnswer({ kind: "noArmor" })}
        variant="outline"
      >
        {none ? `Don't · ${stepText(none)}` : "Don't"}
      </Button>
    </>
  );
}

function ReactionCardItem({ cardId, disabled, onUse }: { cardId: string; disabled: boolean; onUse: () => void }) {
  const card = reactionCard(cardId);
  const domain = DOMAINS.find((d) => d.id === card.domain);
  return (
    <View style={[styles.reaction, { borderColor: domain?.color ?? "#5b2b2b" }]} testID="incoming-hit-card">
      <Text style={styles.reactionName}>{card.name}</Text>
      <Text style={styles.reactionMeta}>
        {domain?.name ?? card.domain}
        {card.level > 0 ? ` ${card.level}` : ""}
      </Text>
      {card.text ? <Text style={styles.reactionText}>{card.text}</Text> : null}
      <Button accessibilityLabel={`Use ${card.name}`} disabled={disabled} onPress={onUse} variant="solid">
        Use
      </Button>
    </View>
  );
}

/** Optimistic helper for tests that patch pending locally. */
export function optimisticPending(views: readonly HitView[], requestId: HitView["requestId"], choice: HitChoice): HitView[] {
  return afterAnswer(views, requestId, choice);
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[4],
  },
  card: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  kicker: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  body: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  cards: {
    gap: space[3],
  },
  reaction: {
    borderLeftWidth: 4,
    gap: space[2],
    paddingLeft: space[3],
  },
  reactionName: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 17,
    fontWeight: type.sansSemibold.fontWeight,
  },
  reactionMeta: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  reactionText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  actions: {
    gap: space[2],
  },
  waiting: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  waitingStrong: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontWeight: type.sansSemibold.fontWeight,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
