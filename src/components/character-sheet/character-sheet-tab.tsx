"use client";

import { useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";

import { pinCharacterSheetVersionAction } from "@/app/(app)/characters/[characterId]/sheet-actions";
import { CharacterSheetRuntime } from "@/components/character-sheet/character-sheet-runtime";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CharacterSheetRuntimeData } from "@/lib/data/character-sheet";
import { useHydrated } from "@/lib/hooks/use-hydrated";

/**
 * Character Sheet tab: renders the interactive runtime for a pinned, published
 * version, or an explicit non-destructive state when there is no template or no
 * pinned published version. Never auto-assigns a template or silently follows
 * the template's current active version.
 */
export function CharacterSheetTab({
  data,
}: {
  data: CharacterSheetRuntimeData | null;
}) {
  if (!data) {
    return (
      <EmptyCard
        title="Character sheet unavailable"
        description="The character could not be loaded."
      />
    );
  }

  if (data.state === "no-template") {
    return (
      <EmptyCard
        title="No template assigned"
        description="This character has no sheet template. Templates are chosen when a character is created; template assignment for existing characters is a future workflow."
      />
    );
  }

  if (data.state === "no-version") {
    return (
      <Card className="border-stone-200 bg-white/90">
        <CardHeader>
          <div className="flex items-center gap-2 text-stone-500">
            <FileText className="size-4" />
          </div>
          <CardTitle className="text-lg">No published version pinned</CardTitle>
          <CardDescription>
            {data.canAssign
              ? `Assign the current published version of ${data.templateName ?? "the template"} to start using this sheet.`
              : `${data.templateName ?? "The template"} has no published version yet. Publish one under Sheet templates, then assign it here.`}
          </CardDescription>
        </CardHeader>
        {data.canAssign ? (
          <CardContent>
            <AssignVersionButton characterId={data.characterId} />
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return <CharacterSheetRuntime data={data} />;
}

function AssignVersionButton({ characterId }: { characterId: string }) {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    setPending(true);
    setError(null);
    const result = await pinCharacterSheetVersionAction({ characterId });
    if (result.status === "success") {
      window.location.reload();
      return;
    }
    setError(result.message);
    setPending(false);
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={!hydrated || pending}
        onClick={assign}
        className="bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
      >
        {pending ? <LoaderCircle className="animate-spin" /> : null}
        Assign published version
      </Button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function EmptyCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed border-stone-300 bg-white/60">
      <CardHeader>
        <div className="flex items-center gap-2 text-stone-500">
          <FileText className="size-4" />
        </div>
        <CardTitle className="text-lg text-stone-800">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
