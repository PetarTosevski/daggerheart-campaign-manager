"use client";

import "./domains.css";

import { useQuery } from "convex/react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { DOMAIN_ICONS } from "@/components/party/party-display";
import { Label, SheetBox, Small } from "@/components/party/sheet-ui";
import { assetBackground } from "@/lib/design-assets";
import { DOMAIN_CARD_ART, getDomain, type ClassDef, type DomainCard } from "@/lib/srd";

import { api } from "../../../../../../../../convex/_generated/api";
import { useSheet } from "../sheet-context";
import { recallBlock, resolveCards, vaultCardIds } from "../sheet-helpers";

// Domains > Domain Cards (board page 3): the class domains box (chips, cards chosen with pips, rest swap toggle)
// and the green felt table with the fanned loadout hand and the vault deck that spreads the vault cards.
// The board's Domain Deck browser is not built (it needs a take-card mutation; open question).

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

/** The board's hand-card face (`hc-face`): domain-coloured head, art with the Recall badge, meta, text, footer. */
function CardFace({ card, focusable, actsShown, children }: { card: DomainCard; focusable?: boolean; actsShown?: boolean; children?: ReactNode }) {
  const domain = getDomain(card.domain);
  const art = card.art ?? DOMAIN_CARD_ART[card.id];
  return (
    // A hand card is focusable so keyboard users can raise it out of the fan and read it, as the board's tabindex.
    <article className="dk-face" style={{ "--dc": domain?.color ?? "#5b2b2b" } as CSSProperties} aria-label={card.name} tabIndex={focusable ? 0 : undefined}>
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
      <div className="dk-face-meta">
        {domain?.name ?? card.domain} {TYPE_LABEL[card.type]} · Recall {card.recallCost}
      </div>
      <p className="dk-face-text">{card.text}</p>
      {children ? <footer className={`dk-face-acts${actsShown ? " show" : ""}`}>{children}</footer> : null}
    </article>
  );
}

/** The board's fan: each card turns 7° per step from the middle and drops by the square of its offset. */
function fan(i: number, n: number): CSSProperties {
  const off = i - (n - 1) / 2;
  return { "--rot": `${off * 7}deg`, "--ty": `${off * off * 7}px`, zIndex: i + 1 } as CSSProperties;
}

export function DomainCardsSection({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, moveCard, slot } = useSheet();
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
  const bonus = (sheet.advancements ?? []).flatMap((a) => a.picks).filter((p) => p.option === "domainCard").length;
  const allowed = sheet.level + 1 + bonus;
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
              <p className="dk-empty">Your hand is empty. Move cards here from your vault.</p>
            ) : (
              <div className="dk-hand-list" role="list" aria-label="Loadout cards">
                {loadout.map((card, i) => (
                  <div role="listitem" key={card.id} className="dk-hand-card" style={fan(i, loadout.length)}>
                    <CardFace card={card} focusable>
                      {canEdit ? (
                        <button type="button" className="dk-btn" disabled={busy !== null} onClick={() => void move(card, "vault")}>
                          Move to vault
                        </button>
                      ) : null}
                    </CardFace>
                  </div>
                ))}
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
                      <CardFace card={card} actsShown>
                        {canEdit ? (
                          block ? (
                            <span className="dk-block">{block}</span>
                          ) : (
                            <button type="button" className="dk-btn" disabled={busy !== null} onClick={() => void move(card, "loadout")}>
                              Move to loadout ({cost})
                            </button>
                          )
                        ) : null}
                      </CardFace>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
