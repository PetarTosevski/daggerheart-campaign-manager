"use client";

import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { COUNTDOWN_CATEGORIES, COUNTDOWN_VISIBILITY_PRESETS, MAX_COUNTDOWN_START, type CountdownCategory } from "@/lib/domain/countdowns";
import { cn } from "@/lib/utils";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

import { BTN, CATEGORY_LABEL } from "./shared";
import { choiceOf, VisibilityPicker, visibilityOf } from "./visibility";

const NEW_COUNTDOWN_VISIBILITY = choiceOf(COUNTDOWN_VISIBILITY_PRESETS.public);
/** The GM's "New countdown" dialog. */
export function NewCountdownDialog({ campaignId, open, onClose }: { campaignId: Id<"campaigns">; open: boolean; onClose: () => void }) {
  const create = useIntent(api.countdowns.create);
  const [start, setStart] = useState(6);
  const [visibility, setVisibility] = useState(NEW_COUNTDOWN_VISIBILITY);
  // The form unmounts on close (Modal renders children only while open); reset the picker too.
  const close = () => {
    setStart(6);
    setVisibility(NEW_COUNTDOWN_VISIBILITY);
    create.clearError();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="New countdown" className="max-w-[560px] border-[#33444a] bg-[#121b1f]">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (create.pending) return;
          const form = new FormData(event.currentTarget);
          const created = await create.fire({
            campaignId,
            name: String(form.get("name") ?? ""),
            consequence: String(form.get("consequence") ?? ""),
            description: String(form.get("description") ?? ""),
            category: String(form.get("category")) as CountdownCategory,
            startingValue: start,
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
            aria-label="Countdown name"
            placeholder="Countdown name (e.g. The Fanewraith strikes Alula)"
            className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
          />
          <input
            name="consequence"
            maxLength={1000}
            aria-label="What happens at zero"
            placeholder="What happens at zero?"
            className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr]">
            <select
              name="category"
              aria-label="Category"
              defaultValue="threat"
              className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
            >
              {COUNTDOWN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              name="description"
              maxLength={1000}
              aria-label="Notes"
              placeholder="Notes (optional)"
              className="min-h-11 rounded-lg border border-[#33444a] bg-[#0d1417] px-3 text-[15px] text-[#e6ecea]"
            />
          </div>
        </div>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        <p className="m-0 text-[14px] text-[#9fb2b6]">Pick where it starts. Each tick brings it one step closer to zero.</p>
        <div role="radiogroup" aria-label="Starting value" className="grid grid-cols-5 gap-2">
          {Array.from({ length: MAX_COUNTDOWN_START }, (_, k) => MAX_COUNTDOWN_START - k).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === start}
              onClick={() => setStart(n)}
              className={cn(
                "aspect-square cursor-pointer rounded-[10px] border font-display text-[20px] font-bold transition-transform hover:-translate-y-0.5",
                n === start ? "border-brand bg-brand text-brand-ink" : "border-[#33444a] bg-[#141e22] text-[#e6ecea] hover:border-brand",
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {create.error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {create.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={BTN} onClick={close}>
            Cancel
          </button>
          <BrandButton type="submit" variant="solid" disabled={create.pending}>
            Start at {start}
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}
