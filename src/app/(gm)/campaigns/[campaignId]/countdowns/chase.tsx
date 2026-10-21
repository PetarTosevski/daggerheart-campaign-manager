"use client";

import { useMutation } from "convex/react";
import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import {
  canAdvanceCountdown,
  canReverseCountdown,
  COUNTDOWN_VISIBILITY_PRESETS,
  countdownVisibilityPreset,
  type CountdownAction,
} from "@/lib/domain/countdowns";
import { CHASE_LEADS, DYNAMIC_ADVANCEMENT, type ChaseLeadSize, type ChaseRole, type ChaseSide } from "@/lib/domain/countdowns/advanced";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CountdownView } from "../../../../../../convex/countdowns";

import { operatedView } from "./card";
import { BTN } from "./shared";
import { choiceOf, VISIBILITY_OPTIONS, VisibilityForm, VisibilityPicker, visibilityOf } from "./visibility";

// Chase countdowns (CB p.163, countdowns-advanced K3): "set two countdowns: one for the pursuing party and one for the
// escaping party ... set that die at its highest value ... set that die at a lower value to reflect how much of a lead
// they have (1 lower for a small lead, 3 lower for a decent lead, 5 lower for a substantial lead)." / "When a PC
// succeeds on an action roll, it ticks down their countdown, which is a progress countdown. When they fail on an action
// roll—or roll a success with Fear—it ticks down the other party's countdown, which is a consequence countdown."

/** The die sizes the dialog offers for both countdowns' shared start. */
const CHASE_DICE = [4, 6, 8, 10, 12, 20] as const;
const LEADS: { lead: ChaseLeadSize; label: string }[] = [
  { lead: "small", label: "Small lead" },
  { lead: "decent", label: "Decent lead" },
  { lead: "substantial", label: "Substantial lead" },
];
const NEW_CHASE_VISIBILITY = choiceOf(COUNTDOWN_VISIBILITY_PRESETS.public);

/** "Critical Success −3, Success with Hope −2, …" for one side: only the results that move it (R4 via R8). */
function sideLine(side: ChaseSide): string {
  const mode = side === "party" ? "progress" : "consequence";
  const rows: [keyof typeof DYNAMIC_ADVANCEMENT, string][] = [
    ["critical", "Critical"],
    ["successHope", "Success with Hope"],
    ["successFear", "Success with Fear"],
    ["failHope", "Failure with Hope"],
    ["failFear", "Failure with Fear"],
  ];
  const moves = rows.filter(([o]) => DYNAMIC_ADVANCEMENT[o][mode] > 0).map(([o, label]) => `${label} −${DYNAMIC_ADVANCEMENT[o][mode]}`);
  return `${side === "party" ? "Your successes move this" : "Failures and success with Fear move this"}: ${moves.join(", ")}.`;
}

/** Whether this side is the pursuers' (from the PCs' role). */
const pursues = (side: ChaseSide, role: ChaseRole) => (side === "party") === (role === "pursuing");

/** A side reached 0: its status is completed (players may not see the value), or its value is 0. */
const atZero = (row: CountdownView | undefined) => row !== undefined && (row.status === "completed" || row.currentValue === 0);

/**
 * How the chase ended, or null while it runs (D9): the side at 0 tells it. The pursuers at 0 caught the escapee
 * ("Caught!"), the escapee at 0 got away ("Got away!"), whichever side the PCs are on.
 */
export function chaseOutcome(
  party: CountdownView | undefined,
  rivals: CountdownView | undefined,
  role: ChaseRole,
  rivalsName: string,
): { headline: "Caught!" | "Got away!"; line: string } | null {
  const side: ChaseSide | null = atZero(party) ? "party" : atZero(rivals) ? "rivals" : null;
  if (side === null) return null;
  const caught = pursues(side, role);
  if (side === "party") return caught ? { headline: "Caught!", line: `The party caught ${rivalsName}.` } : { headline: "Got away!", line: `The party got away from ${rivalsName}.` };
  return caught ? { headline: "Caught!", line: `${rivalsName} caught the party.` } : { headline: "Got away!", line: `${rivalsName} got away from the party.` };
}

