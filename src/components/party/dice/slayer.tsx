"use client";

import { useState } from "react";

import { Pill } from "@/components/party/sheet-ui";
import type { RollPrompt } from "@/lib/domain/class-features/types";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The Slayer choice after an action roll with Hope (U2, CB 48): "Take the Hope" keeps the roll as it is (no call,
 * the offer just closes), "Store a Slayer Die" calls `rolls.storeSlayerDie`. The offer comes from
 * `rolls.pendingChoices`, so it shows whoever rolled (a manual roll, the partner's Tag Team pick) and survives a reload.
 */
export function SlayerOffer({ characterId, entryId, prompt }: { characterId: Id<"characters">; entryId: Id<"actionLog">; prompt: RollPrompt }) {
  const store = useIntent(api.rolls.storeSlayerDie);
  // The offer answered locally, by roll: "Take the Hope" makes no call, so the server keeps offering it.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [stored, setStored] = useState<string | null>(null);
  if (dismissed === entryId) return null;
  if (stored !== null) {
    return (
      <p className="dc-prompt sh-small m-0 italic" role="status">
        {stored}
      </p>
    );
  }
  return (
    <div className="dc-prompt dc-slayer sh-small" role="group" aria-label={prompt.text}>
      <span>{prompt.text}</span>
      {prompt.choices.map((c) => (
        <Pill
          key={c.key}
          disabled={store.pending}
          onClick={() => {
            if (c.key !== "store") {
              setDismissed(entryId);
              return;
            }
            void store.fire({ characterId, entryId }).then((out) => {
              if (out) setStored(`Stored a Slayer Die (${out.slayerDice}/${out.capacity}).`);
            });
          }}
        >
          {c.label}
        </Pill>
      ))}
      {store.error ? (
        <span role="alert" className="dc-error">
          {store.error}
        </span>
      ) : null}
    </div>
  );
}
