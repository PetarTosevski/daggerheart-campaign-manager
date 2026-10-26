"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import type { FrameId } from "@/lib/frames";
import { CAMPAIGN_NAME_MAX, type CustomFrameInput } from "@/lib/validation/campaigns";

import { api } from "../../../../convex/_generated/api";

/**
 * Creates a campaign and opens its dashboard. One idempotency key per intent:
 * a retry after a dropped connection replays instead of creating twice.
 */
export function useCreateCampaign({ onCreated }: { onCreated?: () => void } = {}) {
  const create = useMutation(api.campaigns.create);
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(input: { frameId: FrameId; name: string; custom?: CustomFrameInput }) {
    key.current ??= crypto.randomUUID();
    setPending(true);
    setError(null);
    try {
      const { campaignId } = await create({ ...input, idempotencyKey: key.current });
      onCreated?.();
      router.push(`/campaigns/${campaignId}`);
    } catch (e) {
      // A rejected request is final; the next attempt is a new intent.
      key.current = null;
      setError(errorMessage(e));
      setPending(false);
    }
  }

  return { submit, pending, error, clearError: () => setError(null) };
}

/** Names a campaign started from a published frame. */
export function NameCampaignDialog({
  frameId,
  frameName,
  open,
  onClose,
}: {
  frameId: FrameId;
  frameName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { submit, pending, error } = useCreateCampaign();

  return (
    <Modal open={open} onClose={onClose} title="Name your campaign" className="max-w-[520px]">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const name = String(new FormData(event.currentTarget).get("name") ?? "");
          void submit({ frameId, name });
        }}
      >
        <p className="m-0 text-[15px] text-body">
          A new campaign in <span className="text-parchment">{frameName}</span>, starting at session
          zero.
        </p>
        <label className="flex flex-col gap-2 text-[14px] text-label">
          Campaign name
          <input
            name="name"
            type="text"
            required
            autoFocus
            maxLength={CAMPAIGN_NAME_MAX}
            placeholder="Name your campaign"
            className="min-h-[50px] rounded-[10px] border border-line-2 bg-[#0f0d15] px-3.5 text-[16px] text-parchment placeholder:text-faint"
          />
        </label>
        {error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <BrandButton variant="outline" size="lg" onClick={onClose}>
            Cancel
          </BrandButton>
          <BrandButton type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? "Creating…" : "Start campaign"}
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}