/** One keyed intent with its error kept for the card's aria-live line (for mutations with an optimistic update). */
function useKeyed<A extends { idempotencyKey: string }, R>(run: (args: A) => Promise<R>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function fire(args: Omit<A, "idempotencyKey">): Promise<R | undefined> {
    setError(null);
    setPending(true);
    try {
      return await run({ ...args, idempotencyKey: crypto.randomUUID() } as A);
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { fire, error, pending };
}

/** One side's track: its label, role, value, pips, the R4 line and the GM's manual ticks. */
function Track({
  row,
  side,
  label,
  role,
  readOnly,
  pending,
  onAct,
}: {
  row: CountdownView | undefined;
  side: ChaseSide;
  label: string;
  role: ChaseRole;
  readOnly: boolean;
  pending: boolean;
  onAct: (row: CountdownView, action: CountdownAction) => void;
}) {
  const value = row?.currentValue ?? null;
  const start = row?.startingValue ?? null;
  const zero = atZero(row);
  const shown = value !== null && start !== null;
  return (
    <div
      role="group"
      aria-label={shown ? `${label}: ${value} of ${start}` : `${label}: progress hidden`}
      data-side={side}
      className={cn("flex flex-col gap-2 rounded-[12px] border bg-[#10181b] p-3", zero ? "border-danger-line" : "border-[#253338]")}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[15px] font-semibold text-[#e6ecea]">{label}</span>
        <span className="flex-none rounded-full border border-[#33444a] px-2 py-0.5 text-[11px] tracking-[0.1em] text-[#9fb2b6] uppercase">
          {pursues(side, role) ? "Pursuing" : "Escaping"}
        </span>
        <span
          className={cn("ml-auto flex-none font-display text-[22px] font-black", zero ? "text-[#ffb4ae]" : "text-[#f4efe6]")}
          data-testid={`chase-value-${side}`}
        >
          {shown ? (
            <>
              {value}
              <span className="text-[12px] text-[#8fa3a8]">/{start}</span>
            </>
          ) : (
            <span className="text-[#8fa3a8]">?</span>
          )}
        </span>
      </div>
      {shown ? (
        <div aria-hidden="true" className="flex gap-1">
          {Array.from({ length: start }, (_, k) => (
            <span
              key={k}
              className={cn(
                "h-2.5 min-w-0 flex-1 rounded-full",
                k < value ? (side === "party" ? "bg-brand" : "bg-[#e0905a]") : "border border-dashed border-[#33444a] bg-transparent",
              )}
            />
          ))}
        </div>
      ) : (
        <div className="cd-hidden-strip">The sand is covered</div>
      )}
      <p className="m-0 text-[12px] text-[#9fb2b6]">{sideLine(side)}</p>
      {readOnly || row === undefined || !shown ? null : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={cn(BTN, "min-h-11 border-transparent font-bold text-brand-ink")}
            style={{ background: zero ? "#5a2a2a" : "var(--brand)" }}
            aria-label={`Tick ${label} down one`}
            disabled={pending || !canAdvanceCountdown(row.status, value)}
            onClick={() => onAct(row, "advance")}
          >
            Tick −1
          </button>
          <button
            type="button"
            className={cn(BTN, "min-h-11")}
            aria-label={`Borrowed time: add one to ${label}`}
            disabled={pending || !canReverseCountdown(row.status, value, start)}
            onClick={() => onAct(row, "reverse")}
          >
            Borrowed Time
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A chase pair as one card (D9): the party's track and the rivals' track, one Armed switch, pair-wide visibility, pause
 * and cancel, manual ticks per side, and "Caught!" / "Got away!" once a side reaches 0.
 */
export function ChaseCard({
  party,
  rivals,
  campaignId,
  readOnly,
}: {
  party: CountdownView | undefined;
  rivals: CountdownView | undefined;
  campaignId: Id<"campaigns">;
  readOnly: boolean;
}) {
  // Either row carries the pair's link; the caller passes at least one.
  const anchor = (party ?? rivals)!;
  const role: ChaseRole = anchor.chase?.party ?? "pursuing";
  const pairIds = new Set([party?._id, rivals?._id, anchor.chase?.partnerId].filter((id): id is Id<"countdowns"> => id !== undefined));

  // Optimistic (CL4): the same domain rules the server runs (operatedView); pause / resume follow on the partner when its
  // own state allows, and a chase cancel removes both rows.
  const operate = useKeyed(
    useMutation(api.countdowns.operate).withOptimisticUpdate((store, { countdownId: id, action, amount }) => {
      const list = store.getQuery(api.countdowns.listByCampaign, { campaignId });
      if (list === undefined) return;
      const pairWide = action === "pause" || action === "resume";
      const next =
        action === "cancel"
          ? list.filter((c) => !pairIds.has(c._id))
          : list.map((c) => (c._id === id || (pairWide && pairIds.has(c._id)) ? operatedView(c, action, amount) : c));
      store.setQuery(api.countdowns.listByCampaign, { campaignId }, next);
    }),
  );
  const arm = useKeyed(
    useMutation(api.countdowns.setArmed).withOptimisticUpdate((store, { armed }) => {
      const list = store.getQuery(api.countdowns.listByCampaign, { campaignId });
      if (list === undefined) return;
      store.setQuery(
        api.countdowns.listByCampaign,
        { campaignId },
        list.map((c) => (pairIds.has(c._id) ? { ...c, armed } : c)),
      );
    }),
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editingVisibility, setEditingVisibility] = useState(false);

  const rivalsName = rivals?.name ?? "The rivals";
  const title = rivals?.name ? `Chase: ${rivals.name}` : "Chase";
  const outcome = chaseOutcome(party, rivals, role, rivalsName);
  const rows = [party, rivals].filter((r): r is CountdownView => r !== undefined);
  const paused = rows.some((r) => r.status === "paused");
  const open = rows.find((r) => r.status === "active" || r.status === "paused");
  const canPause = outcome === null && rows.length > 0 && rows.every((r) => r.status === "active");
  const canResume = outcome === null && paused;
  const armed = anchor.armed === true;
  const canArm = !readOnly && anchor.armed !== null;
  const preset = countdownVisibilityPreset(anchor.visibility);
  const badge = VISIBILITY_OPTIONS.find((o) => o.preset === preset)!.badge;
  const BadgeIcon = preset === "private" ? EyeOff : Eye;
  const description = rivals?.description ?? party?.description ?? null;

  const act = (row: CountdownView, action: CountdownAction) => void operate.fire({ countdownId: row._id, action });

  return (
    <article
      aria-label={title}
      data-chase="true"
      data-ended={outcome === null ? undefined : "true"}
      className={cn(
        "col-span-full flex flex-col gap-3 rounded-[14px] border bg-[#141e22] p-4",
        outcome ? "border-danger-line" : "border-[#253338]",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">Chase</span>
          <span className={cn("truncate text-[16px] font-semibold", rivals?.name ? "text-[#e6ecea]" : "text-[#9fb2b6] italic")}>
            {role === "pursuing" ? `The party pursues ${rivalsName}` : `The party flees ${rivalsName}`}
          </span>
          {description ? <span className="text-[13px] text-[#8fa3a8] italic">{description}</span> : null}
        </div>
        <span className="flex flex-wrap items-center gap-2 text-[12px] tracking-[0.12em] text-[#8fa3a8] uppercase">
          {paused ? <span className="rounded-full border border-[#4a5a60] px-2 py-0.5 text-[#c9d2cf]">Paused</span> : null}
          {readOnly ? null : (
            <button
              type="button"
              data-preset={preset}
              aria-label={`Who can see ${title}: ${badge}`}
              onClick={() => setEditingVisibility(true)}
              className={cn(
                "flex min-h-7 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 tracking-[0.08em] normal-case hover:border-brand",
                preset === "public" ? "border-[#33444a] text-[#9fb2b6]" : "border-[#7a5a2e] text-[#e6c88a]",
              )}
            >
              <BadgeIcon className="size-3.5" aria-hidden="true" />
              {badge}
            </button>
          )}
        </span>
      </div>

      {outcome ? (
        <div role="status" className="flex flex-col items-center gap-0.5 rounded-lg border border-danger-line bg-[#3a1414] px-3 py-2 text-center">
          <span className="font-display text-[20px] font-bold tracking-[0.06em] text-[#ffd9d6]" data-testid="chase-outcome">
            {outcome.headline}
          </span>
          <span className="text-[13px] text-[#f0c4c0]">{outcome.line}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <Track row={party} side="party" label="The party" role={role} readOnly={readOnly} pending={operate.pending} onAct={act} />
        <Track row={rivals} side="rivals" label={rivalsName} role={role} readOnly={readOnly} pending={operate.pending} onAct={act} />
      </div>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {canResume && open ? (
            <button type="button" className={cn(BTN, "min-h-11")} disabled={operate.pending} onClick={() => act(open, "resume")}>
              Resume chase
            </button>
          ) : (
            <button type="button" className={cn(BTN, "min-h-11")} disabled={operate.pending || !canPause || !open} onClick={() => open && act(open, "pause")}>
              Pause chase
            </button>
          )}
          {canArm ? (
            <button
              type="button"
              aria-pressed={armed}
              aria-label={`Armed: ${title} advances on action rolls`}
              title={armed ? "Armed: every PC action roll moves the chase. Click to stop." : "Not armed: only your ticks move it. Click to arm."}
              onClick={() => void arm.fire({ campaignId, countdownId: anchor._id, armed: !armed })}
              className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-2 text-[13px] text-[#c9d2cf]"
            >
              <span
                aria-hidden="true"
                className={cn("relative h-5 w-9 flex-none rounded-full border transition-colors", armed ? "border-brand bg-brand" : "border-[#4a5a60] bg-[#10181b]")}
              >
                <span className={cn("absolute top-0.5 size-3.5 rounded-full transition-[left]", armed ? "left-[18px] bg-brand-ink" : "left-0.5 bg-[#8fa3a8]")} />
              </span>
              Armed
            </button>
          ) : null}
        </div>
      )}

      <p role="status" aria-live="polite" className="m-0 text-[13px] text-danger empty:hidden">
        {operate.error ?? arm.error}
      </p>

      {readOnly || rows.every((r) => r.status === "cancelled") ? null : confirmCancel ? (
        <div role="alertdialog" aria-label={`Cancel ${title}`} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2 text-[14px] text-[#ffd9d6]">
          <span className="flex-1">Cancel this chase? Both countdowns end.</span>
          <button type="button" className={BTN} onClick={() => setConfirmCancel(false)}>
            Keep it
          </button>
          <button
            type="button"
            className="min-h-10 cursor-pointer rounded-[9px] bg-danger-solid px-3 text-[14px] font-semibold text-white disabled:opacity-50"
            disabled={operate.pending}
            onClick={() => act(anchor, "cancel")}
          >
            Cancel chase
          </button>
        </div>
      ) : (
        <button type="button" className="min-h-11 self-end text-[13px] text-[#8fa3a8] underline-offset-4 hover:underline" onClick={() => setConfirmCancel(true)}>
          Cancel chase…
        </button>
      )}

      {readOnly ? null : (
        <Modal open={editingVisibility} onClose={() => setEditingVisibility(false)} title="Who can see this" className="max-w-[560px] border-[#33444a] bg-[#121b1f]">
          <VisibilityForm countdown={{ ...anchor, name: title }} campaignId={campaignId} onDone={() => setEditingVisibility(false)} />
        </Modal>
      )}
    </article>
  );
}

/** One option of a radio group in the dashboard's card look. */
function Option({
  name,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 flex-col gap-1 rounded-[10px] border px-3 py-2 text-[14px] text-[#e6ecea]",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        checked ? "border-brand bg-[#1d2a2e]" : "border-[#33444a] bg-[#141e22] hover:border-brand",
      )}
    >
      <span className="flex items-center gap-2 font-semibold">
        <input
          type="radio"
          name={name}
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          className="size-4 flex-none accent-[var(--brand)]"
        />
        {label}
      </span>
      {hint ? <span className="text-[12px] text-[#8fa3a8]">{hint}</span> : null}
    </label>
  );
}

const INPUT = "min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]";

/** The GM's "New chase" dialog (CB p.163): who the rivals are, pursuing or escaping, the die, the lead, armed, who sees it. */
export function NewChaseDialog({ campaignId, open, onClose }: { campaignId: Id<"campaigns">; open: boolean; onClose: () => void }) {
  const createChase = useIntent(api.countdowns.createChase);
  const ids = useId();
  const [rivals, setRivals] = useState("");
  const [role, setRole] = useState<ChaseRole>("pursuing");
  const [die, setDie] = useState<number>(6);
  const [picked, setPicked] = useState<ChaseLeadSize>("decent");
  const [armed, setArmed] = useState(true);
  const [visibility, setVisibility] = useState(NEW_CHASE_VISIBILITY);
  // A lead must stay below the die (R8); a smaller die falls back to the largest lead that fits.
  const fits = (lead: ChaseLeadSize) => CHASE_LEADS[lead] < die;
  const lead: ChaseLeadSize = fits(picked) ? picked : (["decent", "small"] as const).find(fits) ?? "small";
  const escapee = die - CHASE_LEADS[lead];
  const who = rivals.trim() || "the rivals";
  const partyStart = role === "pursuing" ? die : escapee;
  const rivalsStart = role === "pursuing" ? escapee : die;
  const close = () => {
    setRivals("");
    setRole("pursuing");
    setDie(6);
    setPicked("decent");
    setArmed(true);
    setVisibility(NEW_CHASE_VISIBILITY);
    createChase.clearError();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="New chase" className="max-w-[560px] border-[#33444a] bg-[#121b1f]">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (createChase.pending) return;
          const form = new FormData(event.currentTarget);
          // Intents only: the server sets both values from the die and the lead (chaseStart).
          const created = await createChase.fire({
            campaignId,
            name: rivals,
            description: String(form.get("description") ?? ""),
            startingValue: die,
            lead,
            party: role,
            armed,
            visibility: visibilityOf(visibility),
          });
          if (created) close();
        }}
      >
        <div className="flex flex-col gap-2">
          <input
            name="name"
            required
            maxLength={100}
            value={rivals}
            onChange={(e) => setRivals(e.target.value)}
            aria-label="Rivals"
            placeholder="Who is in the chase? (e.g. The thief)"
            className={INPUT}
          />
          <input name="description" maxLength={1000} aria-label="Notes" placeholder="Notes (optional)" className={INPUT} />
        </div>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">The party is</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Option name={`${ids}-role`} label="Pursuing" hint={`The party chases ${who}.`} checked={role === "pursuing"} onChange={() => setRole("pursuing")} />
            <Option name={`${ids}-role`} label="Escaping" hint={`${who.charAt(0).toUpperCase()}${who.slice(1)} chases the party.`} checked={role === "escaping"} onChange={() => setRole("escaping")} />
          </div>
        </fieldset>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">Die</legend>
          <div role="radiogroup" aria-label="Die size" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {CHASE_DICE.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === die}
                onClick={() => setDie(n)}
                className={cn(
                  "min-h-11 cursor-pointer rounded-[10px] border font-display text-[18px] font-bold",
                  n === die ? "border-brand bg-brand text-brand-ink" : "border-[#33444a] bg-[#141e22] text-[#e6ecea] hover:border-brand",
                )}
              >
                d{n}
              </button>
            ))}
          </div>
          <p className="m-0 text-[13px] text-[#8fa3a8]">
            The longer the chase should take, the bigger the die. Each tick can be one range band (Very Close to Close, Close to Far,
            Far to Very Far), or several miles over a long distance.
          </p>
        </fieldset>

        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[14px] text-[#9fb2b6]">The escapee&apos;s lead</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {LEADS.map((l) => (
              <Option
                key={l.lead}
                name={`${ids}-lead`}
                label={l.label}
                hint={`${CHASE_LEADS[l.lead]} lower`}
                checked={lead === l.lead}
                disabled={!fits(l.lead)}
                onChange={() => setPicked(l.lead)}
              />
            ))}
          </div>
          <p className="m-0 text-[14px] text-[#c9d2cf]" aria-live="polite" data-testid="chase-preview">
            The party starts at {partyStart}, {who} at {rivalsStart}. The party&apos;s successes tick theirs down; failures and successes with
            Fear tick {who}&apos;s.
          </p>
        </fieldset>

        <VisibilityPicker value={visibility} onChange={setVisibility} />

        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border border-[#33444a] bg-[#141e22] px-3 py-2 text-[14px] text-[#e6ecea]">
          <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} className="mt-0.5 size-4 flex-none accent-[var(--brand)]" />
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">Advance automatically on action rolls</span>
            <span className="text-[12px] text-[#8fa3a8]">Armed: each PC action roll moves both countdowns. You can switch it on the card.</span>
          </span>
        </label>

        {createChase.error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {createChase.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={BTN} onClick={close}>
            Cancel
          </button>
          <BrandButton type="submit" variant="solid" disabled={createChase.pending}>
            Start chase
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}
