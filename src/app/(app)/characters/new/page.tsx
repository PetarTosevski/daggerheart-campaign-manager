import Link from "next/link";
import { ArrowLeft, Sprout } from "lucide-react";

import { CharacterCreateForm } from "@/components/characters/character-create-form";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCharacterBuilderData } from "@/lib/data/characters";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewCharacterPage() {
  const supabase = await createSupabaseServerClient();
  const data = await getCharacterBuilderData(supabase);

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#f4f0e8] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(180,83,9,0.09),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(120,53,65,0.10),transparent_30%)]"
      />

      <div className="relative mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/characters"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 outline-none transition-colors hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-amber-700/40"
        >
          <ArrowLeft className="size-4" />
          Back to characters
        </Link>

        <h1 className="font-heading mt-4 mb-6 text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
          New character
        </h1>

        {data ? (
          <CharacterCreateForm
            campaignId={data.campaign.id}
            classes={data.classes}
            templates={data.templates}
          />
        ) : (
          <Card className="border-stone-200 bg-white/80 text-center shadow-xl shadow-stone-900/5">
            <CardHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <Sprout className="size-6" />
              </div>
              <CardTitle className="mt-2 text-xl">No campaign yet</CardTitle>
              <CardDescription>
                A character needs a campaign. Create your first campaign on the{" "}
                <Link href="/dashboard" className="font-medium underline">
                  Campaign page
                </Link>{" "}
                to begin.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </main>
  );
}
