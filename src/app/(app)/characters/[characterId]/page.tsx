import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CharacterWorkspace } from "@/components/characters/character-workspace";
import { Badge } from "@/components/ui/badge";
import { getCharacterSheetRuntimeData } from "@/lib/data/character-sheet";
import { getCharacterWorkspaceData } from "@/lib/data/characters";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CharacterWorkspacePage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;

  // Guard against malformed ids before touching the database.
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      characterId,
    );
  if (!isUuid) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const data = await getCharacterWorkspaceData(supabase, characterId);

  if (!data) {
    notFound();
  }

  const sheetData = await getCharacterSheetRuntimeData(supabase, characterId);

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#f4f0e8] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(180,83,9,0.09),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(120,53,65,0.10),transparent_30%)]"
      />

      <div className="relative mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/characters"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 outline-none transition-colors hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-amber-700/40"
        >
          <ArrowLeft className="size-4" />
          Back to characters
        </Link>

        <div className="mt-4 mb-7 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
            {data.character.name}
          </h1>
          {data.character.status === "archived" ? (
            <Badge
              variant="outline"
              className="border-stone-300 bg-stone-100 text-stone-500"
            >
              Archived
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-emerald-700/20 bg-emerald-50 text-emerald-800"
            >
              Active
            </Badge>
          )}
        </div>

        <CharacterWorkspace data={data} sheetData={sheetData} />
      </div>
    </main>
  );
}
