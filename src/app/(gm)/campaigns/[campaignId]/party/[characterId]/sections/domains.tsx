"use client";

import "./domains.css";

import { useQuery } from "convex/react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { DOMAIN_ICONS } from "@/components/party/party-display";
import { Label, SheetBox, Small } from "@/components/party/sheet-ui";
import { assetBackground } from "@/lib/design-assets";
import { cardAvailability } from "@/lib/domain/card-effects/availability";
import { MAX_LEVEL } from "@/lib/domain/characters";
import {
  cardsAllowed,
  cardsWithin,
  cardTakeProblem,
  deckDomains,
  DOMAIN_CARD_CAP,
  sourcesFor,
  unlockLevel,
  type CardTakeProblem,
  type Tier,
} from "@/lib/domain/level-up";
import { DOMAIN_CARD_ART, getDomain, type ClassDef, type DomainCard } from "@/lib/srd";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import type { AdvancementOption } from "@/lib/validation/characters";

import { api } from "../../../../../../../../convex/_generated/api";
import { useLevelUpDraft } from "../level-up-draft";
import { useSheet } from "../sheet-context";
import { recallBlock, resolveCards, vaultCardIds } from "../sheet-helpers";

// Domains > Domain Cards (board page 3): the class domains box (chips, cards chosen with pips, rest swap toggle)
// the green felt table with the fanned loadout hand and the vault deck that spreads the vault cards, and the
// Domain Deck: every card of the character's domains, with filters, face-down cards above their reach and Take card.
// Locked and takeable states come from cardTakeProblem, the same rule the server's takeCard enforces.
// In guided level-up mode (GL3) the deck chooses the new level's cards into the draft instead of taking them, and
// the hand and vault offer the optional exchange (CB 110-111); draft-only state is green, as the ribbon's done marks.
// A card whose once-per limit is used (featureUses `card:<id>`, written on the map by CA4) is greyed, its hand card is
// turned, and a ribbon names when it comes back, from the same cardAvailability the map's Hand and the server use.
// CB p.101, "Usage Limits": "If you use that card, you'll need a way to remember that it's temporarily unavailable. You
// might choose to … turn it on its side". Rests clear the entry through `expire`, so the card is ready again by itself.

const TYPE_LABEL: Record<DomainCard["type"], string> = { ability: "Ability", spell: "Spell", grimoire: "Grimoire" };

/** Card backs per domain (board `cb-*`), used for the vault deck stack; the first is the generic back. */
const GENERIC_BACK = "5bb6a224f710a73fa7d826fa6616fa4d";
const CARD_BACKS: Record<string, string> = {
  arcana: "441cbcb568c811cfa8cc0a651f8f5752",
  blade: "27c8715ef459943156831f0e3c127f38",
  bone: "8c20795f8598bcf81e2f2b55c7c8ac3b",
  codex: "579e104068411cf05c61eaeed505b377",
  dread: "0dd77e7e8b4429d3db87d24a0572de31",
  grace: "644d29b2887b48454029477addb6e286",
  midnight: "58b2cb9a99716b7fdb31aa94614c4017",
  sage: "10d9bc629f16468099536863f2db622b",
  splendor: "4482af05fe6a1c75febf11dab6da1510",
  valor: "4c7f9d2c0b0c64af54dbf902ac891ffe",
};

/** The ribbon under an exhausted card's art (the board's felt palette): the state in words, never by the grey alone. */
const USED_RIBBON: CSSProperties = {
  flex: "none",
  margin: 0,
  padding: "4px 30px 4px 6px",
  background: "rgba(26,20,36,.9)",
  color: "#f6ead2",
  boxShadow: "0 1px 0 #c9a35a, 0 -1px 0 #c9a35a",
  fontFamily: "var(--font-cinzel), serif",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textAlign: "center",
  textTransform: "uppercase",
  lineHeight: 1.25,
};

/** The reset label of a card whose once-per limit is used (`card:<id>` in featureUses), or null while it is ready. */
function usedLabel(sheet: Parameters<typeof cardAvailability>[0], cardId: string): string | null {
  const availability = cardAvailability(sheet, cardId);
  return availability.state === "exhausted" ? availability.label : null;
}

/**
 * The board's hand-card face (`hc-face`): domain-coloured head, art with the Recall badge, meta, text, footer.
 * `used` (the reset label of an exhausted card) greys the card and lays the ribbon over its art.
 */
