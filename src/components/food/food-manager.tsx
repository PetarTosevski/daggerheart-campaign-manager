"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Plus,
  RefreshCw,
  TriangleAlert,
  Wheat,
} from "lucide-react";

import {
  acquireFoodBatchAction,
  commitWeeklyFoodAction,
  correctFoodBatchAction,
  previewWeeklyFoodAction,
  type FoodActionState,
} from "@/app/(app)/food/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { FoodBatchRow, FoodOverview } from "@/lib/data/food";
import {
  FOOD_TYPES,
  formatFoodTotal,
  rationsAndPortions,
  selectableBatches,
  type PreviewBatch,
  type SelectableBatch,
  type SpoilagePolicy,
  type WeeklyPreview,
} from "@/lib/domain/food";
import { useHydrated } from "@/lib/hooks/use-hydrated";

const idle: FoodActionState = { status: "idle" };
const fieldClass =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:opacity-60";

export function FoodManager({
  overview,
  initialPreview,
}: {
  overview: FoodOverview;
  initialPreview: WeeklyPreview;
}) {
  const { campaign, settings, currentWeek, totalPortions, activeCharacterCount, batches, history } = overview;
  const { rations, portions } = rationsAndPortions(totalPortions, settings.portionsPerRation);
  const previewBatches: PreviewBatch[] = batches.map((b) => ({
    id: b.id,
    label: b.label,
    food_type: b.food_type,
    status: b.status,
    acquired_week: b.acquired_week,
    remaining_portions: b.remaining_portions,
    created_at: b.created_at,
  }));

  return (
    <div className="space-y-8">
      {/* Total */}
      <Card className="border-stone-200 bg-white/90">
        <CardHeader>
          <div className="flex items-center gap-2 text-amber-800">
            <Wheat className="size-4" />
            <span className="text-xs font-semibold tracking-[0.16em] uppercase">
              Shared campaign store
            </span>
          </div>
          <CardTitle className="text-2xl text-stone-900">
            {rations} <span className="text-base font-normal text-stone-500">rations</span>{" "}
            {portions} <span className="text-base font-normal text-stone-500">portions</span>
          </CardTitle>
          <CardDescription>
            {totalPortions} portions total · {activeCharacterCount} active character
            {activeCharacterCount === 1 ? "" : "s"} · Week {currentWeek} ·{" "}
            {settings.portionsPerRation} portions per ration
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <AddBatchForm campaignId={campaign.id} />
        <WeeklyProcessing
          campaignId={campaign.id}
          currentWeek={currentWeek}
          initialPreview={initialPreview}
          portionsPerRation={settings.portionsPerRation}
          batches={previewBatches}
          spoilagePolicy={settings.defaultSpoilagePolicy}
        />
      </div>

      <BatchList batches={batches} campaignId={campaign.id} />
      <HistoryList history={history} />
    </div>
  );
}

