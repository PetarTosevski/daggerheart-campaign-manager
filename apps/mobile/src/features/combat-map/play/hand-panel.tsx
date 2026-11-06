import { useQuery } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { Stepper } from "../../sheet/chrome";
import { useIntent } from "../../sheet/dice/intent";

import { Chip, ChipRow, dockText } from "../chip";
import type { CombatSlotProps } from "../contract";
import {
  actionUses,
  askAnswers,
  askKey,
  candidatesFor,
  chooseAsks,
  numberChoices,
  pickProblem,
  targetingOf,
  targetTokenIdsOf,
  togglePicked,
  blockedReason,
  type ChooseAsk,
  type HandCard,
  type HandUse,
} from "./card-use";
import { MinionPicker, ResultCard } from "./result-card";
import { cardResultView, type CardResult } from "./results";

type OkView = Extract<CombatSlotProps["view"], { state: "ok" }>;

/** The use being set up: its picks, numbers and, after `needsChoice`, the server's asks and the answers so far. */
type Form = {
  cardId: string;
  useId: string;
  picked: string[];
  numbers: Record<string, number>;
  asks: ChooseAsk[] | null;
  /** Asks the phone can't answer (a split, a follow-up link): finish on the website. */
  otherAsks: number;
  answers: Record<string, string>;
};

type Shown = { cardName: string; result: Exclude<CardResult, { status: "needsChoice" }> };

function titleOf(card: Pick<HandCard, "name">, use: Pick<HandUse, "name">, many: boolean): string {
  return many && use.name !== card.name ? `${card.name}: ${use.name}` : card.name;
}

/**
 * The combat Hand on the phone (dcm-gdzi.16): every action use of each loadout card. A use on yourself, on "every
 * enemy in range" or without targets plays at once (the server fills the targets in); one that picks creatures opens
 * its picker (enemies, allies or anyone, as the card says); numbers the card asks first get steppers; a `choose` the
 * server asks for comes back as option chips. Exhausted cards and spent uses are disabled with their reset. Results
 * show the dice, Hit / Miss, damage, "waiting for the GM" and the Minion pick.
 */
