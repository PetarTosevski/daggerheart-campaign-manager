import { designAsset } from "@/lib/design-assets";
import { refusalForCode } from "@/lib/errors/refusals";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TokenView } from "../../../../../convex/combatTokens";
import type { OtherToken } from "../../vision/use-vision";
import type { HudSheetTarget } from "../state";

/**
 * The Combat HUD's token anatomy (plan combat-hud H1.3; HANDOFF "Tokens"; board CmpTokens "Token anatomy" and "Token
 * kinds"), as pure functions the face and the two token layers share:
 * - side colour (`toneOf`): you gold + glow, ally PC teal, ally NPC mint, neutral grey, adversary red;
 * - arcs (`arcsOf`): the left half is HP LEFT, the right half Stress MARKED (user answer 2), in percent of the path;
 * - the accessible name (`tokenLabel`): what a click does, then HP / Stress as "n of 6 marked" (answer 2), Hope and
 *   conditions.
 *
 * Hard rule 2 (players never see adversary numbers) lives in `showsNumbers`: a player gets arcs, numbers and Hope for
 * PC tokens only. Adversary and custom tokens reach a player only through `combatVision.playerView`'s `others`, which
 * carry no numbers at all (`otherFace` has nothing to draw them from); `pcTokenFace` checks again so a stray stats
 * object could never become a ring.
 */

export type TokenTone = "you" | "ally-pc" | "ally" | "neutral" | "enemy";

/** A token side as both token sources spell it. */
export type TokenSide = TokenView["side"];

/** Side colour: your own PC gold, other PCs teal, allied NPCs mint, neutrals grey, adversaries red. */
export function toneOf(side: TokenSide, mine: boolean): TokenTone {
  if (side === "pc") return mine ? "you" : "ally-pc";
  if (side === "enemy") return "enemy";
  return side;
}

/** The arcs in percent of each half (pathLength 100): HP left and Stress marked. */
export type TokenArcs = { hpLeft: number; stressMarked: number };

type Track = { marked: number; max: number };

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((100 * Math.max(0, Math.min(part, whole))) / whole);
}

/** The arcs of a token whose numbers the viewer may see; null without a track to draw. */
export function arcsOf(hp: Track, stress: Track): TokenArcs | null {
  if (hp.max <= 0 && stress.max <= 0) return null;
  return { hpLeft: percent(hp.max - hp.marked, hp.max), stressMarked: percent(stress.marked, stress.max) };
}

/** Whether a viewer sees a token's numbers (arcs, "n of 6 marked", Hope): the GM always, a player only on PCs. */
export function showsNumbers(role: "gm" | "player", kind: TokenView["kind"]): boolean {
  return role === "gm" || kind === "pc";
}

/** "2 of 6 Hit Points marked" (answer 2: text says what is marked, the ring shows what is left). */
export function markedPhrase(marked: number, max: number, noun: "Hit Points" | "Stress"): string {
  return `${marked} of ${max} ${noun} marked`;
}

/**
 * The words of a move announcement inside the HUD (H6.2, CmpBlocked MOVE_BLOCKED: "Something blocks the way.", the
 * token snaps back): a refused move reads the refusal table; the GM's warning keeps its own words.
 */
export function moveNoticeText(notice: { kind: "blocked" | "warning"; text: string }): string {
  return notice.kind === "blocked" ? refusalForCode("MOVE_BLOCKED").lead : notice.text;
}

/** A condition id as its badge and label read it ("vulnerable" -> "Vulnerable"). */
export function conditionName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export type TokenCondition = { id: string; label: string };

/** The face's art: next/image source, its object position, and whether it is a remote URL (no optimiser). */
export type TokenArt = { src: string; position: string; remote: boolean };

/** A token portrait (uploaded or rulebook URL, or design asset) as face art; null draws initials. */
export function artOf(portrait: TokenView["portrait"] | OtherToken["portrait"]): TokenArt | null {
  if (!portrait) return null;
  if (portrait.kind === "url") return { src: portrait.url, position: "center 25%", remote: true };
  const src = designAsset(portrait.asset);
  return src ? { src, position: portrait.position, remote: false } : null;
}

