import { useMutation } from "convex/react";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useRef, useState } from "react";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import type { FrameId } from "../../../../../src/lib/frames";
import type { CustomFrameInput } from "../../../../../src/lib/validation/campaigns";
import { api } from "../../convex";

/** Creates a campaign and opens its dashboard. One idempotency key per intent. */
export function useCreateCampaign({ onCreated }: { onCreated?: () => void } = {}) {
  const create = useMutation(api.campaigns.create);
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(input: { frameId: FrameId; name: string; custom?: CustomFrameInput }) {
    key.current ??= Crypto.randomUUID();
    setPending(true);
    setError(null);
    try {
      const { campaignId } = await create({ ...input, idempotencyKey: key.current });
      onCreated?.();
      router.replace(`/campaign/${campaignId}`);
    } catch (e) {
      key.current = null;
      setError(errorMessage(e));
      setPending(false);
    }
  }

  return { submit, pending, error, clearError: () => setError(null) };
}
