import Link from "next/link";
import { FileText, Plus, Sprout, UserRound, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCharactersListData } from "@/lib/data/characters";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const primaryLinkClassName = cn(
  buttonVariants(),
  "bg-[#3f1e25] text-amber-50 hover:bg-[#542832]",
);

export default async function CharactersPage() {
  const supabase = await createSupabaseServerClient();
  const data = await getCharactersListData(supabase);

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#f4f0e8] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(180,83,9,0.09),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(120,53,65,0.10),transparent_30%)]"
      />

      <div className="relative mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[#6b303b]">
              <Users className="size-5" />
              <span className="text-xs font-semibold tracking-[0.16em] uppercase">
                Roster
              </span>
            </div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
              Characters
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base">
              Create player characters and open each workspace to manage its
              overview and notes.
            </p>
          </div>
          {data ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/characters/templates"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "border-stone-300 bg-white/70 text-stone-700 hover:bg-white",
                )}
              >
                <FileText />
                Sheet templates
              </Link>
              <Link href="/characters/new" className={primaryLinkClassName}>
                <Plus />
                New character
              </Link>
            </div>
          ) : null}
        </div>

        {!data ? (
          <Card className="mx-auto max-w-2xl border-stone-200 bg-white/80 text-center shadow-xl shadow-stone-900/5">
            <CardHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <Sprout className="size-6" />
              </div>
              <CardTitle className="mt-2 text-xl">No campaign yet</CardTitle>
              <CardDescription>
                Create your first campaign to begin. Characters live inside a
                campaign.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard" className={primaryLinkClassName}>
                Go to the Campaign page
              </Link>
            </CardContent>
          </Card>
        ) : data.characters.length === 0 ? (
          <Card className="mx-auto max-w-2xl border-dashed border-stone-300 bg-white/60 text-center">
            <CardHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <UserRound className="size-6" />
              </div>
              <CardTitle className="mt-2 text-xl">No characters yet</CardTitle>
              <CardDescription>
                Create the first character to begin building the party roster.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/characters/new" className={primaryLinkClassName}>
                <Plus />
                New character
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.characters.map((character) => (
              <li key={character.id}>
                <Link
                  href={`/characters/${character.id}`}
                  className="group block h-full rounded-xl border border-stone-200 bg-white/90 p-5 shadow-sm outline-none transition hover:border-amber-700/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-amber-700/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 group-hover:bg-amber-50 group-hover:text-amber-800">
                      <UserRound className="size-5" />
                    </div>
                    {character.status === "archived" ? (
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
                  <h2 className="mt-3 truncate text-lg font-semibold text-stone-900">
                    {character.name}
                  </h2>
                  <p className="mt-1 text-sm text-stone-500">
                    {character.className ?? "No class"}
                    {character.templateName ? ` · ${character.templateName}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
