"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";

import type { Footprint } from "@/lib/domain/combat-actions/distance";
import { refusalFor } from "@/lib/errors/refusals";
import type { TraitId } from "@/lib/srd/types";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { riderKey, ridersToSend, type RiderOption, type RiderPicks } from "../../actions/attack/riders";
import { answerChoices, choicesOf, fitsSide, type CardChoice, type ChoiceAsk, type FormValues, type UseForm } from "../../actions/hand/model";
import { useActor } from "../../actions/targets";
import { areaUseArgs, areaUseLine } from "../../drawer/use/model";
import type { CombatMapSummary, CombatRole } from "../../slots";
import { usePick, type PickApi, type PickContext, type PickOption, type PickOutcome, type PickRowInput, type PickSelection, type PickSessionSpec } from "../pick";
import { chainAnswer, chainRows, startAreaPick, type ChainCreature, type ChainLinks } from "../pick-area";
import { showFeatureResult } from "../result";
import { hudToasts } from "../toasts/store";
import { AskRows, FormRows } from "./rows";
import {
  areaAskOf,
  askText,
  featurePlan,
  hasActionRoll,
  hopeShortfall,
  noPickText,
  payLine,
  riderLabel,
  riderNote,
  riderPill,
  riderSwitches,
  ruleOf,
  type FeaturePlan,
  type FeatureUseOutcome,
} from "./model";

/**
 * A feature's Use through the HUD's picking panel (plan combat-hud H3.3; CmpPicking; fold-in dcm-aiwg). The entry point
 * the sheet panel (H2.1) and the action ring (H3.4) call, from a click handler:
 *
 *   const featureUse = useFeatureUse({ campaignId, role, map, characterId });
 *   onClick={() => { if (featureUse.open({ featureId, useId }) === "classic") showClassicFlow(); }}
 *
 * `open` returns what it did:
 * - "picker": the picking panel opened (usePick): targets from the use's rule (rows and rings in step), its riders on
 *   the action roll (dcm-aiwg) and its options as switches with cost pills, what it asks first (trait, numbers, choices,
 *   allies) as extra rows, the cost line and ONE primary "Use Fangs on Lieutenant". Out of range: the server answers
 *   `pending` and "Waiting for the GM" shows (H3.0). After the roll the server's asks come back (`needsChoice`): the next
 *   panel answers them; a chain's next link is picked on the map with numbered links (CmpPicking 'Chain links').
 * - "area": square picking on the map (Dark Cloud: crosshair, radius, banner; a wall's two draggable ends); when the use
 *   also has riders or options the panel comes first and its primary ("Pick the square") starts the square pick.
 * - "classic": the HUD has no flow for it; the caller keeps the classic `FeatureUse` (Warden's Protection's rolled count,
 *   Charge), or there is no live map / token to act from.
 * The result shows in the result panel (H4.1, `showFeatureResult`; dcm-bxp.99.32.26): the roll, Hit / Miss / Defeated
 * per target, the use's notes and table steps.
 */

export type FeatureUseArgs = {
  campaignId: Id<"campaigns">;
  role: CombatRole;
  map: CombatMapSummary | null;
  /** The character using it: the player's own; the GM's Play-for PC. */
  characterId: Id<"characters">;
  /**
   * The viewer may use this character's features (own sheet; the GM with Play for on). False skips the drawer and riders
   * reads: they refuse another player's hidden hand (FORBIDDEN), and `open` answers "classic".
   */
  canUse?: boolean;
};

export type FeatureUseOpen = { featureId: string; useId: string; /** Header name; default the use's. */ name?: string };

export type FeatureUseApi = { open: (input: FeatureUseOpen) => "picker" | "area" | "classic" };

/** The panel's picker state (`FormValues` without what the selection holds). */
type FormData = Omit<FormValues, "targets" | "situations" | "optionals">;

type AskData = { asks: readonly ChoiceAsk[]; options: Record<string, string[]>; splits: Record<string, number>; chain: ChainLinks };

type Creature = ChainCreature;

