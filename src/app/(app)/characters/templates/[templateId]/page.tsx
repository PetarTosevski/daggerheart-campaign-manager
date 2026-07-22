import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TemplateManager } from "@/components/sheet-templates/template-manager";
import { Badge } from "@/components/ui/badge";
import { getSheetTemplateDetailData } from "@/lib/data/sheet-templates";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SheetTemplateDetailPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      templateId,
    );
  if (!isUuid) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const data = await getSheetTemplateDetailData(supabase, templateId);

  if (!data) {
    notFound();
  }

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#f4f0e8] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(180,83,9,0.09),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(120,53,65,0.10),transparent_30%)]"
      />

      <div className="relative mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/characters/templates"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 outline-none transition-colors hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-amber-700/40"
        >
          <ArrowLeft className="size-4" />
          Back to sheet templates
        </Link>

        <div className="mt-4 mb-7 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
            {data.template.name}
          </h1>
          {data.template.is_blank_template ? (
            <Badge
              variant="outline"
              className="border-stone-300 bg-stone-100 text-stone-600"
            >
              Blank
            </Badge>
          ) : data.className ? (
            <Badge
              variant="outline"
              className="border-amber-700/20 bg-amber-50 text-amber-800"
            >
              {data.className}
            </Badge>
          ) : null}
          {data.template.status === "archived" ? (
            <Badge
              variant="outline"
              className="border-stone-300 bg-stone-100 text-stone-500"
            >
              Archived
            </Badge>
          ) : null}
        </div>

        <TemplateManager data={data} />
      </div>
    </main>
  );
}
