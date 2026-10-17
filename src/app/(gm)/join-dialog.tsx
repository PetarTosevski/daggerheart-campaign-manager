"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../convex/_generated/api";

/** Join a campaign as a player with the code the GM shared. */
export function JoinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const join = useMutation(api.members.joinByCode);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal open={open} onClose={onClose} title="Join a campaign" className="max-w-[480px]">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const code = String(new FormData(event.currentTarget).get("code") ?? "");
          setPending(true);
          setError(null);
          join({ code })
            .then((result) => {
              if (result.ok) return router.push(`/campaigns/${result.campaignId}`);
              setError(result.message);
              setPending(false);
            })
            .catch((e) => {
              setError(errorMessage(e));
              setPending(false);
            });
        }}
      >
        <p className="m-0 text-[15px] text-body">Enter the join code your GM gave you.</p>
        <label className="flex flex-col gap-2 text-[14px] text-label">
          Join code
          <input
            name="code"
            required
            autoFocus
            autoComplete="off"
            placeholder="e.g. K7QM-3XRP"
            className="min-h-[50px] rounded-[10px] border border-line-2 bg-[#0f0d15] px-3.5 font-display text-[20px] tracking-[0.2em] text-parchment uppercase placeholder:font-sans placeholder:text-[15px] placeholder:tracking-normal placeholder:normal-case placeholder:text-faint"
          />
        </label>
        {error ? (
          <p role="alert" className="m-0 text-[14px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <BrandButton variant="outline" size="lg" onClick={onClose}>
            Cancel
          </BrandButton>
          <BrandButton type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? "Joining…" : "Join"}
          </BrandButton>
        </div>
      </form>
    </Modal>
  );
}