function CardFace({
  card,
  focusable,
  actsShown,
  used,
  children,
}: {
  card: DomainCard;
  focusable?: boolean;
  actsShown?: boolean;
  used?: string | null;
  children?: ReactNode;
}) {
  const domain = getDomain(card.domain);
  const art = card.art ?? DOMAIN_CARD_ART[card.id];
  const style = { "--dc": domain?.color ?? "#5b2b2b", ...(used ? { filter: "grayscale(.9) brightness(.82)" } : {}) } as CSSProperties;
  return (
    // A hand card is focusable so keyboard users can raise it out of the fan and read it, as the board's tabindex.
    <article
      className="dk-face"
      style={style}
      aria-label={used ? `${card.name}, used: ${used}` : card.name}
      data-exhausted={used ? "true" : undefined}
      tabIndex={focusable ? 0 : undefined}
    >
      <header className="dk-face-head">
        <h4 className="dk-face-name">{card.name}</h4>
        <span className="dk-face-lvl" aria-label={`Level ${card.level}`}>
          {card.level}
        </span>
      </header>
      <div className="dk-face-art" aria-hidden="true" style={{ backgroundImage: art ? assetBackground(art) : "none" }}>
        <span className="dk-face-rc" title="Recall cost">
          {card.recallCost}
        </span>
      </div>
      {/* Outside the aria-hidden art so screen readers read it too; the right padding clears the Recall badge. */}
      {used ? <p style={USED_RIBBON}>Used · {used}</p> : null}
      <div className="dk-face-meta">
        {domain?.name ?? card.domain} {TYPE_LABEL[card.type]} · Recall {card.recallCost}
      </div>
      <p className="dk-face-text">{card.text}</p>
      {children ? <footer className={`dk-face-acts${actsShown ? " show" : ""}`}>{children}</footer> : null}
    </article>
  );
}

/**
 * The board's fan: each card turns 7° per step from the middle and drops by the square of its offset. A used card is
 * turned further and sinks a little (CB p.101: "turn it on its side"); hover and focus still straighten it to read.
 */
function fan(i: number, n: number, turned = false): CSSProperties {
  const off = i - (n - 1) / 2;
  return { "--rot": `${off * 7 + (turned ? 16 : 0)}deg`, "--ty": `${off * off * 7 + (turned ? 14 : 0)}px`, zIndex: i + 1 } as CSSProperties;
}

/** Level-up mode: offers an owned card for the exchange (CB 110), or shows and cancels the one being exchanged. */
function ExchangeControl({ card }: { card: DomainCard }) {
  const lu = useLevelUpDraft();
  if (lu.draft.trade?.out === card.id) {
    return (
      <>
        <span className="dk-lu-badge">Exchanging at level {lu.level}</span>
        <button type="button" className="dk-btn" aria-label={`Cancel exchange of ${card.name}`} onClick={() => lu.setTrade(null)}>
          Cancel exchange
        </button>
      </>
    );
  }
  return (
    <button
      type="button"
      className="dk-btn dk-lu-btn"
      aria-label={`Exchange ${card.name} at level-up`}
      onClick={() => {
        lu.setTrade({ out: card.id, in: "" });
        lu.goTo("deck");
      }}
    >
      Exchange at level-up
    </button>
  );
}

