import { Backpack, PackageOpen } from "lucide-react";

import { InventoryManager } from "@/components/inventory/inventory-manager";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getInventoryOverview } from "@/lib/data/inventory";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function InventoryPage() {
  const supabase = await createSupabaseServerClient();
  const overview = await getInventoryOverview(supabase);

  return (
    <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-[#f4f0e8] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(180,83,9,0.09),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(120,53,65,0.10),transparent_30%)]"
      />
      <div className="relative mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-7">
          <div className="mb-2 flex items-center gap-2 text-[#6b303b]">
            <Backpack className="size-5" />
            <span className="text-xs font-semibold tracking-[0.16em] uppercase">
              Provisions
            </span>
          </div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
            Inventory
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base">
            Define reusable items, hold them in character and shared containers,
            and move, equip, split, merge, or consume them with a full audit trail.
          </p>
        </div>

        {overview ? (
          <InventoryManager overview={overview} />
        ) : (
          <Card className="mx-auto max-w-2xl border-stone-200 bg-white/80 text-center shadow-xl shadow-stone-900/5">
            <CardHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                <PackageOpen className="size-6" />
              </div>
              <CardTitle className="mt-2 text-xl">No campaign yet</CardTitle>
              <CardDescription>
                Create a campaign on the Campaign page to begin tracking inventory.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </main>
  );
}