export function HandPanel({ campaignId, layout, view }: { campaignId: Id<"campaigns">; layout: CombatSlotProps["layout"]; view: OkView }) {
  const hand = useQuery(api.combatCardsReads.hand, { campaignId, characterId: view.characterId });
  const useCard = useIntent(api.combatCards.useCard);
  const writes = useWritesEnabled();
  const [form, setForm] = useState<Form | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  if (hand === undefined) {
    return (
      <Text accessibilityRole="status" style={dockText.hint}>
        Loading your hand…
      </Text>
    );
  }

  const cards = hand.loadout.filter((c) => actionUses(c).length > 0);
  if (cards.length === 0 && shown === null) {
    return (
      <Text style={dockText.hint} testID="combat-play-hand-empty">
        No combat cards ready in your loadout.
      </Text>
    );
  }

  const names = new Map<string, string>([...view.pcs.map((t) => [t._id, t._id === view.tokenId ? "You" : t.name] as const), ...view.others.map((t) => [t._id, t.name] as const)]);

  async function play(card: HandCard, use: HandUse, f: Form) {
    if (!writes) return;
    const targeting = targetingOf(use);
    if (pickProblem(targeting, f.picked) !== null) return;
    const out = await useCard.fire({
      campaignId,
      characterId: view.characterId,
      mapId: layout._id,
      cardId: card.cardId,
      spell: use.useId,
      targetTokenIds: targetTokenIdsOf(targeting, f.picked) as Id<"combatTokens">[],
      choices: [...numberChoices(use, f.numbers), ...askAnswers(f.asks ?? [], f.answers)],
      roll: { modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0 },
    });
    if (out === undefined) return;
    if (out.status === "needsChoice") {
      const { choose, other } = chooseAsks(out.asks);
      setForm({ ...f, asks: choose, otherAsks: other });
      return;
    }
    setForm(null);
    setShown({ cardName: card.name, result: out });
  }

  function start(card: HandCard, use: HandUse) {
    const fresh: Form = { cardId: card.cardId, useId: use.useId, picked: [], numbers: {}, asks: null, otherAsks: 0, answers: {} };
    // Nothing to pick or set: play at once (the website's "a dialog only when the card needs a choice", CA6).
    if (targetingOf(use).kind === "none" && use.choices.length === 0) {
      void play(card, use, fresh);
      return;
    }
    setForm(fresh);
  }

  return (
    <View accessibilityLabel="Combat hand" style={styles.wrap} testID="combat-play-hand">
      {cards.map((card) => {
        const uses = actionUses(card);
        return (
          <View key={card.cardId} style={styles.card} testID={`combat-hand-card-${card.cardId}`}>
            <Text style={dockText.title}>{card.name}</Text>
            <Text style={dockText.hint}>{card.state === "exhausted" ? (card.resetLabel ?? "Exhausted") : "Ready"}</Text>
            {uses.map((use) => {
              const blocked = blockedReason(card, use);
              const label = titleOf(card, use, uses.length > 1);
              const open = form?.cardId === card.cardId && form.useId === use.useId ? form : null;
              const targeting = targetingOf(use);
              return (
                <View key={use.useId} style={styles.use}>
                  {blocked ? <Text style={dockText.hint}>{blocked}</Text> : null}
                  {open === null ? (
                    <Button
                      accessibilityLabel={`Use ${label}`}
                      disabled={!writes || useCard.pending || blocked !== null || targeting.kind === "website"}
                      onPress={() => start(card, use)}
                      variant="solid"
                    >
                      {uses.length > 1 ? `Use ${use.name}` : "Use"}
                    </Button>
                  ) : null}
                  {targeting.kind === "website" ? <Text style={dockText.hint}>{targeting.text}</Text> : null}
                  {open ? (
                    <UseForm
                      form={open}
                      label={label}
                      onCancel={() => setForm(null)}
                      onChange={setForm}
                      onPlay={() => void play(card, use, open)}
                      pending={useCard.pending}
                      use={use}
                      view={view}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      })}
      {useCard.error ? (
        <Text accessibilityRole="alert" style={dockText.error}>
          {useCard.error}
        </Text>
      ) : null}
      {shown ? <ResultCard onDismiss={() => setShown(null)} testID="combat-card-result" view={cardResultView(shown.cardName, shown.result, names)} /> : null}
      {shown?.result.status === "resolved" && shown.result.minionOffer ? (
        <MinionPicker
          campaignId={campaignId}
          entryId={shown.result.entryId}
          offer={shown.result.minionOffer}
          onDone={() => setShown((s) => (s && s.result.status === "resolved" ? { ...s, result: { ...s.result, minionOffer: null } } : s))}
        />
      ) : null}
    </View>
  );
}

function UseForm({
  form,
  label,
  use,
  view,
  pending,
  onChange,
  onPlay,
  onCancel,
}: {
  form: Form;
  label: string;
  use: HandUse;
  view: OkView;
  pending: boolean;
  onChange: (form: Form) => void;
  onPlay: () => void;
  onCancel: () => void;
}) {
  const writes = useWritesEnabled();
  const targeting = targetingOf(use);
  const candidates = targeting.kind === "pick" ? candidatesFor(targeting.side, view) : [];
  const problem = pickProblem(targeting, form.picked);
  const unanswered = (form.asks ?? []).some((a) => form.answers[askKey(a)] === undefined);
  const stuck = form.otherAsks > 0;

  return (
    <View style={styles.form} testID="combat-use-form">
      {targeting.kind === "none" ? <Text style={dockText.hint}>{targeting.text}</Text> : null}
      {targeting.kind === "pick" ? (
        candidates.length === 0 ? (
          <Text style={dockText.hint}>Nobody in sight to pick.</Text>
        ) : (
          <ChipRow label={`Targets for ${label}`}>
            {candidates.map((c) => (
              <Chip
                accessibilityLabel={`Pick ${c.name}`}
                key={c.tokenId}
                label={c.name}
                onPress={() => onChange({ ...form, picked: togglePicked(form.picked, c.tokenId, targeting.max) })}
                selected={form.picked.includes(c.tokenId)}
                testID={`combat-card-target-${c.tokenId}`}
              />
            ))}
          </ChipRow>
        )
      ) : null}
      {use.choices.map((c) => (
        <Stepper
          key={c.id}
          label={c.label}
          max={99}
          min={c.min}
          onStep={(d) => onChange({ ...form, numbers: { ...form.numbers, [c.id]: Math.max(c.min, (form.numbers[c.id] ?? c.min) + d) } })}
          readOnly={false}
          value={form.numbers[c.id] ?? c.min}
        />
      ))}
      {(form.asks ?? []).map((ask) => (
        <View key={askKey(ask)} style={styles.use}>
          <Text style={dockText.body}>{ask.label}</Text>
          <ChipRow label={ask.label}>
            {ask.options.map((o) => (
              <Chip
                key={o.id}
                label={o.label}
                onPress={() => onChange({ ...form, answers: { ...form.answers, [askKey(ask)]: o.id } })}
                selected={form.answers[askKey(ask)] === o.id}
              />
            ))}
          </ChipRow>
        </View>
      ))}
      {stuck ? <Text style={dockText.hint}>This card asks for a split or a follow-up target: finish it on the website.</Text> : null}
      {problem ? <Text style={dockText.hint}>{problem}</Text> : null}
      <View style={styles.buttons}>
        <Button accessibilityLabel={`Play ${label}`} disabled={!writes || pending || problem !== null || unanswered || stuck} onPress={onPlay} variant="solid">
          {pending ? "Playing…" : form.asks ? "Continue" : "Play"}
        </Button>
        <Button accessibilityLabel={`Cancel ${label}`} onPress={onCancel} variant="outline">
          Cancel
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  card: { gap: space[2] },
  use: { gap: space[2] },
  form: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
