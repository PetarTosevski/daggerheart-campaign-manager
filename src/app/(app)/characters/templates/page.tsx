import Link from "next/link";
import { ArrowLeft, FileText, Sprout } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSheetTemplatesListData } from "@/lib/data/sheet-templates";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SheetTemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const data = await getSheetTemplatesListData(supabase);

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

        <div className="mt-4 mb-7">
          <div className="mb-2 flex items-center gap-2 text-[#6b303b]">
            <FileText className="size-5" />
            <span className="text-xs font-semibold tracking-[0.16em] uppercase">
              Sheet templates
            </span>
          </div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
            Sheet templates
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base">
            Upload and preview the PDF behind each blank or class template.
            Uploads are private and immutable; each new PDF is a new version.
          </p>
        </div>

        {!data ? (
          <Card className="mx-auto max-w-2xl border-stone-200 bg-white/80 text-center shadow-xl shadow-stone-900/5">
            <CardHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <Sprout className="size-6" />
              </div>
              <CardTitle className="mt-2 text-xl">No campaign yet</CardTitle>
              <CardDescription>
                Sheet templates live inside a campaign. Create your first
                campaign on the{" "}
                <Link href="/dashboard" className="font-medium underline">
                  Campaign page
                </Link>{" "}
                to begin.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : data.templates.length === 0 ? (
          <Card className="mx-auto max-w-2xl border-dashed border-stone-300 bg-white/60 text-center">
            <CardHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <FileText className="size-6" />
              </div>
              <CardTitle className="mt-2 text-xl">No templates yet</CardTitle>
              <CardDescription>
                Templates are seeded per campaign. Once they exist, upload a PDF
                for each here.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.templates.map((template) => (
              <li key={template.id}>
                <Link
                  href={`/characters/templates/${template.id}`}
                  className="group block h-full rounded-xl border border-stone-200 bg-white/90 p-5 shadow-sm outline-none transition hover:border-amber-700/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-amber-700/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 group-hover:bg-amber-50 group-hover:text-amber-800">
                      <FileText className="size-5" />
                    </div>
                    {template.is_blank_template ? (
                      <Badge
                        variant="outline"
                        className="border-stone-300 bg-stone-100 text-stone-600"
                      >
                        Blank
                      </Badge>
                    ) : template.className ? (
                      <Badge
                        variant="outline"
                        className="border-amber-700/20 bg-amber-50 text-amber-800"
                      >
                        {template.className}
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="mt-3 truncate text-lg font-semibold text-stone-900">
                    {template.name}
                  </h2>
                  <p className="mt-1 text-sm text-stone-500">
                    {template.activeVersion
                      ? `v${template.activeVersion.version_number} · ${template.activeVersion.page_count} page${
                          template.activeVersion.page_count === 1 ? "" : "s"
                        }`
                      : "No PDF uploaded"}
                    {template.versionCount > 0
                      ? ` · ${template.versionCount} version${template.versionCount === 1 ? "" : "s"}`
                      : ""}
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
