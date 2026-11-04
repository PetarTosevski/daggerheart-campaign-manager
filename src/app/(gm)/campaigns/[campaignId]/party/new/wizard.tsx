"use client";

import { useQuery } from "convex/react";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";

import { BrandButton, brandButton } from "@/components/brand/buttons";
import { FRAME_OF } from "@/lib/frames/extras/common";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { useCampaign } from "../../campaign-shell";
import { isTypedWizardPatch, useAccountDraft, wizardFromDraft } from "./draft";
import { ClassStep, HeritageStep, InfoStep, TraitsStep, type StepProps } from "./steps-1-4";
import { BackgroundStep, ConnectionsStep, DomainCardsStep, EquipmentStep, ExperiencesStep } from "./steps-5-9";
import {
  canReach,
  emptyWizard,
  incompleteSteps,
  missingByStep,
  normalizeWizard,
  portraitAsset,
  STEP_COUNT,
  STEP_TITLES,
  stillNeeded,
  toCharacterDraft,
  type WizardState,
} from "./wizard-logic";
import "./wizard.css";

const STEPS: ComponentType<StepProps>[] = [
  ClassStep,
  HeritageStep,
  TraitsStep,
  InfoStep,
  EquipmentStep,
  BackgroundStep,
  ExperiencesStep,
  DomainCardsStep,
  ConnectionsStep,
];

/**
 * Party board: the 9-step character creation wizard (Core ch. 1). Its unsent draft lives on the account
 * (`useAccountDraft`, config U6f), so the wizard opens once the draft has loaded and starts from it.
 */
export function CharacterWizard() {
  const campaign = useCampaign();
  const draft = useAccountDraft({ kind: "characterWizard", campaignId: campaign._id });
  if (draft.stored === undefined) {
    return (
      <main className="mx-auto w-full max-w-[1168px] px-0 py-6 sm:px-6 sm:py-8" aria-busy="true">
        <div className="wz-paper min-h-[480px] rounded-none sm:rounded-[14px]" />
      </main>
    );
  }
  return <Wizard draft={draft} initial={wizardFromDraft(draft.stored)} />;
}

