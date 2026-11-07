"use client";

import { useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownToLine, ArrowUpToLine, GripVertical, Loader2 } from "lucide-react";
import { reorderPlan, type Category, type Item, type WritePlan } from "@px-pos/core";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/shared/field";
import { FormDialog } from "@/components/shared/form-dialog";
import { SelectField } from "@/components/shared/form-controls";
import { FoodMark, Money } from "@/components/shared/money";
import { useClient } from "@/components/providers/client-provider";
import { usePrincipal } from "@/components/providers/principal-provider";
import type { WithId } from "@/lib/firebase/hooks";
import { useRunPlan } from "@/lib/run-plan";
import { cn } from "@/lib/utils";

type Row = WithId<Item>;

function SortableRow({ item, index, count, onTop, onBottom }: { item: Row; index: number; count: number; onTop: () => void; onBottom: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 border-b bg-card px-2 py-1.5 last:border-0", isDragging && "relative z-10 border-y border-brand/60", !item.active && "opacity-60")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move ${item.name} (position ${index + 1} of ${count}). Space to pick up, arrows to move, space to drop.`}
        className="inline-flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
      <FoodMark type={item.foodType} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {item.name}
        {!item.active ? <span className="text-muted-foreground"> · off the menu</span> : null}
      </span>
      <Money value={item.pricePaise} decimals="auto" className="hidden shrink-0 text-sm text-muted-foreground sm:inline" />
      <Button type="button" variant="ghost" size="sm" onClick={onTop} disabled={index === 0} aria-label={`Move ${item.name} to the top`} className="shrink-0 px-2">
        <ArrowUpToLine data-icon="inline-start" aria-hidden />
        <span className="hidden sm:inline">Top</span>
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onBottom} disabled={index === count - 1} aria-label={`Move ${item.name} to the bottom`} className="shrink-0">
        <ArrowDownToLine aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Put a category's items in the order the till shows them: drag (mouse, touch or keyboard), or
 * send one to the top. Saving reuses the category's own sort numbers, so where the category sits
 * among the others doesn't change.
 */
export function ArrangeDialog({ open, onOpenChange, categories, items, initialCategoryId }: { open: boolean; onOpenChange: (o: boolean) => void; categories: Array<WithId<Category>>; items: Row[]; initialCategoryId: string }) {
  const { cid } = useClient();
  const { planCtx } = usePrincipal();
  const { run, pending } = useRunPlan();
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [order, setOrder] = useState<string[]>([]);
  const inCategory = (catId: string) => items.filter((i) => i.categoryId === catId).sort((a, b) => a.sort - b.sort);

  const [seen, setSeen] = useState({ open, initialCategoryId });
  if (seen.open !== open || seen.initialCategoryId !== initialCategoryId) {
    setSeen({ open, initialCategoryId });
    if (open) {
      setCategoryId(initialCategoryId);
      setOrder(inCategory(initialCategoryId).map((i) => i.id));
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = order.map((id) => byId.get(id)).filter((i): i is Row => Boolean(i));
  const original = inCategory(categoryId).map((i) => i.id);
  const dirty = order.join() !== original.join();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setOrder((o) => arrayMove(o, o.indexOf(String(e.active.id)), o.indexOf(String(e.over!.id))));
  };
  const moveTo = (id: string, where: "top" | "bottom") => setOrder((o) => (where === "top" ? [id, ...o.filter((x) => x !== id)] : [...o.filter((x) => x !== id), id]));

  async function save() {
    // The category keeps its own sort numbers (strictly increasing), handed out in the new order.
    const slots = original.map((id) => byId.get(id)!.sort).sort((a, b) => a - b);
    for (let k = 1; k < slots.length; k++) if (slots[k]! <= slots[k - 1]!) slots[k] = slots[k - 1]! + 1;
    const changed = order.map((id, k) => ({ id, sort: slots[k]! })).filter((o) => byId.get(o.id)?.sort !== o.sort);
    if (!changed.length) return onOpenChange(false);
    const plans: WritePlan[] = [];
    for (let k = 0; k < changed.length; k += 400) plans.push(reorderPlan(planCtx(cid), "items", changed.slice(k, k + 400)));
    if (await run(plans, "Order saved. The tills show it now.")) onOpenChange(false);
  }

  const category = categories.find((c) => c.id === categoryId);
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !pending && onOpenChange(o)}
      title={category ? `Arrange ${category.name}` : "Arrange items"}
      className="sm:max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={pending || !dirty}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : null}
            Save order
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Category" htmlFor="arrange-cat">
          <SelectField
            id="arrange-cat"
            value={categoryId}
            onValueChange={(v) => {
              setCategoryId(v);
              setOrder(inCategory(v).map((i) => i.id));
            }}
            options={categories.map((c) => ({ value: c.id, label: `${c.name} (${items.filter((i) => i.categoryId === c.id).length})` }))}
          />
        </Field>
        {rows.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ul className="overflow-clip rounded-xl border" aria-label={`Items in ${category?.name ?? "this category"}, in till order`}>
                {rows.map((item, idx) => (
                  <SortableRow key={item.id} item={item} index={idx} count={rows.length} onTop={() => moveTo(item.id, "top")} onBottom={() => moveTo(item.id, "bottom")} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No items in this category.</p>
        )}
      </div>
    </FormDialog>
  );
}
