import { notFound } from "next/navigation";

import { findSection } from "@/lib/campaign-sections";

/** Boards not yet ported keep their place in the navigation. */
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params;
  const section = findSection(slug);
  if (!section || !section.slug) notFound();

  return (
    <main className="mx-auto flex max-w-[1344px] flex-col gap-4 px-4 py-12 sm:px-12">
      <h1 className="m-0 font-display text-[36px] font-bold text-parchment">{section.label}</h1>
      <div className="rounded-xl border-2 border-dashed border-[#33444a] px-6 py-10 text-center text-[15px] text-[#c9d2cf]">
        This board is ported in phase {section.phase} of the design port.
      </div>
    </main>
  );
}
