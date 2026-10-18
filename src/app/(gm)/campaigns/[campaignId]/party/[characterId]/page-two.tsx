"use client";

import { useQuery } from "convex/react";
import { useState, type CSSProperties } from "react";

import { assetBackground } from "@/lib/design-assets";
import { DOMAIN_CARD_ART, getDomain, type ClassDef, type DomainCard } from "@/lib/srd";

import { api } from "../../../../../../../convex/_generated/api";
import { useSheet } from "./sheet-context";
import { recallBlock, resolveCards, vaultCardIds } from "./sheet-helpers";

const TYPE_LABEL: Record<DomainCard["type"], string> = { ability: "Ability", spell: "Spell", grimoire: "Grimoire" };

function CardFace({ card, children }: { card: DomainCard; children?: React.ReactNode }) {
  const domain = getDomain(card.domain);
  const art = card.art ?? DOMAIN_CARD_ART[card.id];
  return (
    <article className="cs-dkc" style={{ "--dc": domain?.color ?? "#5b2b2b" } as CSSProperties} aria-label={card.name}>
      <div className="cs-dkc-head">
        <h4 className="cs-dkc-name">{card.name}</h4>
        <span className="cs-dkc-lvl" aria-label={`Level ${card.level}`}>
          {card.level}
        </span>
      </div>
      <div className="cs-dkc-art" aria-hidden="true" style={{ backgroundImage: art ? assetBackground(art) : "none" }} />
      <div className="cs-dkc-meta">
        {domain?.name ?? card.domain} {TYPE_LABEL[card.type]} · Recall {card.recallCost}
      </div>
      <p className="cs-dkc-text">{card.text}</p>
      {children ? <div className="cs-dkc-foot">{children}</div> : null}
    </article>
  );
}

export function PageTwo({ cls }: { cls: ClassDef | undefined }) {
  const { sheet, canEdit, moveCard, slot } = useSheet();
  const [duringRest, setDuringRest] = useState(false);
  // The server makes a "during rest" swap free only while the campaign has an open rest (CB 101, 105).
  const rests = useQuery(api.rests.current, canEdit ? { campaignId: slot.campaignId } : "skip");
  const restOpen = Boolean(rests?.open);
  const [busy, setBusy] = useState<string | null>(null);
  const loadout = resolveCards(sheet.domainCards.loadout);
  const vault = resolveCards(vaultCardIds(sheet));

  async function move(card: DomainCard, to: "loadout" | "vault") {
    setBusy(card.id);
    await moveCard(card.id, to, duringRest);
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="cs-box" aria-label="Domains">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="cs-lbl">Class domains</span>
            {cls?.domains.map((d) => {
              const dom = getDomain(d);
              return (
                <span key={d} className="rounded-full px-4 py-1 font-display text-[14px] font-bold text-[#f6ead2]" style={{ background: dom?.color }}>
                  {dom?.name ?? d}
                </span>
              );
            })}
          </div>
          <span className="cs-small">
            {sheet.domainCards.owned.length} card{sheet.domainCards.owned.length === 1 ? "" : "s"} owned · Level {sheet.level}
          </span>
        </div>
        {canEdit ? (
          <label className="flex min-h-11 flex-wrap items-center gap-2 border-t border-[#dccaa2] pt-3 text-[17px]">
            <input type="checkbox" className="size-5 accent-[#5b2b2b]" checked={duringRest} onChange={(e) => setDuringRest(e.target.checked)} />
            Swapping during a rest (free only while the GM has a rest open)
            <span className="cs-small italic">Moving a card from the vault into your loadout marks Stress equal to its Recall Cost, unless it happens during a rest.</span>
            {duringRest && !restOpen ? (
              <span className="cs-small font-bold text-[#8e2b2b]" data-testid="no-open-rest">
                No rest is open right now: a swap still costs its Recall Cost in Stress.
              </span>
            ) : null}
          </label>
        ) : null}
      </section>

      <section className="cs-felt" aria-labelledby="loadout-h">
        <h3 id="loadout-h" className="cs-felt-h">
          Loadout <span className="font-sans text-[14px] font-normal tracking-normal text-[#e8d6b8]">{loadout.length} / 5 in hand</span>
        </h3>
        {loadout.length === 0 ? (
          <p className="m-0 text-center text-[#e8d6b8] italic">Your loadout is empty. Move cards here from your vault.</p>
        ) : (
          <div className="cs-cards" role="list" aria-label="Loadout cards">
            {loadout.map((card) => (
              <div role="listitem" key={card.id}>
                <CardFace card={card}>
                  {canEdit ? (
                    <button type="button" className="cs-dkc-btn" disabled={busy !== null} onClick={() => void move(card, "vault")}>
                      Move to vault
                    </button>
                  ) : null}
                </CardFace>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="cs-box" aria-labelledby="vault-h">
        <h3 id="vault-h" className="cs-h">
          Vault
        </h3>
        {vault.length === 0 ? (
          <p className="cs-small m-0 text-center italic">No cards in the vault.</p>
        ) : (
          <div className="cs-cards" role="list" aria-label="Vault cards">
            {vault.map((card) => {
              const block = recallBlock(card, sheet.level, loadout.length);
              const cost = duringRest || card.recallCost === 0 ? "free" : `${card.recallCost} Stress`;
              return (
                <div role="listitem" key={card.id}>
                  <CardFace card={card}>
                    {canEdit ? (
                      block ? (
                        <span className="cs-small italic">{block}</span>
                      ) : (
                        <button type="button" className="cs-dkc-btn" disabled={busy !== null} onClick={() => void move(card, "loadout")}>
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
      </section>
    </div>
  );
}
