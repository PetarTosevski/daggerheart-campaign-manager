import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TemplateFieldEditor } from "@/components/sheet-templates/template-field-editor";
import { getTemplateEditorData } from "@/lib/data/sheet-templates";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string; versionId: string }>;
}) {
  const { templateId, versionId } = await params;
  if (!UUID.test(templateId) || !UUID.test(versionId)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const data = await getTemplateEditorData(supabase, templateId, versionId);
  if (!data) {
    notFound();
  }

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#f4f0e8] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(180,83,9,0.09),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(120,53,65,0.10),transparent_30%)]"
      />

      <div className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href={`/characters/templates/${templateId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 outline-none transition-colors hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-amber-700/40"
        >
          <ArrowLeft className="size-4" />
          Back to template
        </Link>

        <h1 className="font-heading mt-4 mb-6 text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">
          {data.template.name} — field editor
        </h1>

        <TemplateFieldEditor data={data} />
      </div>
    </main>
  );
}
