"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2, LoaderCircle, Plus, TriangleAlert } from "lucide-react";

import {
  createCountdownAction,
  type CountdownActionState,
} from "@/app/(app)/dashboard/countdown-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { COUNTDOWN_CATEGORIES } from "@/lib/domain/countdowns";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { COUNTDOWN_DETAILS_MAX_LENGTH } from "@/lib/validation/countdowns";

const initialState: CountdownActionState = { status: "idle" };
const fieldClassName =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:cursor-not-allowed disabled:opacity-60";

export function CountdownCreateForm({
  campaignId,
  initialIdempotencyKey,
}: {
  campaignId: string;
  initialIdempotencyKey: string;
}) {
  const hydrated = useHydrated();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    createCountdownAction,
    initialState,
  );
  const idempotencyKey =
    state.nextRequestKey ?? state.requestKey ?? initialIdempotencyKey;

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      window.location.reload();
    }
  }, [state.requestKey, state.status]);

  return (
    <Card className="border-stone-200/80 bg-white/90 shadow-[0_18px_55px_-38px_rgba(41,37,36,0.5)]">
      <CardHeader>
        <div className="flex items-center gap-2 text-amber-800">
          <Plus className="size-4" />
          <span className="text-xs font-semibold tracking-[0.16em] uppercase">
            New tracker
          </span>
        </div>
        <CardTitle className="text-xl text-stone-900">Create countdown</CardTitle>
        <CardDescription>
          Count down from a positive starting value. Reaching zero completes it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="space-y-4">
          <input type="hidden" name="campaignId" value={campaignId} />
          <input
            type="hidden"
            name="idempotencyKey"
            value={idempotencyKey}
            readOnly
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="countdown-name" className="text-sm font-medium text-stone-800">
                Name
              </label>
              <input
                id="countdown-name"
                name="name"
                required
                maxLength={100}
                disabled={pending}
                className={fieldClassName}
                placeholder="The blight reaches the refuge"
                aria-invalid={Boolean(state.fieldErrors?.name)}
              />
              {state.fieldErrors?.name?.[0] ? (
                <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="countdown-category" className="text-sm font-medium text-stone-800">
                Category
              </label>
              <select
                id="countdown-category"
                name="category"
                defaultValue="threat"
                disabled={pending}
                className={fieldClassName}
              >
                {COUNTDOWN_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category[0].toUpperCase() + category.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="countdown-starting-value" className="text-sm font-medium text-stone-800">
                Starting value
              </label>
              <input
                id="countdown-starting-value"
                name="startingValue"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                defaultValue={6}
                required
                disabled={pending}
                className={fieldClassName}
                aria-invalid={Boolean(state.fieldErrors?.startingValue)}
              />
              {state.fieldErrors?.startingValue?.[0] ? (
                <p className="text-xs text-red-700">
                  {state.fieldErrors.startingValue[0]}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="countdown-description" className="text-sm font-medium text-stone-800">
              Description <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <Textarea
              id="countdown-description"
              name="description"
              maxLength={COUNTDOWN_DETAILS_MAX_LENGTH}
              disabled={pending}
              className="min-h-20 border-stone-300 bg-white text-stone-900"
              placeholder="What is developing?"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="countdown-consequence" className="text-sm font-medium text-stone-800">
              Narrative consequence <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <Textarea
              id="countdown-consequence"
              name="consequence"
              maxLength={COUNTDOWN_DETAILS_MAX_LENGTH}
              disabled={pending}
              className="min-h-20 border-stone-300 bg-white text-stone-900"
              placeholder="What happens when it reaches zero?"
            />
          </div>

          {state.status !== "idle" ? (
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
          ) : null}

          <Button
            type="submit"
            disabled={!hydrated || pending || !idempotencyKey}
            className="w-full bg-[#3f1e25] text-amber-50 hover:bg-[#542832]"
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
            {pending ? "Creating…" : "Create countdown"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
