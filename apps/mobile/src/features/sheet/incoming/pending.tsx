import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery } from "convex/react";

import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { useIntent } from "../intent";

import {
  cardDisplay,
  cardsToPlay,
  featureAnswer,
  grantPay,
  hitDamageText,
  numberFloor,
  picksReady,
  previewAt,
  promptMode,
  promptQuestion,
  promptTitle,
  severityWords,
  slotCounts,
  startingPicks,
  type FeaturePicks,
  type FeatureView,
  type GrantView,
  type HitChoice,
  type HitView,
} from "./model";

/**
 * The open hits on (or near) one character, from `adversaryActionsReads.pending`. Every owed hit is a card that asks
 * for one answer per tap (`adversaryActions.respond`, one idempotency key each); the others are one line each.
 */
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
  if (views === undefined || views.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {views
        .filter((view) => view.awaiting)
        .map((view) => (
          <HitCard campaignId={campaignId} characterId={characterId} characterName={characterName} key={view.requestId} view={view} />
        ))}
      {views
        .filter((view) => !view.awaiting)
        .map((view) => (
          <Text accessibilityRole="text" key={view.requestId} style={styles.waiting} testID="incoming-hit-line">
            <Text style={styles.waitingStrong}>{`${view.attackerLabel} hit ${view.targetName}`}</Text>
            {" · waiting for the others"}
          </Text>
        ))}
    </View>
  );
}