function Wizard({ draft, initial }: { draft: ReturnType<typeof useAccountDraft>; initial: WizardState }) {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const router = useRouter();
  const isGm = campaign.role === "gm";
  const ikonis = campaign.frameId === FRAME_OF.motherboard;
  const opts = useMemo(() => ({ hopeAndFear: campaign.options.hopeAndFear, ikonis }), [campaign.options.hopeAndFear, ikonis]);
  const roster = useQuery(api.members.roster, isGm ? { campaignId } : "skip");
  const create = useIntent(api.characters.create);

  const [raw, setRaw] = useState<WizardState>(initial);
  const state = useMemo(() => normalizeWizard(raw, opts), [raw, opts]);
  const missing = useMemo(() => missingByStep(state, opts), [state, opts]);
  const step = state.step;

  // Saved from the change itself (rule 13): typing waits for a pause, a click saves at once.
  const update = (patch: Partial<WizardState>) => {
    const next = { ...normalizeWizard(raw, opts), ...patch };
    setRaw(next);
    draft.save(next, { typed: isTypedWizardPatch(patch) });
  };
  const startOver = () => {
    setRaw(emptyWizard());
    draft.clear();
  };

  // Move focus to the new step's heading so keyboard and screen-reader users land at its start.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [step]);

  const stepMissing = missing[step] ?? [];
  const stepOk = stepMissing.length === 0;
  const allOk = canReach(STEP_COUNT + 1, missing);
  const goTo = (n: number) => update({ step: Math.min(STEP_COUNT, Math.max(1, n)) });

  const owners = roster ? [{ userId: roster.gm.userId, name: `${roster.gm.name} (you)` }, ...roster.players.map((p) => ({ userId: p.userId, name: p.name }))] : [];
  const ownerId = isGm && owners.some((o) => o.userId === state.ownerId) ? (state.ownerId as Id<"users">) : undefined;
  // X6: one active character per player (the GM's own are exempt); the server refuses the same.
  const party = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const playerId = isGm ? (ownerId !== roster?.gm.userId ? ownerId : undefined) : undefined;
  const blocker = party?.find((c) => c.status === "active" && (isGm ? playerId !== undefined && c.ownerId === playerId : c.mine));

  async function submit() {
    if (!allOk || blocker || create.pending) return;
    const result = await create.fire({
      campaignId,
      draft: toCharacterDraft(state, portraitAsset(state)),
      ...(ownerId ? { ownerId } : {}),
      ...(ikonis ? { ikonis: state.ikonis } : {}),
    });
    if (result) {
      draft.clear();
      router.push(`/campaigns/${campaignId}/party/${result.characterId}`);
    }
  }

  const Step = STEPS[step - 1];
  const nextTip = stillNeeded(stepMissing);
  const createTip = allOk ? "" : `Finish the earlier steps first: ${incompleteSteps(missing).join(", ")}`;
  const hasDraft = JSON.stringify(raw) !== JSON.stringify({ ...emptyWizard(), step: raw.step });

  return (
    <main className="mx-auto w-full max-w-[1168px] px-0 py-6 sm:px-6 sm:py-8">
      <div className="wz-paper flex flex-col gap-5 rounded-none px-4 py-6 sm:rounded-[14px] sm:px-8 sm:py-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="wz-kicker">
              Create character · Step {step} of {STEP_COUNT}
            </div>
            <h2 ref={headingRef} tabIndex={-1} className="wz-title scroll-mt-4">
              {STEP_TITLES[step - 1]}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {hasDraft ? (
              <BrandButton variant="danger" size="sm" onClick={startOver}>
                Start over
              </BrandButton>
            ) : null}
            <Link
              href={`/campaigns/${campaignId}/party`}
              className={brandButton({ variant: "cancel", icon: true, round: true, className: "flex-none" })}
              aria-label="Cancel character creation"
              onClick={draft.flush}
            >
              <X aria-hidden="true" />
            </Link>
          </div>
        </div>

        {isGm ? (
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="cc-owner" className="wz-lbl">
              Character for
            </label>
            <select id="cc-owner" className="wz-select" value={ownerId ?? ""} onChange={(e) => update({ ownerId: e.target.value || null })}>
              <option value="">{roster ? `${roster.gm.name} (you)` : "You"}</option>
              {owners.slice(1).map((o) => (
                <option key={o.userId} value={o.userId}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {blocker ? (
          <p id="cc-blocked" data-testid="wizard-blocked" role="status" className="m-0 rounded-[10px] border border-[#cdb88f] bg-[#f3e6c8] px-3 py-2 text-[15px] text-[#3a2a14]">
            {blocker.sheet.name} is still active, and a player has one active character at a time. Send {blocker.sheet.name} away from the{" "}
            <Link href={`/campaigns/${campaignId}/party`} className="underline">
              Party page
            </Link>{" "}
            before creating another.
          </p>
        ) : null}

        <nav aria-label="Character creation steps">
          <ol className="wz-steps m-0 list-none p-0">
            {STEP_TITLES.map((title, i) => {
              const n = i + 1;
              const reachable = n <= step || canReach(n, missing);
              const done = (missing[n] ?? []).length === 0 && n < step;
              return (
                <li key={title}>
                  <button
                    type="button"
                    className={cn("wz-dot", done && "done")}
                    aria-current={n === step ? "step" : undefined}
                    aria-label={`Step ${n}: ${title}${done ? " (done)" : ""}`}
                    disabled={!reachable}
                    onClick={() => goTo(n)}
                  >
                    <span className="wz-n" aria-hidden="true">
                      {n}
                    </span>
                    <span className="wz-t" aria-hidden="true">
                      {title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <Step state={state} update={update} opts={opts} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#cdb88f] pt-4">
          {step > 1 ? (
            <BrandButton variant="cancel" size="lg" onClick={() => goTo(step - 1)}>
              ‹ Back
            </BrandButton>
          ) : (
            <Link href={`/campaigns/${campaignId}/party`} className={brandButton({ variant: "cancel", size: "lg" })} onClick={draft.flush}>
              Cancel
            </Link>
          )}
          <span className="flex-1" />
          <div className="flex flex-col items-end gap-1.5">
            {step < STEP_COUNT ? (
              <BrandButton
                variant="confirm"
                size="lg"
                aria-disabled={!stepOk}
                aria-describedby={nextTip ? "cc-next-missing" : undefined}
                title={nextTip || undefined}
                onClick={() => {
                  if (stepOk) goTo(step + 1);
                }}
              >
                Next: {STEP_TITLES[step]} ›
              </BrandButton>
            ) : (
              <BrandButton
                variant="confirm"
                size="lg"
                aria-disabled={!allOk || Boolean(blocker) || create.pending}
                aria-describedby={blocker ? "cc-blocked" : createTip ? "cc-missing" : undefined}
                title={createTip || undefined}
                onClick={() => void submit()}
              >
                {create.pending ? "Creating…" : "Create character"}
              </BrandButton>
            )}
            {step < STEP_COUNT && nextTip ? (
              <span id="cc-next-missing" className="wz-req" aria-live="polite">
                {nextTip}
              </span>
            ) : null}
            {step === STEP_COUNT && createTip ? (
              <span id="cc-missing" className="wz-req" aria-live="polite">
                {createTip}
              </span>
            ) : null}
          </div>
        </div>
        <p role="alert" className="m-0 text-right text-[15px] text-[#8a2a1a] empty:hidden">
          {create.error}
        </p>
      </div>
    </main>
  );
}
