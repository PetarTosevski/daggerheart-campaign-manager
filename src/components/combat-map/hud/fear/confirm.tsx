"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { RefusalMessage, useRefusal } from "../blocked";
import { hudButtonClass, PartBoundary } from "../ui";
import { fearShortText } from "./blocked";

/**
 * "Spend n Fear?" (plan combat-hud H5.3; GMDesktop 'Spend Fear' `.sp`, CmpPromptsGM 'Spend 2 Fear?'): the GM's one
 * question before any HUD action spends Fear (answer 6a; only the Fear banner's − spends without asking). It hangs under
 * the Fear banner (portalled into the HUD's fear region, so it moves left with the banner while a sheet is open), says
 * why ("1 to spotlight the Lieutenant, 1 for Coup de Grace."), shows Fear before and after ("5 → 3"), and has Cancel and
 * "Spend n Fear". Not modal: the map stays usable (CL12); Escape cancels.
 *
 * The caller owns the spend: it mounts `FearConfirm` when an action needs Fear, runs the action in `onConfirm` (the
 * server spends the Fear and refuses NOT_ENOUGH_FEAR), and unmounts it when `onConfirm` resolves or on `onCancel`. While
 * `onConfirm` runs both buttons are disabled; if it throws, the refusal shows in the card (H6.1's table, `useRefusal`)
 * and the GM may try again or cancel. With less Fear than `amount`, Spend is disabled and the card says so in the
 * table's words ("This needs 3 Fear. You have 1.", H6.3: the same helper as every GM Fear control, `fearShortText`).
 *
 * Contract (stable; H5.2's stat block codes against it):
 *
 * ```tsx
 * <FearConfirm amount={2} reasons={["1 to spotlight the Lieutenant", "1 for Coup de Grace on Moss (Vulnerable)"]}
 *   onConfirm={() => run(intent)} onCancel={() => setAsk(null)} />
 * ```
 */
export type FearConfirmProps = {
  /** The Fear the action spends (≥ 1). */
  amount: number;
  /** Why, one phrase per part ("1 to spotlight the Lieutenant"); joined with ", " and a full stop. May be empty. */
  reasons: readonly string[];
  /** Runs the action; may return a promise (buttons wait for it, a rejection shows its message). */
  onConfirm: () => void | Promise<unknown>;
  /** Cancel and Escape. Without it the card has no Cancel (the caller closes it some other way). */
  onCancel?: () => void;
  /** The GM's Fear now, when the caller has it; else the card reads `combatHud.scene` itself. */
  fear?: number;
  /** The campaign whose Fear to read when `fear` is not given; defaults to the route's `[campaignId]`. */
  campaignId?: Id<"campaigns">;
};

/** The reasons as the card's sentence: "1 to spotlight the Lieutenant, 1 for Coup de Grace." ("" when none). */
export function fearReasonsText(reasons: readonly string[]): string {
  const parts = reasons.map((r) => r.trim().replace(/[.\s]+$/, "")).filter((r) => r !== "");
  return parts.length === 0 ? "" : `${parts.join(", ")}.`;
}

/** Fear after the spend, never below 0. */
export function fearAfterSpend(fear: number, amount: number): number {
  return Math.max(0, fear - amount);
}

/** Where the card hangs: the HUD's fear region (beside the banner), or inline when there is none (tests, classic). */
function fearRegion(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.querySelector<HTMLElement>('[data-hud-region="fear"]');
}

export function FearConfirm(props: FearConfirmProps): ReactNode {
  const params = useParams<{ campaignId?: string }>();
  const campaignId = props.campaignId ?? (params?.campaignId as Id<"campaigns"> | undefined);
  const card = (
    <PartBoundary label="Spend Fear">
      {props.fear !== undefined || campaignId === undefined ? (
        <FearConfirmCard {...props} fear={props.fear ?? null} />
      ) : (
        <FearFromScene {...props} campaignId={campaignId} />
      )}
    </PartBoundary>
  );
  const host = fearRegion();
  return host ? createPortal(card, host) : card;
}

/** Reads the GM's Fear for the card (`combatHud.scene`, the banner's own read: no extra subscription). */
function FearFromScene(props: FearConfirmProps & { campaignId: Id<"campaigns"> }) {
  const scene = useQuery(api.combatHud.scene, { campaignId: props.campaignId });
  return <FearConfirmCard {...props} fear={scene === undefined ? undefined : scene.fear} />;
}

const Flame = () => (
  <svg className="hud-fc-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
  </svg>
);

/** The card. `fear`: a number, `undefined` while it loads, `null` when it can't be known (no campaign). */
function FearConfirmCard({
  amount,
  reasons,
  onConfirm,
  onCancel,
  fear,
}: Omit<FearConfirmProps, "fear" | "campaignId"> & { fear: number | null | undefined }) {
  const titleId = useId();
  const shortId = useId();
  const ref = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  // The card is where the GM pressed: every refusal shows here, toast-placed ones too.
  const refusal = useRefusal({ viewer: "gm", place: "inline" });
  const shortText = fearShortText(amount, fear);
  const short = shortText !== null;
  const why = fearReasonsText(reasons);

  // Focus moves into the card on open and back where it was on close (DOM focus only; no state is set here).
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => {
      const now = document.activeElement;
      if (before?.isConnected && (now === null || now === document.body)) before.focus();
    };
  }, []);

  async function confirm() {
    setPending(true);
    try {
      await refusal.run(async () => onConfirm());
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="hud-fc"
      data-testid="hud-fear-confirm"
      onKeyDown={(event) => {
        if (event.key === "Escape" && onCancel && !pending) {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h2 id={titleId} className="hud-fc-t">
        Spend {amount} Fear?
      </h2>
      {why ? <p className="hud-fc-why">{why}</p> : null}
      {short ? (
        <p className="hud-fc-short" role="status" id={shortId}>
          {shortText}
        </p>
      ) : null}
      <RefusalMessage refusal={refusal.refusal} id={refusal.messageId} className="hud-fc-err" />
      <div className="hud-fc-f">
        {fear === undefined ? (
          <span className="hud-fc-left" role="status">
            Loading Fear…
          </span>
        ) : fear === null ? (
          <span className="hud-fc-left" />
        ) : (
          <span className="hud-fc-left" data-testid="hud-fear-confirm-change">
            <Flame />
            <span aria-hidden="true">
              {fear} → {fearAfterSpend(fear, amount)}
            </span>
            <span className="sr-only">
              Fear {fear} to {fearAfterSpend(fear, amount)}
            </span>
          </span>
        )}
        {onCancel ? (
          <button type="button" className={hudButtonClass("cancel")} disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="button" className={`${hudButtonClass("primary")} hud-fc-yes`} disabled={pending || short}
          aria-describedby={short ? shortId : refusal.refusal ? refusal.messageId : undefined}
          onClick={() => void confirm()}>
          Spend {amount} Fear
        </button>
      </div>
    </section>
  );
}