const SITUATION = (i: number) => `situation:${i}`;
const OPTIONAL = (id: string) => `optional:${id}`;
const RIDER = (o: RiderOption) => `rider:${riderKey(o)}`;

/** The rider picks the switches stand for: on, numbers at their minimum, each option's first choice, its situations confirmed. */
export function riderPicksOf(riders: readonly RiderOption[], options: Readonly<Record<string, boolean>>): RiderPicks {
  return Object.fromEntries(
    riders.map((o) => [
      riderKey(o),
      {
        on: options[RIDER(o)] === true,
        numbers: {},
        options: Object.fromEntries(o.options.flatMap((x) => (x.options[0] ? [[x.id, x.options[0].id]] : []))),
        situations: [...o.situations],
        extra: [],
      },
    ]),
  );
}

/** The use's `choices` from the panel: its form's answers (`choicesOf`) with the selection's situations and optionals. */
export function featureChoices(form: UseForm, data: FormData, selection: Pick<PickSelection, "targetIds" | "options">): CardChoice[] {
  const values: FormValues = {
    ...data,
    targets: selection.targetIds,
    situations: form.situations.filter((_, i) => selection.options[SITUATION(i)] === true),
    optionals: Object.fromEntries(form.optionals.map((o) => [o.id, selection.options[OPTIONAL(o.id)] ?? o.defaultOn])),
  };
  return choicesOf(form, values);
}

/** The panel's switches: riders (dcm-aiwg), optional parts, situations to confirm. */
export function featureOptions(form: UseForm, riders: readonly RiderOption[]): PickOption[] {
  const out: PickOption[] = [];
  for (const o of riders) {
    const pill = riderPill(o);
    const note = riderNote(o);
    out.push({ id: RIDER(o), label: riderLabel(o), ...(note ? { note } : {}), ...(pill ? { cost: pill } : {}), disabled: !o.ready });
  }
  for (const o of form.optionals) out.push({ id: OPTIONAL(o.id), label: o.label, defaultOn: o.defaultOn });
  form.situations.forEach((s, i) => out.push({ id: SITUATION(i), label: s, note: "Confirm it applies" }));
  return out;
}

/** What still blocks the primary: an unconfirmed situation, a choice not made, Hope short (CmpBlocked layer 1). */
export function featureBlocked(form: UseForm, data: FormData, selection: Pick<PickSelection, "options">, hopeShort: string | null): string | null {
  if (hopeShort) return hopeShort;
  const missing = form.situations.findIndex((_, i) => selection.options[SITUATION(i)] !== true);
  if (missing >= 0) return `Confirm: ${form.situations[missing]}`;
  for (const c of form.choose) if ((data.options[c.stepId] ?? []).length === 0) return `Choose: ${c.label}`;
  if (form.traits && !data.trait) return "Pick a trait";
  return null;
}

function initialData(form: UseForm): FormData {
  return {
    numbers: Object.fromEntries(form.numbers.map((n) => [n.id, n.min])),
    eithers: Object.fromEntries(form.eithers.map((e) => [e.index, 0])),
    recipients: {},
    ...(form.weapon ? { weapon: "primary" as const } : {}),
    ...(form.traits ? { trait: form.traits[0] } : {}),
    options: {},
  };
}

/** Whether a use asks nothing the panel shows (riders, options, numbers, choices...): an area use then goes straight to the map. */
function asksNothing(form: UseForm, options: readonly PickOption[]): boolean {
  return (
    options.length === 0 &&
    form.numbers.length === 0 &&
    form.eithers.length === 0 &&
    form.choose.length === 0 &&
    form.recipients.length === 0 &&
    !form.weapon &&
    !form.traits &&
    !form.gmDifficulty
  );
}

