"use client";

import Image from "next/image";
import { useEffect, useId, useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { deckBacks, fan } from "@/components/cards/fan";
import { designAsset } from "@/lib/design-assets";
import { experienceValue } from "@/lib/domain/dice";
import { cn } from "@/lib/utils";

import { cardDisplay, HandCardFace } from "../../actions/hand/face";
import type { HandCard } from "../../actions/hand/model";
import type { Roller, RollValues } from "../../actions/roll-controls";
import { CostPill, Tag } from "../ui";
import { EDGE_MAX, EDGE_MIN, experienceShort, HELP_MAX, signedEdge, type CardLook } from "./states";

/**
 * The HUD hand's view parts (plan combat-hud H2.3; board CmpCards): one card of the fan with its tag and state around
 * the app's own face, the folded hand, another player's hidden hand, the Roll options popover and the full card view.
 * Each takes what it shows and reports intents; the hand body (`body.tsx`) owns the state and the writes.
 */

// ---------------------------------------------------------------- one card of the fan

/**
 * The card's "More" opens the HUD's full card view instead of the face's own dialog: the click is caught on the way
 * down (capture), so the face itself stays untouched (hard rule 1).
 */
export function catchMore(e: MouseEvent<HTMLElement>, open: (from: HTMLElement) => void) {
  const more = (e.target as Element).closest?.(".cmh-more");
  if (!more) return;
  e.preventDefault();
  e.stopPropagation();
  open(more as HTMLElement);
}

/** One card of the fan: the tag above, the app's face, and the state around it (lift and glow, grey wash). */
export function FanCard({
  card,
  index,
  count,
  look,
  locked,
  pending,
  onUse,
  onMore,
}: {
  card: HandCard;
  index: number;
  count: number;
  look: CardLook;
  /** The face's own grey for the GM's locked hand. */
  locked: boolean;
  /** A use is on its way: every Use waits. */
  pending: boolean;
  onUse: () => void;
  onMore: (from: HTMLElement) => void;
}) {
  const style = fan(index, count, card.state === "exhausted") as CSSProperties;
  return (
    <li
      className={cn("hud-hc", look.wash !== "none" && `is-${look.wash}`)}
      style={style}
      // Not a tab stop: a tap focuses it, which raises it (keyboard users raise it by tabbing to More or Use).
      tabIndex={-1}
      data-testid="hud-hand-card"
      data-card={card.cardId}
      data-wash={look.wash}
      onClickCapture={(e) => catchMore(e, onMore)}
    >
      {look.tag ? (
        <Tag kind={look.tag.kind === "lock" ? "used" : look.tag.kind} className={cn("hud-hc-tag", look.tag.kind === "lock" && "hud-hs-lock")}>
          {look.tag.lock ? <LockIcon /> : null}
          {look.tag.text}
        </Tag>
      ) : null}
      <HandCardFace card={card} locked={locked}>
        {look.showUse ? (
          <button
            type="button"
            className="cmh-use"
            disabled={!look.canUse || pending}
            title={look.reason}
            aria-label={`Use ${card.name}`}
            onClick={onUse}
          >
            Use
          </button>
        ) : null}
      </HandCardFace>
    </li>
  );
}

function LockIcon() {
  return (
    <svg className="hud-hc-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
      <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------- backs: a folded or hidden hand

/** Three card backs (the board's "Hidden hand" `.cb`): the domains of the cards, else the generic back. */
export function CardBacks({ domains, className }: { domains: readonly string[]; className?: string }) {
  const backs = deckBacks(domains);
  return (
    <span className={cn("hud-backs", className)} aria-hidden="true">
      {backs.map((back, i) => {
        const src = designAsset(back);
        return <span key={i} className="hud-back">{src ? <Image src={src} alt="" fill sizes="120px" className="hud-back-img" /> : null}</span>;
      })}
    </span>
  );
}

// ---------------------------------------------------------------- popovers beside the fan

/**
 * A small non-modal panel above the fan's side buttons (the vault, Roll options). Escape closes it and gives the focus
 * back to the button that opened it (`onClose`).
 */
export function SidePop({ id, title, sub, children, onClose, testId }: { id: string; title: string; sub?: ReactNode; children: ReactNode; onClose: () => void; testId?: string }) {
  const titleId = useId();
  return (
    <section
      id={id}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="hud-hand-pop"
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="hud-hand-pop-h">
        <h2 id={titleId}>{title}</h2>
        {sub ? <span>{sub}</span> : null}
        <button type="button" className="hud-hand-pop-x" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          ✕
        </button>
      </header>
      {children}
    </section>
  );
}

/**
 * Roll options (board CmpCards "Roll options"): Experiences with their Hope cost (1 each, CB p.90; off chips grey out
 * with "Needs 1 Hope" once the Hope is spoken for), advantage from −3 to +3, and Help dice. They apply to the next card
 * that rolls. The values are the hand's; each control reports a patch.
 */
export function RollOptionsBody({ roller, values, problem, onChange }: { roller: Roller | null; values: RollValues; problem: string | null; onChange: (patch: Partial<RollValues>) => void }) {
  const { experienceIds, edge, help } = values;
  const hope = roller?.hope ?? null;
  const expId = useId();
  return (
    <div className="hud-ro">
      <span className="hud-ro-l" id={expId}>
        Experiences
      </span>
      <span className="hud-ro-chips" role="group" aria-labelledby={expId}>
        {roller && roller.experiences.length > 0 ? (
          roller.experiences.map((e) => {
            const on = experienceIds.includes(e.id);
            const short = experienceShort(hope, experienceIds.length, on);
            return (
              <button
                key={e.id}
                type="button"
                className="hud-ro-chip"
                aria-pressed={on}
                disabled={short}
                onClick={() => onChange({ experienceIds: on ? experienceIds.filter((id) => id !== e.id) : [...experienceIds, e.id] })}
              >
                {e.name} {signedEdge(experienceValue(e))}
                {short ? <small>Needs 1 Hope</small> : <CostPill amount={1} resource="hope" className="hud-ro-cost" />}
              </button>
            );
          })
        ) : (
          <small className="hud-ro-none">{roller ? "No Experiences" : "Loading…"}</small>
        )}
      </span>
      <span className="hud-ro-l">Advantage</span>
      <RoStepper label="Advantage" value={edge} min={EDGE_MIN} max={EDGE_MAX} text={signedEdge(edge)} hint="from −3 to +3" onChange={(n) => onChange({ edge: n })} />
      <span className="hud-ro-l">Help</span>
      <RoStepper label="Help dice" value={help} min={0} max={HELP_MAX} text={String(help)} hint={help === 1 ? "Help die (d6)" : "Help dice (d6)"} onChange={(n) => onChange({ help: n })} />
      <p className="hud-ro-note">Applies to the next card that rolls. Experiences cost 1 Hope each.</p>
      {problem ? (
        <p className="hud-ro-err" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function RoStepper({ label, value, min, max, text, hint, onChange }: { label: string; value: number; min: number; max: number; text: string; hint: string; onChange: (n: number) => void }) {
  return (
    <span className="hud-ro-step" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-live="polite">{text}</output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
      <small>{hint}</small>
    </span>
  );
}

// ---------------------------------------------------------------- the full card view

/**
 * The full card (board CmpCards "Full card view", the face's More): the app's face at full size over the map with Use
 * and Close at its foot and the whole text beside it. A native modal `<dialog>`: Escape closes it, focus goes back to
 * the More that opened it. The face's own More is hidden here (it would open the same card again).
 */
export function FullCard({ card, useLabel, canUse, reason, onUse, onClose }: { card: HandCard; useLabel: string | null; canUse: boolean; reason?: string; onUse: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const text = cardDisplay(card).text;
  // showModal() is the DOM's own call for a mounted dialog (as the app's CardDialog and Modal do).
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="hud-full"
      aria-labelledby={titleId}
      data-testid="hud-full-card"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="hud-full-card">
        <HandCardFace card={card}>
          {useLabel !== null ? (
            <button
              type="button"
              className="cmh-use"
              disabled={!canUse}
              title={reason}
              onClick={() => {
                onUse();
                ref.current?.close();
              }}
            >
              {useLabel}
            </button>
          ) : null}
          <button type="button" className="cmh-use hud-full-close" onClick={() => ref.current?.close()}>
            Close
          </button>
        </HandCardFace>
      </div>
      <div className="hud-full-text">
        <h2 id={titleId}>{card.name}</h2>
        <p>{text}</p>
      </div>
    </dialog>
  );
}