/** Everything `TokenFace` draws, plus the button's accessible name and the sheet a click opens. */
export type HudTokenFace = {
  label: string;
  tone: TokenTone;
  art: TokenArt | null;
  arcs: TokenArcs | null;
  hope: number | null;
  conditions: TokenCondition[];
  down: boolean;
  /** The sheet (PC) or stat block (GM, adversary) a click opens; null: a click only selects. */
  sheet: HudSheetTarget | null;
};

const SIDE_LABEL: Record<TokenSide, string> = { pc: "Party", enemy: "Enemy", ally: "Ally", neutral: "Neutral" };

/** "Open Moss’s sheet, 2 of 6 Hit Points marked, 3 of 6 Stress marked, 1 Hope, Vulnerable". */
export function tokenLabel(head: string, details: readonly string[]): string {
  return [head, ...details].join(", ");
}

/**
 * A token from `tokens-layer.tsx` (the GM's `combatTokens.list`, or a player's PC tokens from `playerView.pcs` /
 * `combatTokens.party`), with the PC's Hope from `combatHud.party` when it has loaded.
 */
export function pcTokenFace(token: TokenView, role: "gm" | "player", hope: number | null): HudTokenFace {
  const numbers = showsNumbers(role, token.kind);
  const s = numbers ? token.stats : null;
  const conditions = (token.stats?.conditions ?? []).map((id) => ({ id, label: conditionName(id) }));
  const sheet: HudSheetTarget | null =
    token.kind === "pc" && token.characterId
      ? { kind: "pc", characterId: token.characterId }
      : token.kind === "adversary" && role === "gm"
        ? { kind: "adversary", tokenId: token._id }
        : null;
  const head =
    sheet?.kind === "pc"
      ? `Open ${token.name}’s sheet${token.mine ? " (your character)" : ""}`
      : sheet?.kind === "adversary"
        ? `Open the ${token.name}’s stat block`
        : `${token.name}, ${SIDE_LABEL[token.side]}`;
  const details: string[] = [];
  if (s && s.hpMax > 0) details.push(markedPhrase(s.hp, s.hpMax, "Hit Points"));
  if (s && s.stressMax > 0) details.push(markedPhrase(s.stress, s.stressMax, "Stress"));
  const shownHope = numbers && token.kind === "pc" ? hope : null;
  if (shownHope !== null) details.push(`${shownHope} Hope`);
  details.push(...conditions.map((c) => c.label));
  if (s?.down) details.push("down");
  return {
    label: tokenLabel(head, details),
    tone: toneOf(token.side, token.mine),
    art: artOf(token.portrait),
    arcs: s ? arcsOf({ marked: s.hp, max: s.hpMax }, { marked: s.stress, max: s.stressMax }) : null,
    hope: shownHope,
    conditions,
    down: token.stats?.down ?? false,
    sheet,
  };
}

/**
 * A non-PC token a player sees (`playerView.others`: name, side, facing, art, condition names; never a number, R4 /
 * hard rule 2). No arcs, no Hope: there is nothing to draw them from.
 */
export function otherFace(token: OtherToken, targeted: boolean): HudTokenFace {
  const conditions = token.conditions ?? [];
  const details = [...conditions.map((c) => c.label)];
  if (token.revealed) details.push("revealed to you");
  if (targeted) details.push("your target");
  return {
    label: tokenLabel(`${token.name}, ${SIDE_LABEL[token.side]}`, details),
    tone: toneOf(token.side, false),
    art: artOf(token.portrait),
    arcs: null,
    hope: null,
    conditions,
    down: false,
    sheet: null,
  };
}

/** The Hope of each PC token on the map, from `combatHud.party` rows. */
export function hopeByToken(rows: readonly { tokenId: Id<"combatTokens">; hope: { value: number } }[] | undefined): ReadonlyMap<string, number> {
  return new Map((rows ?? []).map((r) => [r.tokenId as string, r.hope.value]));
}