function ActionMessage({ state }: { state: FoodActionState }) {
  if (state.status === "idle") return null;
  return (
    <div
      role={state.status === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
        state.status === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {state.status === "success" ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{state.message}</span>
    </div>
  );
}

function AddBatchForm({ campaignId }: { campaignId: string }) {
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState(acquireFoodBatchAction, idle);
  const key = state.nextRequestKey ?? state.requestKey ?? undefined;

  useEffect(() => {
    if (state.status === "success") window.location.reload();
  }, [state.requestKey, state.status]);

  return (
    <Card className="border-stone-200/80 bg-white/90">
      <CardHeader>
        <CardTitle className="text-lg">Add food batch</CardTitle>
        <CardDescription>Record an acquisition. Rations are preserved unless marked fresh.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
          <div className="space-y-1.5">
            <label htmlFor="food-label" className="text-sm font-medium text-stone-800">Label</label>
            <input id="food-label" name="label" required maxLength={100} disabled={pending} className={fieldClass} placeholder="Trail rations" aria-invalid={Boolean(state.fieldErrors?.label)} />
            {state.fieldErrors?.label?.[0] ? <p className="text-xs text-red-700">{state.fieldErrors.label[0]}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="food-type" className="text-sm font-medium text-stone-800">Type</label>
              <select id="food-type" name="foodType" defaultValue="preserved" disabled={pending} className={fieldClass}>
                {FOOD_TYPES.map((t) => (
                  <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="food-portions" className="text-sm font-medium text-stone-800">Portions</label>
              <input id="food-portions" name="initialPortions" type="number" min={1} step={1} defaultValue={7} required disabled={pending} className={fieldClass} aria-invalid={Boolean(state.fieldErrors?.initialPortions)} />
              {state.fieldErrors?.initialPortions?.[0] ? <p className="text-xs text-red-700">{state.fieldErrors.initialPortions[0]}</p> : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="food-note" className="text-sm font-medium text-stone-800">Note <span className="font-normal text-stone-500">(optional)</span></label>
            <Textarea id="food-note" name="sourceNote" maxLength={300} disabled={pending} className="min-h-16 border-stone-300 bg-white text-stone-900" placeholder="Where it came from" />
          </div>
          <ActionMessage state={state} />
          <Button type="submit" disabled={!hydrated || pending} className="w-full bg-[#3f1e25] text-amber-50 hover:bg-[#542832]">
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            {pending ? "Adding…" : "Add batch"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function WeeklyProcessing({
  campaignId,
  currentWeek,
  initialPreview,
  portionsPerRation,
  batches,
  spoilagePolicy,
}: {
  campaignId: string;
  currentWeek: number;
  initialPreview: WeeklyPreview;
  portionsPerRation: number;
  batches: PreviewBatch[];
  spoilagePolicy: SpoilagePolicy;
}) {
  const hydrated = useHydrated();
  const [preview, setPreview] = useState<WeeklyPreview>(initialPreview);
  const [override, setOverride] = useState("");
  const [skipSpoilage, setSkipSpoilage] = useState(false);
  const [overrideSelection, setOverrideSelection] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [commitState, commitAction, committing] = useActionState(commitWeeklyFoodAction, idle);
  const key = commitState.nextRequestKey ?? commitState.requestKey ?? undefined;

  useEffect(() => {
    if (commitState.status === "success") window.location.reload();
  }, [commitState.requestKey, commitState.status]);

  // Batches the GM may select, recomputed as skip-spoilage changes which fresh
  // batches survive. Batches that will spoil this week are shown but not consumable.
  const selectable: SelectableBatch[] = selectableBatches({
    batches,
    targetWeek: currentWeek,
    spoilagePolicy,
    skipSpoilage,
  });
  const consumable = selectable.filter((b) => !b.willSpoil);
  const consumableIds = new Set(consumable.map((b) => b.id));
  const byId = new Map(selectable.map((b) => [b.id, b]));
  // Normalize the chosen order to currently-consumable batches (drops any that
  // became spoiling); the remaining consumable batches are the excluded pool.
  const orderedSelection = selection.filter((id) => consumableIds.has(id));
  const excluded = consumable.filter((b) => !orderedSelection.includes(b.id));
  const selectedAvailable = orderedSelection.reduce(
    (sum, id) => sum + (byId.get(id)?.remaining_portions ?? 0),
    0,
  );
  const expectedShortage = Math.max(0, preview.appliedRequiredPortions - selectedAvailable);

  const usesOverride = override.trim() !== "" || skipSpoilage || overrideSelection;
  const reasonMissing = usesOverride && reason.trim() === "";
  const selectionEmpty = overrideSelection && orderedSelection.length === 0;
  const commitBlocked = reasonMissing || selectionEmpty;

  function toggleOverrideSelection(checked: boolean) {
    setOverrideSelection(checked);
    if (checked && selection.length === 0) {
      // Default to every consumable batch in FIFO order — mirrors default FIFO.
      setSelection(consumable.map((b) => b.id));
    }
  }

  function includeBatch(id: string) {
    setSelection((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }
  function excludeBatch(id: string) {
    setSelection((prev) => prev.filter((x) => x !== id));
  }
  function move(index: number, delta: number) {
    setSelection(() => {
      const next = [...orderedSelection];
      const target = index + delta;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function refreshPreview() {
    setPreviewing(true);
    setPreviewError(null);
    const result = await previewWeeklyFoodAction({
      overrideRequiredPortions: override.trim() === "" ? null : Number(override),
      skipSpoilage,
      overrideBatchSelection: overrideSelection,
      selectedBatchIds: orderedSelection,
    });
    if (result.status === "ok") setPreview(result.preview);
    else setPreviewError(result.message);
    setPreviewing(false);
  }

  return (
    <Card className="border-stone-200/80 bg-white/90">
      <CardHeader>
        <CardTitle className="text-lg">Weekly food processing</CardTitle>
        <CardDescription>Preview spoilage and consumption for week {currentWeek}, then commit. Preview never changes data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Stat label="Required" value={`${preview.appliedRequiredPortions}`} />
          <Stat label="Available" value={`${preview.consumableAvailablePortions}`} />
          <Stat label="Spoiling" value={`${preview.spoiledPortions}`} />
          <Stat label="Shortage" value={`${preview.shortagePortions}`} highlight={preview.shortagePortions > 0} />
        </dl>

        {preview.usedCustomSelection ? (
          <p className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
            <TriangleAlert className="size-3.5" /> FIFO overridden — consuming your selected batches in order.
          </p>
        ) : null}

        {preview.batches.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  {preview.usedCustomSelection ? <th className="px-3 py-2 text-right">#</th> : null}
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2 text-right">Before</th>
                  <th className="px-3 py-2 text-right">Spoiled</th>
                  <th className="px-3 py-2 text-right">Consumed</th>
                  <th className="px-3 py-2 text-right">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {preview.batches.map((b) => (
                  <tr key={b.id} className={preview.usedCustomSelection && !b.selected ? "text-stone-400" : undefined}>
                    {preview.usedCustomSelection ? (
                      <td className="px-3 py-2 text-right tabular-nums text-stone-500">
                        {b.order ?? "—"}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-stone-800">
                      {b.label}
                      {preview.usedCustomSelection && !b.selected ? (
                        <span className="ml-2 text-xs text-stone-400">(excluded)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.before}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{b.spoiled || ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-800">{b.consumed || ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-stone-500">No food available to process.</p>
        )}

        <p className="text-sm text-stone-600">
          Resulting total: {formatFoodTotal(preview.totalAfter, portionsPerRation)}
        </p>

        <details className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">GM override</summary>
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="food-override" className="text-sm font-medium text-stone-800">Required portions (override default {preview.defaultRequiredPortions})</label>
              <input id="food-override" type="number" min={0} step={1} value={override} onChange={(e) => setOverride(e.target.value)} className={fieldClass} placeholder={`${preview.defaultRequiredPortions}`} />
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input type="checkbox" checked={skipSpoilage} onChange={(e) => setSkipSpoilage(e.target.checked)} className="size-4" />
              Skip spoilage this week
            </label>

            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input
                type="checkbox"
                checked={overrideSelection}
                onChange={(e) => toggleOverrideSelection(e.target.checked)}
                className="size-4"
              />
              Override FIFO batch selection
            </label>

            {overrideSelection ? (
              <BatchSelectionEditor
                orderedSelection={orderedSelection}
                excluded={excluded}
                byId={byId}
                spoiling={selectable.filter((b) => b.willSpoil)}
                selectedAvailable={selectedAvailable}
                required={preview.appliedRequiredPortions}
                expectedShortage={expectedShortage}
                onInclude={includeBatch}
                onExclude={excludeBatch}
                onMove={move}
              />
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="food-reason" className="text-sm font-medium text-stone-800">Reason {usesOverride ? <span className="text-red-700">(required)</span> : <span className="font-normal text-stone-500">(only if overriding)</span>}</label>
              <input id="food-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={fieldClass} placeholder="Why the default is changed" aria-invalid={reasonMissing} />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={refreshPreview} disabled={!hydrated || previewing} className="border-stone-300">
              {previewing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              Update preview
            </Button>
            {previewError ? <p className="text-xs text-red-700">{previewError}</p> : null}
            {usesOverride ? (
              <p className="text-xs text-amber-700">
                Active overrides:{" "}
                {[
                  override.trim() !== "" ? `required portions → ${override}` : null,
                  skipSpoilage ? "skip spoilage" : null,
                  overrideSelection ? `custom batch order (${orderedSelection.length} selected)` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                . A reason is required.
              </p>
            ) : null}
          </div>
        </details>

        <ActionMessage state={commitState} />
        {commitState.status === "error" ? (
          <p className="text-xs text-stone-500">If a batch changed, update the preview and try again.</p>
        ) : null}

        <form action={commitAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
          <input type="hidden" name="targetWeek" value={currentWeek} />
          <input type="hidden" name="overrideRequiredPortions" value={override} />
          <input type="hidden" name="skipSpoilage" value={skipSpoilage ? "true" : "false"} />
          <input type="hidden" name="overrideBatchSelection" value={overrideSelection ? "true" : "false"} />
          <input type="hidden" name="selectedBatchIds" value={JSON.stringify(orderedSelection)} />
          <input type="hidden" name="reason" value={reason} />
          <Button type="submit" disabled={!hydrated || committing || commitBlocked} className="w-full bg-[#3f1e25] text-amber-50 hover:bg-[#542832]">
            {committing ? <LoaderCircle className="animate-spin" /> : <Wheat />}
            {committing ? "Processing…" : "Process weekly food"}
          </Button>
          {selectionEmpty ? <p className="mt-1.5 text-xs text-red-700">Select at least one batch, or turn off the batch override.</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function BatchSelectionEditor({
  orderedSelection,
  excluded,
  byId,
  spoiling,
  selectedAvailable,
  required,
  expectedShortage,
  onInclude,
  onExclude,
  onMove,
}: {
  orderedSelection: string[];
  excluded: SelectableBatch[];
  byId: Map<string, SelectableBatch>;
  spoiling: SelectableBatch[];
  selectedAvailable: number;
  required: number;
  expectedShortage: number;
  onInclude: (id: string) => void;
  onExclude: (id: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  return (
    <div role="group" aria-label="Batch selection override" className="space-y-3 rounded-lg border border-stone-200 bg-white/70 p-3">
      <p className="text-xs text-stone-500">
        Consumed in this order, oldest first by default. Reorder or exclude batches; excluded
        batches are never consumed.
      </p>

      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Selected (in order)</p>
        {orderedSelection.length === 0 ? (
          <p className="text-xs text-stone-500">No batches selected.</p>
        ) : (
          <ul className="space-y-1.5">
            {orderedSelection.map((id, index) => {
              const b = byId.get(id);
              if (!b) return null;
              return (
                <li key={id} className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm">
                  <span className="w-5 text-right tabular-nums text-stone-400">{index + 1}</span>
                  <span className="flex-1 truncate text-stone-800">
                    {b.label}
                    <span className="ml-2 text-xs text-stone-500">
                      {b.food_type} · wk {b.acquired_week} · {b.remaining_portions}p
                    </span>
                  </span>
                  <Button type="button" variant="outline" size="icon" aria-label={`Move ${b.label} up`} disabled={index === 0} onClick={() => onMove(index, -1)} className="size-7 border-stone-300">
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" aria-label={`Move ${b.label} down`} disabled={index === orderedSelection.length - 1} onClick={() => onMove(index, 1)} className="size-7 border-stone-300">
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => onExclude(id)} className="h-7 border-stone-300 text-xs">
                    Exclude
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {excluded.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Excluded</p>
          <ul className="space-y-1.5">
            {excluded.map((b) => (
              <li key={b.id} className="flex items-center gap-2 rounded-md border border-dashed border-stone-200 px-2.5 py-1.5 text-sm text-stone-500">
                <span className="flex-1 truncate">
                  {b.label}
                  <span className="ml-2 text-xs">
                    {b.food_type} · wk {b.acquired_week} · {b.remaining_portions}p
                  </span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => onInclude(b.id)} className="h-7 border-stone-300 text-xs">
                  Include
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {spoiling.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Spoiling this week (not consumable)</p>
          <ul className="space-y-1">
            {spoiling.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-xs text-red-700">
                <span className="flex-1 truncate">{b.label} · wk {b.acquired_week} · {b.remaining_portions}p</span>
                <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">Will spoil</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="grid grid-cols-3 gap-2 rounded-md bg-stone-50 px-3 py-2 text-sm">
        <div>
          <dt className="text-xs text-stone-500">Selected</dt>
          <dd className="tabular-nums text-stone-800">{selectedAvailable}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Required</dt>
          <dd className="tabular-nums text-stone-800">{required}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Shortage</dt>
          <dd className={`tabular-nums ${expectedShortage > 0 ? "text-red-700" : "text-stone-800"}`}>{expectedShortage}</dd>
        </div>
      </dl>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-stone-500 uppercase">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${highlight ? "text-red-700" : "text-stone-900"}`}>{value}</dd>
    </div>
  );
}

function batchBadge(status: string, foodType: string) {
  if (status === "spoiled") return { label: "Spoiled", cls: "border-red-300 bg-red-50 text-red-700" };
  if (status === "depleted") return { label: "Depleted", cls: "border-stone-300 bg-stone-100 text-stone-500" };
  return foodType === "fresh"
    ? { label: "Fresh", cls: "border-emerald-700/20 bg-emerald-50 text-emerald-800" }
    : { label: "Preserved", cls: "border-amber-700/20 bg-amber-50 text-amber-800" };
}

function BatchList({ batches, campaignId }: { batches: FoodBatchRow[]; campaignId: string }) {
  return (
    <section aria-labelledby="food-batches-heading" className="space-y-3">
      <h2 id="food-batches-heading" className="font-heading text-xl font-semibold text-stone-900">Food batches</h2>
      {batches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-white/55 px-6 py-8 text-center text-sm text-stone-500">No food batches yet.</p>
      ) : (
        <ul className="space-y-3">
          {batches.map((b) => {
            const badge = batchBadge(b.status, b.food_type);
            return (
              <li key={b.id} className="rounded-xl border border-stone-200 bg-white/90 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900">{b.label}</span>
                    <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
                  </div>
                  <span className="text-sm tabular-nums text-stone-600">
                    {b.remaining_portions}/{b.initial_portions} portions · acquired week {b.acquired_week}
                  </span>
                </div>
                {b.status !== "spoiled" ? (
                  <CorrectBatch batchId={b.id} campaignId={campaignId} initialPortions={b.initial_portions} remaining={b.remaining_portions} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CorrectBatch({ batchId, campaignId, initialPortions, remaining }: { batchId: string; campaignId: string; initialPortions: number; remaining: number }) {
  const hydrated = useHydrated();
  const [state, action, pending] = useActionState(correctFoodBatchAction, idle);
  const key = state.nextRequestKey ?? state.requestKey ?? undefined;
  useEffect(() => {
    if (state.status === "success") window.location.reload();
  }, [state.requestKey, state.status]);

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-stone-500 hover:text-stone-800">Correct quantity</summary>
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
        <div className="space-y-1">
          <label htmlFor={`correct-${batchId}`} className="block text-xs text-stone-600">Remaining (0–{initialPortions})</label>
          <input id={`correct-${batchId}`} name="newRemainingPortions" type="number" min={0} max={initialPortions} defaultValue={remaining} required disabled={pending} className="h-9 w-28 rounded-md border border-stone-300 px-2 text-sm" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`reason-${batchId}`} className="block text-xs text-stone-600">Reason</label>
          <input id={`reason-${batchId}`} name="reason" required maxLength={300} disabled={pending} className="h-9 w-56 rounded-md border border-stone-300 px-2 text-sm" placeholder="Miscount corrected" />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={!hydrated || pending} className="border-stone-300">
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          Save correction
        </Button>
        {state.status === "error" ? <p className="w-full text-xs text-red-700">{state.message}</p> : null}
      </form>
    </details>
  );
}

const TX_LABELS: Record<string, string> = {
  acquire: "Acquired",
  consume: "Consumed",
  spoil: "Spoiled",
  correction: "Correction",
  override_adjust: "Override",
};

function HistoryList({ history }: { history: FoodOverview["history"] }) {
  if (history.length === 0) return null;
  return (
    <section aria-labelledby="food-history-heading" className="space-y-3">
      <h2 id="food-history-heading" className="font-heading text-xl font-semibold text-stone-900">Recent food history</h2>
      <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white/90">
        {history.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="text-stone-700">
              {TX_LABELS[t.transaction_type] ?? t.transaction_type}
              {t.reason ? <span className="text-stone-500"> — {t.reason}</span> : null}
            </span>
            <span className={`tabular-nums ${t.portions_delta >= 0 ? "text-emerald-700" : "text-stone-600"}`}>
              {t.portions_delta >= 0 ? "+" : ""}{t.portions_delta} → {t.after_portions}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