export function useFeatureUse({ campaignId, role, map, characterId, canUse = true }: FeatureUseArgs): FeatureUseApi {
  const pick = usePick();
  // The newest pick API, for a send that opens the next step after its await (the one it closed over is stale then).
  const latest = useRef<PickApi>(pick);
  useEffect(() => {
    latest.current = pick;
  });
  const gm = role === "gm";
  const live = map?.live === true ? map : null;
  const sendUse = useMutation(api.combatFeatures.useFeature);
  const convex = useConvex();
  const drawer = useQuery(api.combatFeaturesReads.drawer, canUse ? { campaignId, characterId } : "skip");
  const actor = useActor({ campaignId, role, mode: "play", map: live, previewCharacterId: null });
  const gmTokens = useQuery(api.combatTokensReads.list, gm && live && canUse ? { campaignId, mapId: live._id } : "skip");

  // Who is on the map, for names, chain rows and the actor's square.
  let creatures: Creature[] = [];
  let self: (Footprint & { tokenId: Id<"combatTokens">; name: string }) | null = null;
  /** The character's name for the result panel's sub line ("Moss · Roll"). */
  let actorName = "";
  if (gm) {
    creatures = (gmTokens ?? []).map((t) => ({ tokenId: t._id, name: t.name, side: t.characterId === characterId ? "self" : t.side, at: { x: t.x, y: t.y, size: t.size } }));
    const mine = gmTokens?.find((t) => t.characterId === characterId);
    if (mine) self = { tokenId: mine._id, name: mine.name, x: mine.x, y: mine.y, size: mine.size };
    actorName = mine?.name ?? "";
  } else if (actor && actor.characterId === characterId) {
    const view = actor.view;
    creatures = [
      ...view.pcs.map((p) => ({ tokenId: p._id, name: p.name, side: (p._id === view.tokenId ? "self" : "pc") as Creature["side"], at: { x: p.x, y: p.y, size: p.size } })),
      ...view.others.map((t) => ({ tokenId: t._id, name: t.name, side: t.side as Creature["side"], at: { x: t.x, y: t.y, size: t.size } })),
    ];
    const me = view.pcs.find((p) => p._id === view.tokenId);
    if (me) self = { tokenId: me._id, name: "You", x: me.x, y: me.y, size: me.size };
    actorName = me?.name ?? "You";
  }
  const hope = drawer?.trackers.hope.value ?? null;

  function open({ featureId, useId, name }: FeatureUseOpen): "picker" | "area" | "classic" {
    const plan = featurePlan(featureId, useId);
    if (!canUse || plan.kind === "classic" || live === null || self === null) return "classic";
    const mapId = live._id;
    const title = name ?? plan.name;
    const baseId = `feature:${characterId}:${featureId}:${plan.use.id}`;
    const names = new Map<string, string>(creatures.map((c) => [c.tokenId, c.side === "self" ? (gm ? c.name : "You") : c.name]));
    const actorSpec = gm && self ? { actor: { tokenId: self.tokenId, characterId } } : {};
    const selfRow: PickRowInput = { tokenId: self.tokenId, name: gm ? self.name : "You", side: "self", band: null, reach: "in" };
    const origin: Footprint = { x: self.x, y: self.y, size: self.size };
    /**
     * dcm-bxp.99.32.19: the riders on the use's action roll come from the server (`combatFeatures.riders`, for the trait
     * and weapon the panel holds); a use without an action roll has none and opens at once.
     */
    const ridersFor = async (data: Pick<FormData, "trait" | "weapon">): Promise<RiderOption[]> =>
      hasActionRoll(plan.use)
        ? riderSwitches(
            await convex.query(api.combatFeatures.riders, {
              campaignId,
              characterId,
              featureId,
              useId: plan.use.id,
              ...(data.trait ? { trait: data.trait } : {}),
              ...(data.weapon ? { weapon: data.weapon } : {}),
            }),
          )
        : [];
    if (hasActionRoll(plan.use)) {
      ridersFor(initialData(plan.form)).then((riders) => start(plan, riders), (e: unknown) => hudToasts.refusal(refusalFor(e, { subject: title })));
    } else {
      start(plan, []);
    }
    return plan.kind === "area" ? "area" : "picker";

    /** Opens the panel (or the square pick) once the riders are known. */
    function start(chosen: Extract<FeaturePlan, { kind: "panel" | "area" }>, riders: RiderOption[]): void {
      const options = featureOptions(chosen.form, riders);
      const hopeShort = hopeShortfall(chosen.use.costs, hope);
      const base = { campaignId, characterId, mapId, featureId, useId: chosen.use.id };

      /** Sends the use; a `needsChoice` opens the panel for the server's asks (chain links on the map). */
      async function run(args: { targetTokenIds: Id<"combatTokens">[]; choices: CardChoice[]; roll?: { trait?: TraitId; difficulty?: number }; riders: ReturnType<typeof ridersToSend>; point?: { x: number; y: number }; points?: { x: number; y: number }[] }, step: number, links: Id<"combatTokens">[][], rows: readonly PickRowInput[]): Promise<PickOutcome> {
        const { riders: sent, ...rest } = args;
        const out: FeatureUseOutcome = await sendUse({ ...base, idempotencyKey: crypto.randomUUID(), ...rest, ...(sent.length > 0 ? { riders: sent } : {}) });
        if (out.status === "pending") return { kind: "pending", requestId: out.requestId };
        if (out.status === "needsChoice") {
          openAsks(args, out.asks, step + 1, links, rows);
          return { kind: "stay" };
        }
        // dcm-bxp.99.32.26: the result panel (H4.1), as a card's or an attack's result.
        showFeatureResult({ characterId, actorName, featureName: title, result: out, names });
        return { kind: "done" };
      }

      function openAsks(args: Parameters<typeof run>[0], asks: readonly ChoiceAsk[], step: number, links: Id<"combatTokens">[][], rows: readonly PickRowInput[]) {
        const chainAsk = asks.find((a): a is Extract<ChoiceAsk, { kind: "followUp" }> => a.kind === "followUp");
        const lastLink = links[links.length - 1] ?? [];
        const askRows = chainAsk ? chainRows(chainAsk.tokenIds, creatures, lastLink) : rows;
        const data: AskData = { asks, options: {}, splits: {}, chain: { links } };
        const primaryFor = (d: AskData): PickSessionSpec<AskData>["primary"] => ({
          label: (s) => (chainAsk ? (s.targetIds.length > 0 ? "Next link" : "Stop here") : "Confirm"),
          send: async (s) => {
            const answers = answerChoices(
              asks.filter((a) => a.kind !== "followUp"),
              d.options,
              d.splits,
            );
            const chain = chainAsk ? [chainAnswer(chainAsk.link, s.targetIds)] : [];
            const nextLinks = chainAsk && s.targetIds.length > 0 ? [...links, [...s.targetIds]] : links;
            return run({ ...args, choices: [...args.choices, ...answers, ...chain] }, step, nextLinks, rows);
          },
        });
        latest.current.open<AskData>({
          id: `${baseId}:ask:${step}`,
          source: { kind: "feature", name: title },
          // The server's asks for a use already under way: the GM's spotlight never holds them back.
          followUp: true,
          rule: chainAsk ? { side: "any", max: null, range: "unlimited", min: 0, text: askText(asks) } : { side: "any", max: null, range: "unlimited", min: 0, locked: true, text: askText(asks) },
          rows: askRows,
          ...(chainAsk ? {} : { picked: askRows.map((r) => r.tokenId) }),
          ...actorSpec,
          data,
          extra: (ctx: PickContext<AskData>) => (
            <AskRows asks={asks} data={ctx.data} names={names} onChange={(next) => ctx.update({ data: next, primary: primaryFor(next) })} />
          ),
          primary: primaryFor(data),
        });
      }

      // ---- squares on the map
      if (chosen.kind === "area") {
        const startSquares = (choices: CardChoice[], ridersSent: ReturnType<typeof ridersToSend>, roll: { trait?: TraitId } | undefined, n: number) => {
          startAreaPick({
            ...areaAskOf(title, chosen.area, chosen.picks, origin, n),
            id: baseId,
            mapId,
            pay: payLine(chosen.use.costs, hope),
            send: async (squares) => {
              const squareArgs = areaUseArgs(chosen.picks, squares);
              const out = await sendUse({
                ...base,
                idempotencyKey: crypto.randomUUID(),
                targetTokenIds: [],
                point: squareArgs.point,
                ...(squareArgs.points ? { points: squareArgs.points } : {}),
                choices: [...choices, ...squareArgs.choices],
                ...(roll ? { roll } : {}),
                ...(ridersSent.length > 0 ? { riders: ridersSent } : {}),
              });
              if (out.status === "pending") return { kind: "pending", line: `${title}: waiting for the GM to approve.` };
              return { kind: "done", line: areaUseLine(title, chosen.area.label, out) };
            },
          });
        };
        if (asksNothing(chosen.form, options) && !hopeShort) {
          latest.current.finish();
          startSquares([], [], undefined, 1);
          return;
        }
        openPanel(chosen, async (s, data) => {
          const ridersNow = await ridersFor(data);
          startSquares(featureChoices(chosen.form, data, s), ridersToSend(ridersNow, riderPicksOf(ridersNow, s.options)), data.trait ? { trait: data.trait } : undefined, data.numbers[chosen.form.numbers[0]?.id ?? ""] ?? 1);
          return { kind: "done" };
        });
        return;
      }

      openPanel(chosen, async (s, data) => {
        const ridersNow = await ridersFor(data);
        const roll = { ...(data.trait ? { trait: data.trait } : {}), ...(gm && data.difficulty !== undefined ? { difficulty: data.difficulty } : {}) };
        // A use with no target rule shows you as its (locked) row; the server takes no target for it.
        const picks = ruleOf(chosen.form) ? s.targetIds : [];
        const rows: PickRowInput[] = picks.length > 0 ? s.targets.map((t) => ({ tokenId: t.tokenId, name: t.name, side: t.side, band: t.band, reach: t.reach })) : [selfRow];
        return run(
          {
            targetTokenIds: [...picks],
            choices: featureChoices(chosen.form, data, s),
            ...(Object.keys(roll).length > 0 ? { roll } : {}),
            riders: ridersToSend(ridersNow, riderPicksOf(ridersNow, s.options)),
          },
          0,
          picks.length > 0 ? [[...picks]] : [],
          rows,
        );
      });

      function openPanel(p: Extract<FeaturePlan, { kind: "panel" | "area" }>, go: (s: PickSelection, data: FormData) => Promise<PickOutcome>) {
        const rule = ruleOf(p.form);
        const primaryFor = (data: FormData): PickSessionSpec<FormData>["primary"] => ({
          label: (s) => (p.kind === "area" ? (p.picks.kind === "wall" ? "Pick the two ends" : "Pick the square") : s.targets[0] && rule ? `Use ${title} on ${s.targets[0].name}` : `Use ${title}`),
          pay: () => payLine(p.use.costs, hope),
          blocked: (s) => featureBlocked(p.form, data, s, hopeShort),
          send: (s) => go(s, data),
        });
        const data = initialData(p.form);
        const recipients = (side: string) => creatures.filter((c) => fitsSide({ tokenId: c.tokenId, name: c.name, side: c.side }, side as Parameters<typeof fitsSide>[1]));
        latest.current.open<FormData>({
          id: baseId,
          source: { kind: "feature", name: title },
          rule: rule ? { ...rule, min: 1 } : { side: "selfOrAlly", max: 1, range: "unlimited", min: 0, locked: true, text: p.kind === "area" ? `Then pick ${p.picks.kind === "wall" ? "two points" : "a square"} on the map` : noPickText(p.use.targets) },
          ...(rule ? {} : { rows: [selfRow], picked: [self!.tokenId] }),
          ...actorSpec,
          options,
          data,
          ...(asksNothing(p.form, []) ? {} : { extra: (ctx: PickContext<FormData>) => <FormRows form={p.form} data={ctx.data} gm={gm} recipients={recipients} onChange={(next) => ctx.update({ data: next, primary: primaryFor(next) })} /> }),
          primary: primaryFor(data),
        });
      }
    }
  }

  return { open };
}

export { featurePlan, areaAskOf, payLine, resultLine, costPill } from "./model";
