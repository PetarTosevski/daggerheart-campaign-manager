"use client";

import "./card-dialog.css";

import { X } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

import { designAsset } from "@/lib/design-assets";
import { DOMAINS } from "@/lib/srd/domains";
import type { DomainCard } from "@/lib/srd/types";

// The large domain card (plan sheet-cards, tracer SC1; beads dcm-bxp.126, dcm-bxp.127). 'More' on any card face opens
// it: the card's art, name, domain, level, type, recall cost, its whole text with no inner scroll, and its once-per
// state (CA7's "Used · Back after a rest"). Native modal <dialog> (CL12): the browser traps focus and closes on Escape;
// closing always puts focus back on the 'More' button. Built for the sheet's felt table and the Combat Map Hand (CA6).
// Looks like the board's card faces (Party.dc.html `hc-face`, `dkc`): domain-coloured head, Cinzel caps, parchment
// body, gold rules, the blue Recall badge on the art.

/** The display fields the dialog needs; a `DomainCard` from the SRD fits, and so do server-sent display fields (CL9). */
export type CardDialogCard = Pick<DomainCard, "name" | "domain" | "level" | "type" | "recallCost" | "text" | "art">;

const TYPE_LABEL: Record<DomainCard["type"], string> = { ability: "Ability", spell: "Spell", grimoire: "Grimoire" };

/**
 * The modal large card. Controlled: render it with `open`, and `onClose` runs on Escape, the close button and a click
 * on the backdrop. `returnFocus` (the 'More' button) gets focus back once the dialog closes.
 * `used` is the reset label of a card whose once-per limit is spent ("Back after a rest"), or null while it is ready.
 * `spells` lists a grimoire's used spells ("Used: Arcane Barrage - back after a rest", G3); the card itself stays ready.
 */
export function CardDialog({
  card,
  used,
  spells,
  open,
  onClose,
  returnFocus,
}: {
  card: CardDialogCard;
  used?: string | null;
  spells?: readonly string[];
  open: boolean;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  // Rendered into <body> only while open, so the card's own tree (a list item, a turned or greyed hand card) holds no
  // dialog and the server render has no portal.
  if (!open) return null;
  return createPortal(<OpenCardDialog card={card} used={used ?? null} spells={spells ?? []} onClose={onClose} returnFocus={returnFocus} />, document.body);
}

function OpenCardDialog({
  card,
  used,
  spells,
  onClose,
  returnFocus,
}: {
  card: CardDialogCard;
  used: string | null;
  spells: readonly string[];
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const domain = DOMAINS.find((d) => d.id === card.domain);
  const domainName = domain?.name ?? card.domain;
  const art = card.art ? designAsset(card.art) : undefined;

  // showModal() is the DOM's own call for a mounted dialog (no React state), so it belongs in an effect (as PaperModal).
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function close() {
    onClose();
    returnFocus?.current?.focus();
  }

  return (
    <dialog
      ref={ref}
      className="cd-dialog"
      aria-labelledby={titleId}
      data-exhausted={used ? "true" : undefined}
      style={{ "--dc": domain?.color ?? "#5b2b2b" } as CSSProperties}
      // Escape closes the native dialog itself; its close event (and the button and backdrop below) end here.
      onClose={close}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <article className="cd-card">
        <header className="cd-head">
          <h2 id={titleId} className="cd-name">
            {card.name}
          </h2>
          <span className="cd-lvl" aria-label={`Level ${card.level}`}>
            {card.level}
          </span>
          <button type="button" className="cd-close" aria-label="Close" onClick={() => ref.current?.close()}>
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <div className="cd-art">
          {/* The art is decoration: the name, level and recall cost are all in text. */}
          {art ? <Image className="cd-art-img" src={art} alt="" fill loading="eager" sizes="(max-width: 640px) 100vw, 560px" /> : null}
          <span className="cd-rc" aria-hidden="true">
            {card.recallCost}
          </span>
        </div>
        {used ? <p className="cd-used">Used · {used}</p> : null}
        {spells.length > 0 ? (
          <ul className="cd-spells" aria-label="Used spells">
            {spells.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <dl className="cd-meta">
          <div>
            <dt>Domain</dt>
            <dd>{domainName}</dd>
          </div>
          <div>
            <dt>Level</dt>
            <dd>{card.level}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{TYPE_LABEL[card.type]}</dd>
          </div>
          <div>
            <dt>Recall cost</dt>
            <dd>{card.recallCost}</dd>
          </div>
        </dl>
        <p className="cd-text">{card.text}</p>
      </article>
    </dialog>
  );
}

/**
 * A card face's 'More' button with its CardDialog. The visible text is "More"; the accessible name names the card.
 * `className` styles the button for the face it sits on.
 */
export function CardMore({
  card,
  used,
  spells,
  className,
}: {
  card: CardDialogCard;
  used?: string | null;
  spells?: readonly string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" className={className ?? "cd-more"} aria-haspopup="dialog" aria-label={`More about ${card.name}`} onClick={() => setOpen(true)}>
        More
      </button>
      <CardDialog card={card} used={used} spells={spells} open={open} onClose={() => setOpen(false)} returnFocus={button} />
    </>
  );
}
