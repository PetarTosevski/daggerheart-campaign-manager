"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import {
  Backpack,
  Boxes,
  CheckCircle2,
  LoaderCircle,
  Package,
  Plus,
  Shield,
  TriangleAlert,
} from "lucide-react";

import {
  addInventoryItemAction,
  consumeInventoryEntryAction,
  correctInventoryEntryAction,
  createInventoryContainerAction,
  createItemDefinitionAction,
  equipInventoryEntryAction,
  mergeInventoryEntriesAction,
  splitInventoryEntryAction,
  transferInventoryEntryAction,
  unequipInventoryEntryAction,
  updateItemDefinitionAction,
  type InventoryActionState,
} from "@/app/(app)/inventory/actions";
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
import type {
  InventoryContainerRow,
  InventoryEntryRow,
  InventoryOverview,
  InventoryTransactionRow,
  ItemDefinitionRow,
} from "@/lib/data/inventory";
import {
  CONTAINER_TYPES,
  formatWeight,
  ITEM_CATEGORIES,
} from "@/lib/domain/inventory";
import { useHydrated } from "@/lib/hooks/use-hydrated";

const idle: InventoryActionState = { status: "idle" };
const fieldClass =
  "h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus-visible:border-amber-700 focus-visible:ring-2 focus-visible:ring-amber-700/20 disabled:opacity-60";
const buttonClass = "bg-[#3f1e25] text-amber-50 hover:bg-[#542832]";

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

function useInventoryForm(
  action: (prev: InventoryActionState, formData: FormData) => Promise<InventoryActionState>,
) {
  const [state, formAction, pending] = useActionState(action, idle);
  const hydrated = useHydrated();
  useEffect(() => {
    if (state.status === "success") window.location.reload();
  }, [state.requestKey, state.status]);
  const key = state.nextRequestKey ?? state.requestKey ?? undefined;
  return { state, formAction, pending, hydrated, key };
}