function HitCard({
  campaignId,
  characterId,
  characterName,
  view,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  characterName: string;
  view: HitView;
}) {
  const respond = useIntent(api.adversaryActions.respond);
  const writes = useWritesEnabled();
  const [calledOff, setCalledOff] = useState(false);
  const mode = promptMode(view);
  const { kicker, title } = promptTitle(view, characterName);
  const question = promptQuestion(view);
  const cards = cardsToPlay(view);
  const features = view.features ?? [];
  const grants = view.grants ?? [];
  const busy = respond.pending || !writes;

  async function answer(choice: HitChoice) {
    setCalledOff(false);
    const result = await respond.fire({ campaignId, requestId: view.requestId, characterId, choice });
    if (result?.status === "declined") setCalledOff(true);
  }
  const send = (choice: HitChoice) => void answer(choice);
  const error = respond.error ?? (calledOff ? "This hit was called off." : null);

  return (
    <View accessibilityLabel={`${mode === "preRoll" ? "Before the roll" : "Incoming hit"}: ${title}`} style={styles.card} testID="incoming-hit">
      <Text style={styles.kicker}>{kicker}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {view.originalTargetName !== undefined && view.role === "target" ? (
        <Text style={styles.body}>{`Redirected from ${view.originalTargetName}.`}</Text>
      ) : null}
      {view.role === "target" && mode !== "preRoll" && mode !== "afterHit" ? <Text style={styles.body}>{hitDamageText(view)}</Text> : null}
      {question ? <Text style={styles.body}>{question}</Text> : null}
      {grants.length > 0 ? (
        <View accessibilityLabel="Grants" style={styles.list}>
          {grants.map((grant) => (
            <GrantItem disabled={busy} grant={grant} key={grant.id} onSpend={(amount) => send({ kind: "grant", id: grant.id, amount })} />
          ))}
        </View>
      ) : null}
      {features.length > 0 ? (
        <View accessibilityLabel="Reaction features" style={styles.list}>
          {features.map((feature) => (
            <FeatureItem disabled={busy} feature={feature} key={feature.featureId} onUse={(picks) => send(featureAnswer(feature, picks))} />
          ))}
        </View>
      ) : null}
      {cards.length > 0 ? (
        <View accessibilityLabel="Reaction cards" style={styles.list}>
          {cards.map((cardId) => (
            <CardItem cardId={cardId} disabled={busy} key={cardId} onUse={() => send({ kind: "card", cardId })} />
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Answers busy={busy} mode={mode} onAnswer={send} view={view} />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** The closing answers of each mode (see `PromptMode`). */
function Answers({ mode, view, busy, onAnswer }: { mode: ReturnType<typeof promptMode>; view: HitView; busy: boolean; onAnswer: (choice: HitChoice) => void }) {
  switch (mode) {
    case "armorOne":
      return (
        <>
          <Button disabled={busy} onPress={() => onAnswer({ kind: "armor", slots: 1 })} variant="solid">
            Mark
          </Button>
          <Button disabled={busy} onPress={() => onAnswer({ kind: "noArmor" })} variant="outline">
            Don&apos;t
          </Button>
        </>
      );
    case "armorMany": {
      const none = previewAt(view, 0);
      return (
        <>
          {slotCounts(view).map((n) => {
            const step = previewAt(view, n);
            const label = step ? `Mark ${n}: ${severityWords(step)}` : `Mark ${n}`;
            return (
              <Button accessibilityLabel={label} disabled={busy} key={n} onPress={() => onAnswer({ kind: "armor", slots: n })} variant="solid">
                {label}
              </Button>
            );
          })}
          <Button accessibilityLabel={none ? `Don't: ${severityWords(none)}` : "Don't"} disabled={busy} onPress={() => onAnswer({ kind: "noArmor" })} variant="outline">
            {none ? `Don't · ${severityWords(none)}` : "Don't"}
          </Button>
        </>
      );
    }
    case "ok":
      return (
        <Button disabled={busy} onPress={() => onAnswer({ kind: "noArmor" })} variant="solid">
          OK
        </Button>
      );
    case "afterArmor":
      return (
        <Button disabled={busy} onPress={() => onAnswer({ kind: "pass" })} variant="solid">
          Done
        </Button>
      );
    case "preRoll":
    case "afterHit":
    case "ally":
      return (
        <Button disabled={busy} onPress={() => onAnswer({ kind: "pass" })} variant="outline">
          Pass
        </Button>
      );
    case "waiting":
      return null;
  }
}

function CardItem({ cardId, disabled, onUse }: { cardId: string; disabled: boolean; onUse: () => void }) {
  const card = cardDisplay(cardId);
  return (
    <View style={[styles.item, { borderColor: card.color }]} testID="incoming-hit-card">
      <Text style={styles.itemName}>{card.name}</Text>
      {card.meta ? <Text style={styles.itemMeta}>{card.meta}</Text> : null}
      {card.text ? <Text style={styles.itemText}>{card.text}</Text> : null}
      <Button accessibilityLabel={`Use ${card.name}`} disabled={disabled} onPress={onUse} variant="solid">
        Use
      </Button>
    </View>
  );
}

/** A grant the attacker gives the hit PC: how much to pay (1..its amount) and Spend. */
function GrantItem({ grant, disabled, onSpend }: { grant: GrantView; disabled: boolean; onSpend: (amount: number) => void }) {
  const [amount, setAmount] = useState(() => grantPay(grant, Number.POSITIVE_INFINITY));
  return (
    <View style={styles.item} testID="incoming-hit-grant">
      <Text style={styles.itemText}>{grant.label}</Text>
      <TextInput
        accessibilityLabel={`How many: ${grant.label}`}
        keyboardType="number-pad"
        onChangeText={(text) => setAmount(grantPay(grant, Number.parseInt(text, 10)))}
        style={styles.input}
        value={String(amount)}
      />
      <Button accessibilityLabel={`Spend ${amount}: ${grant.label}`} disabled={disabled} onPress={() => onSpend(amount)} variant="solid">
        Spend
      </Button>
    </View>
  );
}

/** A feature answer: what its Use asks (counts, a pick, optional steps, situations to confirm), then Use. */
function FeatureItem({ feature, disabled, onUse }: { feature: FeatureView; disabled: boolean; onUse: (picks: FeaturePicks) => void }) {
  const [picks, setPicks] = useState<FeaturePicks>(() => startingPicks(feature));
  const toggle = (group: "optionals" | "situations", id: string) =>
    setPicks((current) => ({ ...current, [group]: { ...current[group], [id]: current[group][id] !== true } }));
  return (
    <View style={styles.item} testID="incoming-hit-feature">
      <Text style={styles.itemName}>{feature.name}</Text>
      <Text style={styles.itemMeta}>Feature</Text>
      {feature.text ? <Text style={styles.itemText}>{feature.text}</Text> : null}
      {feature.numbers.map((n) => (
        <TextInput
          accessibilityLabel={n.label}
          key={n.id}
          keyboardType="number-pad"
          onChangeText={(text) =>
            setPicks((current) => ({ ...current, numbers: { ...current.numbers, [n.id]: Math.max(numberFloor(n), Number.parseInt(text, 10) || 0) } }))
          }
          style={styles.input}
          value={String(picks.numbers[n.id] ?? numberFloor(n))}
        />
      ))}
      {feature.options.map((group) => (
        <View accessibilityLabel={group.label} accessibilityRole="radiogroup" key={group.id} style={styles.list}>
          <Text style={styles.itemMeta}>{group.label}</Text>
          {group.options.map((option) => (
            <Choice
              checked={picks.options[group.id] === option.id}
              key={option.id}
              label={option.label}
              onPress={() => setPicks((current) => ({ ...current, options: { ...current.options, [group.id]: option.id } }))}
              role="radio"
            />
          ))}
        </View>
      ))}
      {feature.optionals.map((o) => (
        <Choice checked={picks.optionals[o.id] === true} key={o.id} label={o.label} onPress={() => toggle("optionals", o.id)} role="checkbox" />
      ))}
      {feature.situations.map((text) => (
        <Choice checked={picks.situations[text] === true} key={text} label={text} onPress={() => toggle("situations", text)} role="checkbox" />
      ))}
      <Button accessibilityLabel={`Use ${feature.name}`} disabled={disabled || !picksReady(feature, picks)} onPress={() => onUse(picks)} variant="solid">
        Use
      </Button>
    </View>
  );
}

function Choice({ checked, label, onPress, role }: { checked: boolean; label: string; onPress: () => void; role: "radio" | "checkbox" }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole={role} accessibilityState={{ checked }} onPress={onPress} style={styles.choice}>
      <Text style={styles.itemText}>{`${checked ? (role === "radio" ? "●" : "☑") : role === "radio" ? "○" : "☐"} ${label}`}</Text>
    </Pressable>
  );
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
  list: {
    gap: space[3],
  },
  item: {
    borderColor: colors.line2,
    borderLeftWidth: 4,
    gap: space[2],
    paddingLeft: space[3],
  },
  itemName: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 17,
    fontWeight: type.sansSemibold.fontWeight,
  },
  itemMeta: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  itemText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
  choice: {
    justifyContent: "center",
    minHeight: 44,
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