export function DomainCardsSection({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, moveCard, slot } = useSheet();
  const leveling = useLevelUpDraft().active && canEdit;
  const [duringRest, setDuringRest] = useState(false);
  // The vault starts spread so its cards and recall costs are in view; the deck gathers and spreads it again.
  const [vaultOpen, setVaultOpen] = useState(true);
  // The server makes a "during rest" swap free only while the campaign has an open rest (CB 101, 105).
  const rests = useQuery(api.rests.current, canEdit ? { campaignId: slot.campaignId } : "skip");
  const restOpen = Boolean(rests?.open);
  const [busy, setBusy] = useState<string | null>(null);
  const owned = sheet.domainCards.owned.length;
  const loadout = resolveCards(sheet.domainCards.loadout);
  const vault = resolveCards(vaultCardIds(sheet));
  // Board: level + 1 cards, plus one per "additional domain card" advancement.
  const allowed = cardsAllowed(sheet);
  const bonus = allowed - sheet.level - 1;
  const pips = Math.max(allowed, owned);
  const backs = [0, 1, 2].map((i) => CARD_BACKS[vault[vault.length - 1 - i]?.domain ?? cls?.domains[i % cls.domains.length] ?? ""] ?? GENERIC_BACK);
  const deckLabel = `${vaultOpen ? "Close" : "Open"} vault, ${vault.length} card${vault.length === 1 ? "" : "s"}`;

  async function move(card: DomainCard, to: "loadout" | "vault") {
    setBusy(card.id);
    if (to === "vault") setVaultOpen(true);
    await moveCard(card.id, to, duringRest);
    setBusy(null);
  }

  const stack = (
    <>
      {backs
        .map((back, i) => (
          <span key={i} className={`dk-vd-card v${i + 1}`} style={{ backgroundImage: assetBackground(back) }} />
        ))
        .reverse()}
      <span className="dk-vd-count">{vault.length}</span>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <SheetBox label="Domains">
        <div className="dk-top">
          <div className="dk-doms">
            <Label>Class domains</Label>
            {cls?.domains.map((d) => {
              const dom = getDomain(d);
              return (
                <span key={d} className="dk-dom" style={{ background: dom?.color }}>
                  <span className="dk-dom-ic" aria-hidden="true" style={{ backgroundImage: assetBackground(DOMAIN_ICONS[d] ?? "") }} />
                  {dom?.name ?? d}
                </span>
              );
            })}
          </div>
          <div className="dk-allow">
            <strong className="dk-count">
              {owned} of {allowed} cards chosen
            </strong>
            <span className="dk-pips" aria-hidden="true">
              {Array.from({ length: pips }, (_, k) => (
                <span key={k} className={`dk-pip${k < owned ? " on" : ""}`} />
              ))}
            </span>
            <Small className="dk-allow-sub">
              Level {sheet.level} + 1{bonus ? ` + ${bonus} from advancements` : ""}
            </Small>
          </div>
        </div>
        {canEdit ? (
          <div className="dk-rest">
            <label className="dk-toggle">
              <input type="checkbox" checked={duringRest} onChange={(e) => setDuringRest(e.target.checked)} />
              <span>
                Swapping during a rest <span className="dk-rest-when">(free only while the GM has a rest open)</span>
              </span>
            </label>
            <Small className="italic">Moving a card from the vault into your loadout marks Stress equal to its Recall Cost, unless it happens during a rest.</Small>
            {duringRest && !restOpen ? (
              <Small className="dk-warn" data-testid="no-open-rest">
                No rest is open right now: a swap still costs its Recall Cost in Stress.
              </Small>
            ) : null}
          </div>
        ) : null}
      </SheetBox>

      <section className="dk-felt" aria-label="Loadout and vault">
        <div className="dk-felt-head">
          <h3 className="dk-felt-title">Loadout</h3>
          <span className="dk-felt-sub">{loadout.length} / 5 in hand</span>
          <span className="flex-1" />
          <span className="dk-felt-sub" aria-hidden="true">
            Vault
          </span>
        </div>
        <div className="dk-felt-row">
          <div className="dk-hand">
            {loadout.length === 0 ? (
              <p className="dk-empty">Your hand is empty. Take cards from the Domain Deck below, or draw them from your vault.</p>
            ) : (
              <div className="dk-hand-list" role="list" aria-label="Loadout cards">
                {loadout.map((card, i) => {
                  const used = usedLabel(sheet, card.id);
                  return (
                    <div role="listitem" key={card.id} className="dk-hand-card" style={fan(i, loadout.length, used !== null)}>
                      <CardFace card={card} focusable actsShown={leveling} used={used}>
                        {canEdit ? (
                          <button type="button" className="dk-btn" disabled={busy !== null} onClick={() => void move(card, "vault")}>
                            Move to vault
                          </button>
                        ) : null}
                        {leveling ? <ExchangeControl card={card} /> : null}
                      </CardFace>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {canEdit ? (
            <button
              type="button"
              className={`dk-deck${vault.length ? "" : " empty"}${vaultOpen ? " open" : ""}`}
              aria-expanded={vaultOpen}
              aria-controls="dk-vault-spread"
              aria-label={deckLabel}
              onClick={() => setVaultOpen((o) => !o)}
            >
              {stack}
              <span className="dk-vd-lbl">{vaultOpen ? "Click to gather" : "Click to spread"}</span>
            </button>
          ) : (
            // Read-only viewers see the vault spread below; the deck is only its picture.
            <div className={`dk-deck${vault.length ? "" : " empty"} open`} aria-hidden="true">
              {stack}
            </div>
          )}
        </div>
        {vaultOpen || !canEdit ? (
          <div id="dk-vault-spread" className="dk-spread">
            {vault.length === 0 ? (
              <p className="dk-empty">Your vault is empty.</p>
            ) : (
              <div className="dk-spread-list" role="list" aria-label="Vault cards">
                {vault.map((card, i) => {
                  const block = recallBlock(card, sheet.level, loadout.length);
                  // Free only while the box is ticked and the GM has a rest open, as the server decides.
                  const cost = (duringRest && restOpen) || card.recallCost === 0 ? "free" : `${card.recallCost} Stress`;
                  return (
                    <div role="listitem" key={card.id} className="dk-spread-card" style={{ "--d": `${i * 55}ms` } as CSSProperties}>
                      <CardFace card={card} actsShown used={usedLabel(sheet, card.id)}>
                        {canEdit ? (
                          block ? (
                            <span className="dk-block">{block}</span>
                          ) : (
                            <button type="button" className="dk-btn" disabled={busy !== null} onClick={() => void move(card, "loadout")}>
                              Move to loadout ({cost})
                            </button>
                          )
                        ) : null}
                        {leveling ? <ExchangeControl card={card} /> : null}
                      </CardFace>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </section>

      <DomainDeck />
    </div>
  );
}

type DeckEntry = { card: DomainCard; problem: CardTakeProblem | null; locked: boolean };

/** Where a level-up choice of a card goes: the level's card, an "additional domain card" pick, or the exchange. */
type Slot = { kind: "card" } | { kind: "pick"; option: AdvancementOption; tier: number } | { kind: "trade"; out: string };

const cardName = (id: string) => DOMAIN_CARDS.find((c) => c.id === id)?.name ?? id;

/** The board's Domain Deck: filter by domain, hide cards above the character's reach, take a card while picks are left. */
function DomainDeck() {
  const { sheet, canEdit, hopeAndFear, takeCard } = useSheet();
  const lu = useLevelUpDraft();
  const [filter, setFilter] = useState("all");
  const [hideLocked, setHideLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const sources = sourcesFor({ allowExpansion: hopeAndFear });

  // Level-up mode: reach at the new level, with a multiclass domain picked this level (CB 110).
  const leveling = lu.active && canEdit;
  const { draft, level } = lu;
  const multiclassing = draft.picks.some((p) => p.option === "multiclass");
  const reach = leveling && multiclassing && draft.multiclass ? { ...sheet, multiclass: draft.multiclass } : sheet;
  const within = (cap: number) => new Set(leveling ? cardsWithin(reach, level, cap, sources).map((c) => c.id) : []);
  const reachable = within(MAX_LEVEL);
  /** The draft's cards and where each sits. */
  const chosen = new Map<string, Slot>();
  if (leveling) {
    if (draft.cardId) chosen.set(draft.cardId, { kind: "card" });
    for (const p of draft.picks) if (p.option === "domainCard" && p.targets?.[0]) chosen.set(p.targets[0], { kind: "pick", option: p.option, tier: p.tier });
    if (draft.trade?.in) chosen.set(draft.trade.in, { kind: "trade", out: draft.trade.out });
  }
  const openPicks = leveling
    ? draft.picks.filter((p) => p.option === "domainCard" && !p.targets?.[0]).map((p) => ({ tier: p.tier, ids: within(DOMAIN_CARD_CAP[p.tier as Tier] ?? MAX_LEVEL) }))
    : [];
  const openCount = (leveling && !draft.cardId ? 1 : 0) + openPicks.length;
  const tradeOut = leveling && draft.trade && !draft.trade.in ? DOMAIN_CARDS.find((c) => c.id === draft.trade?.out) : undefined;

  /** The open slot a card would fill: the level's card first, then an "additional domain card" pick. */
  function slotFor(card: DomainCard): Slot | null {
    if (!reachable.has(card.id) || chosen.has(card.id)) return null;
    if (!draft.cardId) return { kind: "card" };
    const pick = openPicks.find((p) => p.ids.has(card.id));
    return pick ? { kind: "pick", option: "domainCard", tier: pick.tier } : null;
  }
  function choose(card: DomainCard, slot: Slot) {
    if (slot.kind === "card") lu.setCardId(card.id);
    else if (slot.kind === "pick") lu.setPickTargets(slot.option, slot.tier, [card.id]);
    else lu.setTrade({ out: slot.out, in: card.id });
  }
  function undo(slot: Slot) {
    if (slot.kind === "card") lu.setCardId("");
    else if (slot.kind === "pick") lu.setPickTargets(slot.option, slot.tier, []);
    else lu.setTrade({ out: slot.out, in: "" });
  }

  const doms = deckDomains(reach);
  const active = doms.includes(filter) ? filter : "all";
  const deck: DeckEntry[] = DOMAIN_CARDS.filter((c) => sources.includes(c.source) && doms.includes(c.domain))
    .map((card) => {
      const problem = cardTakeProblem(sheet, card.id, sources);
      // In level-up mode a card that comes within reach at the new level shows face-up.
      return { card, problem, locked: problem?.reason === "locked" && !reachable.has(card.id) };
    })
    .filter(({ card, locked }) => (active === "all" || card.domain === active) && !(hideLocked && locked))
    .sort((a, b) => a.card.level - b.card.level || doms.indexOf(a.card.domain) - doms.indexOf(b.card.domain) || a.card.name.localeCompare(b.card.name));

  async function take(card: DomainCard) {
    setBusy(true);
    await takeCard(card.id);
    setBusy(false);
  }

  /** The level-up buttons of a deck card: choose it, take it in the exchange, or the chosen badge with Undo. */
  function levelUpActs(card: DomainCard) {
    const slot = chosen.get(card.id);
    if (slot) {
      return (
        <>
          <span className="dkc-lu-badge">{slot.kind === "trade" ? `Exchange for ${cardName(slot.out)} at level ${level}` : `Chosen for level ${level}`}</span>
          <button type="button" className="dkc-btn ghost" aria-label={`Undo choice of ${card.name}`} onClick={() => undo(slot)}>
            Undo choice
          </button>
        </>
      );
    }
    if (!reachable.has(card.id)) return null;
    const into = slotFor(card);
    const swaps = tradeOut && card.level <= tradeOut.level;
    return (
      <>
        <button type="button" className="dkc-btn dkc-lu" aria-label={`Choose ${card.name} for level ${level}`} disabled={!into} onClick={() => into && choose(card, into)}>
          Choose for level {level}
        </button>
        {swaps ? (
          <button type="button" className="dkc-btn dkc-lu" aria-label={`Take ${card.name} in exchange for ${tradeOut.name}`} onClick={() => choose(card, { kind: "trade", out: tradeOut.id })}>
            Take in exchange
          </button>
        ) : null}
      </>
    );
  }

  return (
    <SheetBox id="lu-target-deck" title="Domain Deck">
      {leveling ? (
        <div className="dkd-lu">
          <p className="dkd-lu-text">
            {openCount > 0
              ? `Level ${level}: choose ${openCount} domain card${openCount === 1 ? "" : "s"} below.`
              : `Level ${level}: every new domain card is chosen. Undo a choice to change it.`}
            {tradeOut ? ` Exchanging ${tradeOut.name}: take a card of level ${tradeOut.level} or lower in its place.` : ""}
          </p>
          {tradeOut ? (
            <button type="button" className="dkc-btn ghost" onClick={() => lu.setTrade(null)}>
              Cancel exchange
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="dkd-bar">
        <div role="group" aria-label="Filter by domain" className="dkd-filters">
          {["all", ...doms].map((key) => (
            <button key={key} type="button" className="dkd-filter" aria-pressed={active === key} onClick={() => setFilter(key)}>
              {key === "all" ? "All" : (getDomain(key)?.name ?? key)}
            </button>
          ))}
        </div>
        <label className="dk-toggle dkd-hide">
          <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
          <span>Hide cards above my level</span>
        </label>
      </div>
      {deck.length === 0 ? (
        <p className="dkd-empty">No cards to show.</p>
      ) : (
        <div className="dk-grid" role="list" aria-label="Domain Deck cards">
          {deck.map(({ card, problem, locked }) => (
            <div role="listitem" key={card.id} className="dk-grid-item">
              <DeckCard
                card={card}
                problem={problem}
                locked={locked}
                chosen={chosen.has(card.id)}
                canEdit={canEdit}
                busy={busy}
                onTake={() => void take(card)}
                levelUp={leveling ? levelUpActs(card) : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </SheetBox>
  );
}

/**
 * One deck card (board `dkc` in a `dkf` flip wrapper): a face-down card back while it is above the character's reach.
 * `levelUp` (level-up mode) replaces Take card with the draft's buttons.
 */
function DeckCard({
  card,
  problem,
  locked,
  chosen,
  canEdit,
  busy,
  onTake,
  levelUp,
}: {
  card: DomainCard;
  problem: CardTakeProblem | null;
  locked: boolean;
  chosen: boolean;
  canEdit: boolean;
  busy: boolean;
  onTake: () => void;
  levelUp?: ReactNode;
}) {
  const { sheet } = useSheet();
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const turnRef = useRef<HTMLButtonElement>(null);
  const domain = getDomain(card.domain);
  const domainName = domain?.name ?? card.domain;
  const art = card.art ?? DOMAIN_CARD_ART[card.id];
  const owned = problem?.reason === "owned";
  const faceDown = locked && !flipped;
  const unlocks = unlockLevel(sheet, card);
  const leveling = levelUp !== undefined;

  function flip(up: boolean) {
    // The hidden side is inert, so render first, then move focus to the side that now shows.
    flushSync(() => setFlipped(up));
    (up ? turnRef : backRef).current?.focus();
  }

  return (
    <div className={`dkf${locked ? " face" : " plain"}${flipped ? " flipped" : ""}`}>
      <article
        className={`dkc${locked ? " locked" : ""}${owned ? " owned" : ""}${chosen ? " lu-chosen" : ""}${open ? " open" : ""}`}
        style={{ "--dc": domain?.color ?? "#5b2b2b" } as CSSProperties}
        aria-label={card.name}
        aria-hidden={faceDown || undefined}
        inert={faceDown}
      >
        <header className="dkc-head">
          <span className="dkc-ic" aria-hidden="true" style={{ backgroundImage: assetBackground(DOMAIN_ICONS[card.domain] ?? "") }} />
          <h4 className="dkc-name">{card.name}</h4>
          <span className="dkc-lvl" aria-label={`Level ${card.level}`}>
            {card.level}
          </span>
        </header>
        {art ? <div className="dkc-art" aria-hidden="true" style={{ backgroundImage: assetBackground(art) }} /> : null}
        <div className="dkc-meta">
          {domainName} {TYPE_LABEL[card.type]} · Recall {card.recallCost}
        </div>
        {/* More makes the text scroll inside the fixed-size card; it is then focusable so the keyboard can scroll it. */}
        <p className="dkc-text" role={open ? "region" : undefined} tabIndex={open && !faceDown ? 0 : undefined} aria-label={open ? `${card.name} text` : undefined}>
          {card.text}
        </p>
        {locked ? <span className="dkc-lock">{unlocks ? `Unlocks at level ${unlocks}` : "Out of reach"}</span> : null}
        <footer className="dkc-foot">
          <button type="button" className="dkc-more" aria-expanded={open} aria-label={`${open ? "Less" : "More"} about ${card.name}`} onClick={() => setOpen((o) => !o)}>
            {open ? "Less" : "More"}
          </button>
          <span className="flex-1" />
          {owned ? <span className="dkc-badge">{sheet.domainCards.loadout.includes(card.id) ? "In loadout" : "In vault"}</span> : null}
          {locked ? (
            <button ref={turnRef} type="button" className="dkc-btn ghost" aria-label={`Turn over ${card.name}`} onClick={() => flip(false)}>
              Turn over
            </button>
          ) : null}
          {levelUp}
          {canEdit && !leveling && problem === null ? (
            <button type="button" className="dkc-btn" aria-label={`Take ${card.name}`} disabled={busy} onClick={onTake}>
              Take card
            </button>
          ) : null}
          {canEdit && !leveling && problem?.reason === "full" ? (
            <button type="button" className="dkc-btn" aria-label={`No picks left for ${card.name}`} disabled>
              No picks left
            </button>
          ) : null}
        </footer>
      </article>
      {locked ? (
        <button
          ref={backRef}
          type="button"
          className="dkf-back"
          style={{ backgroundImage: assetBackground(CARD_BACKS[card.domain] ?? GENERIC_BACK) }}
          aria-label={`Face-down level ${card.level} ${domainName} card. Turn it over to read it.`}
          aria-hidden={flipped || undefined}
          inert={flipped}
          onClick={() => flip(true)}
        >
          <span className="dkf-tag" aria-hidden="true">
            Level {card.level}
          </span>
        </button>
      ) : null}
    </div>
  );
}