function ActionMessage({ state }: { state: InventoryActionState }) {
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

function SubmitButton({
  pending,
  hydrated,
  label,
  pendingLabel,
  className,
}: {
  pending: boolean;
  hydrated: boolean;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  return (
    <Button type="submit" disabled={!hydrated || pending} className={className ?? buttonClass}>
      {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
      {pending ? pendingLabel : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------

export function InventoryManager({ overview }: { overview: InventoryOverview }) {
  const { campaign, items, containers, entries, history, characters } = overview;

  const characterName = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "Unknown") : "Shared");
  }, [characters]);

  const itemById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );

  const activeItems = items.filter((i) => i.is_active);
  const totalUnits = entries.reduce((sum, e) => sum + e.quantity, 0);
  const equippedCount = entries.filter((e) => e.state === "equipped").length;

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  return (
    <div className="space-y-8">
      <Card className="border-stone-200 bg-white/90">
        <CardHeader>
          <div className="flex items-center gap-2 text-amber-800">
            <Boxes className="size-4" />
            <span className="text-xs font-semibold tracking-[0.16em] uppercase">
              Campaign inventory
            </span>
          </div>
          <CardTitle className="text-2xl text-stone-900">
            {totalUnits} <span className="text-base font-normal text-stone-500">units</span>{" "}
            {entries.length} <span className="text-base font-normal text-stone-500">stacks</span>
          </CardTitle>
          <CardDescription>
            {activeItems.length} item definition{activeItems.length === 1 ? "" : "s"} ·{" "}
            {containers.length} container{containers.length === 1 ? "" : "s"} ·{" "}
            {equippedCount} equipped
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.1fr)]">
        <AddItemForm
          campaignId={campaign.id}
          items={activeItems}
          containers={containers}
          characterName={characterName}
        />
        <div className="space-y-6">
          <CreateContainerForm
            campaignId={campaign.id}
            characters={characters}
            containers={containers}
          />
          <CreateItemForm campaignId={campaign.id} />
        </div>
      </div>

      <ItemDefinitionsSection campaignId={campaign.id} items={items} />

      <section aria-labelledby="inventory-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="inventory-heading" className="font-heading text-xl font-semibold text-stone-900">
            Holdings
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="inventory-search" className="text-xs font-medium text-stone-600">
                Search
              </label>
              <input
                id="inventory-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Item name"
                className={`${fieldClass} sm:w-52`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="inventory-category" className="text-xs font-medium text-stone-600">
                Category
              </label>
              <select
                id="inventory-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`${fieldClass} sm:w-44`}
              >
                <option value="">All categories</option>
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <InventoryTree
          campaignId={campaign.id}
          entries={entries}
          containers={containers}
          characters={characters}
          itemById={itemById}
          characterName={characterName}
          query={query.trim().toLowerCase()}
          category={category}
        />
      </section>

      <HistoryList
        history={history}
        itemName={(id) => (id ? (itemById.get(id)?.name ?? "Item") : "Item")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create forms
// ---------------------------------------------------------------------------

function CreateItemForm({ campaignId }: { campaignId: string }) {
  const { state, formAction, pending, hydrated, key } = useInventoryForm(createItemDefinitionAction);
  const [stackable, setStackable] = useState(false);

  return (
    <Card className="border-stone-200/80 bg-white/90">
      <CardHeader>
        <CardTitle className="text-lg">New item definition</CardTitle>
        <CardDescription>Reusable template for stacks of this item.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
          <input type="hidden" name="itemDefinitionId" value={crypto.randomUUID()} readOnly />
          <div className="space-y-1.5">
            <label htmlFor="item-name" className="text-sm font-medium text-stone-800">
              Name
            </label>
            <input
              id="item-name"
              name="name"
              required
              maxLength={100}
              disabled={pending}
              className={fieldClass}
              placeholder="Torch"
              aria-invalid={Boolean(state.fieldErrors?.name)}
            />
            {state.fieldErrors?.name?.[0] ? (
              <p className="text-xs text-red-700">{state.fieldErrors.name[0]}</p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="item-category" className="text-sm font-medium text-stone-800">
                Category
              </label>
              <select id="item-category" name="category" defaultValue="misc" disabled={pending} className={fieldClass}>
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="item-weight" className="text-sm font-medium text-stone-800">
                Unit weight <span className="font-normal text-stone-500">(optional)</span>
              </label>
              <input
                id="item-weight"
                name="unitWeight"
                type="number"
                min={0}
                step="0.01"
                disabled={pending}
                className={fieldClass}
                aria-invalid={Boolean(state.fieldErrors?.unitWeight)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input
                type="checkbox"
                name="stackable"
                checked={stackable}
                onChange={(e) => setStackable(e.target.checked)}
                disabled={pending}
                className="size-4"
              />
              Stackable
            </label>
            {stackable ? (
              <div className="space-y-1.5">
                <label htmlFor="item-stack-limit" className="text-sm font-medium text-stone-800">
                  Stack limit <span className="font-normal text-stone-500">(optional)</span>
                </label>
                <input
                  id="item-stack-limit"
                  name="defaultStackLimit"
                  type="number"
                  min={1}
                  step={1}
                  disabled={pending}
                  className={`${fieldClass} w-40`}
                  aria-invalid={Boolean(state.fieldErrors?.defaultStackLimit)}
                />
              </div>
            ) : (
              <input type="hidden" name="defaultStackLimit" value="" readOnly />
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="item-description" className="text-sm font-medium text-stone-800">
              Description <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <Textarea
              id="item-description"
              name="description"
              maxLength={500}
              disabled={pending}
              className="min-h-16 border-stone-300 bg-white text-stone-900"
            />
          </div>
          <ActionMessage state={state} />
          <SubmitButton pending={pending} hydrated={hydrated} label="Create item" pendingLabel="Creating…" />
        </form>
      </CardContent>
    </Card>
  );
}

function AddItemForm({
  campaignId,
  items,
  containers,
  characterName,
}: {
  campaignId: string;
  items: ItemDefinitionRow[];
  containers: InventoryContainerRow[];
  characterName: (id: string | null) => string;
}) {
  const { state, formAction, pending, hydrated, key } = useInventoryForm(addInventoryItemAction);

  return (
    <Card className="border-stone-200/80 bg-white/90">
      <CardHeader>
        <CardTitle className="text-lg">Add item to a container</CardTitle>
        <CardDescription>Create a new stack from an item definition.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 || containers.length === 0 ? (
          <p className="text-sm text-stone-600">
            Define at least one item and container first.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="campaignId" value={campaignId} />
            <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
            <input type="hidden" name="entryId" value={crypto.randomUUID()} readOnly />
            <div className="space-y-1.5">
              <label htmlFor="add-item" className="text-sm font-medium text-stone-800">
                Item
              </label>
              <select id="add-item" name="itemDefinitionId" disabled={pending} className={fieldClass} required>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.stackable ? "" : " (single)"}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="add-container" className="text-sm font-medium text-stone-800">
                  Container
                </label>
                <select id="add-container" name="containerId" disabled={pending} className={fieldClass} required>
                  {containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {characterName(c.character_id)} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="add-quantity" className="text-sm font-medium text-stone-800">
                  Quantity
                </label>
                <input
                  id="add-quantity"
                  name="quantity"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={1}
                  required
                  disabled={pending}
                  className={fieldClass}
                  aria-invalid={Boolean(state.fieldErrors?.quantity)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="add-custom-name" className="text-sm font-medium text-stone-800">
                Custom name <span className="font-normal text-stone-500">(optional)</span>
              </label>
              <input id="add-custom-name" name="customName" maxLength={100} disabled={pending} className={fieldClass} />
            </div>
            <input type="hidden" name="notes" value="" readOnly />
            <ActionMessage state={state} />
            <SubmitButton pending={pending} hydrated={hydrated} label="Add item" pendingLabel="Adding…" />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function CreateContainerForm({
  campaignId,
  characters,
  containers,
}: {
  campaignId: string;
  characters: InventoryOverview["characters"];
  containers: InventoryContainerRow[];
}) {
  const { state, formAction, pending, hydrated, key } = useInventoryForm(createInventoryContainerAction);
  const [owner, setOwner] = useState("");

  // Parent candidates must share the chosen owner (or be shared when no owner).
  const parentOptions = containers.filter((c) => (c.character_id ?? "") === owner);

  return (
    <Card className="border-stone-200/80 bg-white/90">
      <CardHeader>
        <CardTitle className="text-lg">New container</CardTitle>
        <CardDescription>A holder for a character or the shared store.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
          <input type="hidden" name="containerId" value={crypto.randomUUID()} readOnly />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="container-name" className="text-sm font-medium text-stone-800">
                Name
              </label>
              <input
                id="container-name"
                name="name"
                required
                maxLength={100}
                disabled={pending}
                className={fieldClass}
                placeholder="Saddlebags"
                aria-invalid={Boolean(state.fieldErrors?.name)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="container-type" className="text-sm font-medium text-stone-800">
                Type
              </label>
              <select id="container-type" name="containerType" defaultValue="storage" disabled={pending} className={fieldClass}>
                {CONTAINER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="container-owner" className="text-sm font-medium text-stone-800">
                Owner
              </label>
              <select
                id="container-owner"
                name="characterId"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                disabled={pending}
                className={fieldClass}
              >
                <option value="">Shared store</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="container-parent" className="text-sm font-medium text-stone-800">
                Parent <span className="font-normal text-stone-500">(optional)</span>
              </label>
              <select id="container-parent" name="parentContainerId" disabled={pending} className={fieldClass}>
                <option value="">None (top level)</option>
                {parentOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <input type="hidden" name="capacityValue" value="" readOnly />
          <ActionMessage state={state} />
          <SubmitButton pending={pending} hydrated={hydrated} label="Create container" pendingLabel="Creating…" />
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Item definitions list
// ---------------------------------------------------------------------------

function ItemDefinitionsSection({
  campaignId,
  items,
}: {
  campaignId: string;
  items: ItemDefinitionRow[];
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="items-heading" className="space-y-4">
      <h2 id="items-heading" className="font-heading text-xl font-semibold text-stone-900">
        Item definitions
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <ItemDefinitionCard key={item.id} campaignId={campaignId} item={item} />
        ))}
      </div>
    </section>
  );
}

function ItemDefinitionCard({
  campaignId,
  item,
}: {
  campaignId: string;
  item: ItemDefinitionRow;
}) {
  const { state, formAction, pending, hydrated, key } = useInventoryForm(updateItemDefinitionAction);

  return (
    <Card className={`border-stone-200 ${item.is_active ? "bg-white/90" : "bg-stone-100/80"}`}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium text-stone-900">{item.name}</p>
            <p className="text-xs text-stone-500">
              {titleCase(item.category)} · {item.stackable ? "stackable" : "single"}
              {item.stackable && item.default_stack_limit != null
                ? ` · max ${item.default_stack_limit}`
                : ""}
              {item.unit_weight != null ? ` · ${formatWeight(item.unit_weight)} wt` : ""}
            </p>
          </div>
          <Badge variant={item.is_active ? "default" : "secondary"}>
            {item.is_active ? "Active" : "Archived"}
          </Badge>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-[#6b303b]">Edit</summary>
          <form action={formAction} className="mt-3 space-y-3">
            <input type="hidden" name="campaignId" value={campaignId} />
            <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
            <input type="hidden" name="itemDefinitionId" value={item.id} readOnly />
            <div className="space-y-1">
              <label htmlFor={`edit-name-${item.id}`} className="text-xs font-medium text-stone-700">
                Name
              </label>
              <input
                id={`edit-name-${item.id}`}
                name="name"
                defaultValue={item.name}
                required
                maxLength={100}
                disabled={pending}
                className={fieldClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select name="category" defaultValue={item.category} disabled={pending} className={fieldClass}>
                {ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </select>
              <input
                name="unitWeight"
                type="number"
                min={0}
                step="0.01"
                defaultValue={item.unit_weight ?? ""}
                disabled={pending}
                className={fieldClass}
                placeholder="Weight"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input type="checkbox" name="stackable" defaultChecked={item.stackable} disabled={pending} className="size-4" />
              Stackable
            </label>
            <input
              name="defaultStackLimit"
              type="number"
              min={1}
              step={1}
              defaultValue={item.default_stack_limit ?? ""}
              disabled={pending}
              className={fieldClass}
              placeholder="Stack limit (optional)"
            />
            <input type="hidden" name="description" value={item.description ?? ""} readOnly />
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input type="checkbox" name="isActive" defaultChecked={item.is_active} disabled={pending} className="size-4" />
              Active
            </label>
            <ActionMessage state={state} />
            <Button type="submit" size="sm" disabled={!hydrated || pending} className={buttonClass}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {pending ? "Saving…" : "Save"}
            </Button>
          </form>
        </details>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Inventory tree grouped by owner and container
// ---------------------------------------------------------------------------

function InventoryTree({
  campaignId,
  entries,
  containers,
  characters,
  itemById,
  characterName,
  query,
  category,
}: {
  campaignId: string;
  entries: InventoryEntryRow[];
  containers: InventoryContainerRow[];
  characters: InventoryOverview["characters"];
  itemById: Map<string, ItemDefinitionRow>;
  characterName: (id: string | null) => string;
  query: string;
  category: string;
}) {
  // Owner groups: shared (null) first, then each character.
  const owners: (string | null)[] = [null, ...characters.map((c) => c.id)];

  const matches = (entry: InventoryEntryRow): boolean => {
    const item = itemById.get(entry.item_definition_id);
    if (category && item?.category !== category) return false;
    if (query) {
      const name = (entry.custom_name ?? item?.name ?? "").toLowerCase();
      if (!name.includes(query)) return false;
    }
    return true;
  };

  const visible = entries.filter(matches);

  return (
    <div className="space-y-6">
      {owners.map((ownerId) => {
        const ownerContainers = containers.filter((c) => (c.character_id ?? null) === ownerId);
        const ownerEntries = visible.filter((e) => (e.character_id ?? null) === ownerId);
        // Equipped entries have no container; group them separately per owner.
        const equipped = ownerEntries.filter((e) => e.state === "equipped");
        if (ownerContainers.length === 0 && ownerEntries.length === 0) return null;

        return (
          <Card key={ownerId ?? "shared"} className="border-stone-200 bg-white/90">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                {ownerId ? <Backpack className="size-4 text-amber-800" /> : <Boxes className="size-4 text-amber-800" />}
                {characterName(ownerId)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ownerContainers.map((container) => {
                const containerEntries = ownerEntries.filter(
                  (e) => e.container_id === container.id,
                );
                return (
                  <div key={container.id} className="rounded-lg border border-stone-200 bg-stone-50/60 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Package className="size-4 text-stone-500" />
                      <span className="text-sm font-semibold text-stone-800">{container.name}</span>
                      <span className="text-xs text-stone-500">{titleCase(container.container_type)}</span>
                    </div>
                    {containerEntries.length === 0 ? (
                      <p className="px-1 text-xs text-stone-500">Empty.</p>
                    ) : (
                      <ul className="space-y-2">
                        {containerEntries.map((entry) => (
                          <EntryRow
                            key={entry.id}
                            campaignId={campaignId}
                            entry={entry}
                            item={itemById.get(entry.item_definition_id) ?? null}
                            containers={containers}
                            characterName={characterName}
                            siblings={containerEntries}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              {equipped.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Shield className="size-4 text-amber-700" />
                    <span className="text-sm font-semibold text-stone-800">Equipped</span>
                  </div>
                  <ul className="space-y-2">
                    {equipped.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        campaignId={campaignId}
                        entry={entry}
                        item={itemById.get(entry.item_definition_id) ?? null}
                        containers={containers}
                        characterName={characterName}
                        siblings={[]}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
      {visible.length === 0 ? (
        <p className="text-sm text-stone-600">No items match the current filters.</p>
      ) : null}
    </div>
  );
}

function EntryRow({
  campaignId,
  entry,
  item,
  containers,
  characterName,
  siblings,
}: {
  campaignId: string;
  entry: InventoryEntryRow;
  item: ItemDefinitionRow | null;
  containers: InventoryContainerRow[];
  characterName: (id: string | null) => string;
  siblings: InventoryEntryRow[];
}) {
  const name = entry.custom_name ?? item?.name ?? "Item";
  const mergeTargets = siblings.filter(
    (s) => s.id !== entry.id && s.item_definition_id === entry.item_definition_id && s.state === "stored",
  );

  return (
    <li className="rounded-md border border-stone-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-stone-900">{name}</span>
          <Badge variant="secondary">×{entry.quantity}</Badge>
          {entry.state === "equipped" && entry.equipped_slot ? (
            <span className="text-xs text-amber-700">{entry.equipped_slot}</span>
          ) : null}
        </div>
      </div>
      <details className="group mt-1">
        <summary className="cursor-pointer text-xs font-medium text-[#6b303b]">Actions</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {entry.state === "stored" ? (
            <>
              <MoveForm
                campaignId={campaignId}
                entry={entry}
                containers={containers}
                characterName={characterName}
              />
              <ConsumeForm campaignId={campaignId} entry={entry} />
              {item?.stackable && entry.quantity > 1 ? (
                <SplitForm campaignId={campaignId} entry={entry} />
              ) : null}
              {mergeTargets.length > 0 ? (
                <MergeForm campaignId={campaignId} entry={entry} targets={mergeTargets} itemName={name} />
              ) : null}
              {entry.character_id && entry.quantity === 1 ? (
                <EquipForm campaignId={campaignId} entry={entry} />
              ) : null}
              <CorrectForm campaignId={campaignId} entry={entry} />
            </>
          ) : (
            <>
              <UnequipForm
                campaignId={campaignId}
                entry={entry}
                containers={containers.filter((c) => c.character_id === entry.character_id)}
              />
              <ConsumeForm campaignId={campaignId} entry={entry} />
            </>
          )}
        </div>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Per-entry action forms
// ---------------------------------------------------------------------------

function MiniForm({
  action,
  campaignId,
  entry,
  children,
  label,
}: {
  action: (prev: InventoryActionState, formData: FormData) => Promise<InventoryActionState>;
  campaignId: string;
  entry: InventoryEntryRow;
  children: React.ReactNode;
  label: string;
}) {
  const { state, formAction, pending, hydrated, key } = useInventoryForm(action);
  return (
    <form action={formAction} className="space-y-2 rounded-md border border-stone-200 p-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
      <input type="hidden" name="entryId" value={entry.id} readOnly />
      <p className="text-xs font-semibold text-stone-700">{label}</p>
      {children}
      <ActionMessage state={state} />
      <Button type="submit" size="sm" variant="outline" disabled={!hydrated || pending} className="border-stone-300">
        {pending ? <LoaderCircle className="animate-spin" /> : null}
        {pending ? "Working…" : label}
      </Button>
    </form>
  );
}

function MoveForm({
  campaignId,
  entry,
  containers,
  characterName,
}: {
  campaignId: string;
  entry: InventoryEntryRow;
  containers: InventoryContainerRow[];
  characterName: (id: string | null) => string;
}) {
  const targets = containers.filter((c) => c.id !== entry.container_id);
  if (targets.length === 0) return null;
  return (
    <MiniForm action={transferInventoryEntryAction} campaignId={campaignId} entry={entry} label="Move / transfer">
      <select name="targetContainerId" className={fieldClass} required>
        {targets.map((c) => (
          <option key={c.id} value={c.id}>
            {characterName(c.character_id)} · {c.name}
          </option>
        ))}
      </select>
      <input name="reason" maxLength={300} placeholder="Reason (optional)" className={fieldClass} />
    </MiniForm>
  );
}

function ConsumeForm({ campaignId, entry }: { campaignId: string; entry: InventoryEntryRow }) {
  return (
    <MiniForm action={consumeInventoryEntryAction} campaignId={campaignId} entry={entry} label="Consume">
      <input
        name="quantity"
        type="number"
        min={1}
        max={entry.quantity}
        step={1}
        defaultValue={1}
        required
        className={fieldClass}
      />
      <input name="reason" maxLength={300} placeholder="Reason (optional)" className={fieldClass} />
    </MiniForm>
  );
}

function SplitForm({ campaignId, entry }: { campaignId: string; entry: InventoryEntryRow }) {
  const { state, formAction, pending, hydrated, key } = useInventoryForm(splitInventoryEntryAction);
  return (
    <form action={formAction} className="space-y-2 rounded-md border border-stone-200 p-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
      <input type="hidden" name="entryId" value={entry.id} readOnly />
      <input type="hidden" name="newEntryId" value={crypto.randomUUID()} readOnly />
      <p className="text-xs font-semibold text-stone-700">Split</p>
      <input
        name="quantity"
        type="number"
        min={1}
        max={entry.quantity - 1}
        step={1}
        defaultValue={1}
        required
        className={fieldClass}
      />
      <ActionMessage state={state} />
      <Button type="submit" size="sm" variant="outline" disabled={!hydrated || pending} className="border-stone-300">
        {pending ? <LoaderCircle className="animate-spin" /> : null}
        {pending ? "Working…" : "Split"}
      </Button>
    </form>
  );
}

function MergeForm({
  campaignId,
  entry,
  targets,
  itemName,
}: {
  campaignId: string;
  entry: InventoryEntryRow;
  targets: InventoryEntryRow[];
  itemName: string;
}) {
  const { state, formAction, pending, hydrated, key } = useInventoryForm(mergeInventoryEntriesAction);
  return (
    <form action={formAction} className="space-y-2 rounded-md border border-stone-200 p-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="idempotencyKey" value={key ?? crypto.randomUUID()} readOnly />
      <input type="hidden" name="sourceEntryId" value={entry.id} readOnly />
      <p className="text-xs font-semibold text-stone-700">Merge {itemName} into</p>
      <select name="targetEntryId" className={fieldClass} required>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            stack ×{t.quantity}
          </option>
        ))}
      </select>
      <ActionMessage state={state} />
      <Button type="submit" size="sm" variant="outline" disabled={!hydrated || pending} className="border-stone-300">
        {pending ? <LoaderCircle className="animate-spin" /> : null}
        {pending ? "Working…" : "Merge"}
      </Button>
    </form>
  );
}

function EquipForm({ campaignId, entry }: { campaignId: string; entry: InventoryEntryRow }) {
  return (
    <MiniForm action={equipInventoryEntryAction} campaignId={campaignId} entry={entry} label="Equip">
      <input name="equippedSlot" maxLength={40} required placeholder="main hand" className={fieldClass} />
    </MiniForm>
  );
}

function UnequipForm({
  campaignId,
  entry,
  containers,
}: {
  campaignId: string;
  entry: InventoryEntryRow;
  containers: InventoryContainerRow[];
}) {
  if (containers.length === 0) return null;
  return (
    <MiniForm action={unequipInventoryEntryAction} campaignId={campaignId} entry={entry} label="Unequip">
      <select name="targetContainerId" className={fieldClass} required>
        {containers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </MiniForm>
  );
}

function CorrectForm({ campaignId, entry }: { campaignId: string; entry: InventoryEntryRow }) {
  return (
    <MiniForm action={correctInventoryEntryAction} campaignId={campaignId} entry={entry} label="Correct">
      <input
        name="newQuantity"
        type="number"
        min={0}
        step={1}
        defaultValue={entry.quantity}
        required
        className={fieldClass}
      />
      <input name="reason" maxLength={300} required placeholder="Reason (required)" className={fieldClass} />
    </MiniForm>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryList({
  history,
  itemName,
}: {
  history: InventoryTransactionRow[];
  itemName: (id: string | null) => string;
}) {
  if (history.length === 0) return null;
  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <h2 id="history-heading" className="font-heading text-xl font-semibold text-stone-900">
        Recent history
      </h2>
      <Card className="border-stone-200 bg-white/90">
        <CardContent className="py-2">
          <ul className="divide-y divide-stone-100">
            {history.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">{row.transaction_type}</Badge>
                  <span className="text-stone-700">{itemName(row.item_definition_id)}</span>
                  {row.reason ? <span className="text-xs text-stone-500">— {row.reason}</span> : null}
                </span>
                <span className="tabular-nums text-stone-500">
                  {row.quantity_delta > 0 ? `+${row.quantity_delta}` : row.quantity_delta}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
