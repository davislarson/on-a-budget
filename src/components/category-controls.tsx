"use client";

import { useActionState, useState } from "react";
import { Money } from "@/components/money";
import type { Category } from "@/db/schema";
import { initialActionState, type ActionState } from "@/lib/action-state";
import {
  archiveCategory,
  createCategory,
  moveCategory,
  restoreCategory,
  updateCategory,
} from "@/lib/actions";

function centsToInput(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function FormError({ state }: { state: ActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="w-full text-sm text-danger">
      {state.error}
    </p>
  );
}

export function CategoryForm({ kind }: { kind: Category["kind"] }) {
  const [state, formAction, pending] = useActionState(createCategory, initialActionState);
  const values = state.values ?? {};

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="kind" value={kind} />
      <label className="field min-w-40 flex-1">
        <span>New category</span>
        <input
          name="name"
          required
          placeholder={kind === "expense" ? "e.g. Pets" : "e.g. Interest"}
          defaultValue={values.name}
        />
      </label>
      {kind === "expense" && (
        <label className="field w-36">
          <span>Monthly cap</span>
          <input name="monthlyCap" inputMode="decimal" placeholder="No cap" defaultValue={values.monthlyCap} />
        </label>
      )}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </button>
      <FormError state={state} />
    </form>
  );
}

export function CategoryRow({
  category,
  averageCents,
  isFirst,
  isLast,
}: {
  category: Category;
  // Recent average monthly spending; undefined when there's no history.
  averageCents?: number;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, saving] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await updateCategory(prev, formData);
      if (!result.error) setEditing(false);
      return result;
    },
    initialActionState,
  );
  const isExpense = category.kind === "expense";
  const cap = category.monthlyCapCents;

  if (editing) {
    const values = state.values ?? { name: category.name, monthlyCap: centsToInput(cap) };
    return (
      <li className="py-3">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={category.id} />
          <label className="field min-w-40 flex-1">
            <span>Name</span>
            <input name="name" required defaultValue={values.name} autoFocus />
          </label>
          {isExpense && (
            <label className="field w-36">
              <span>Monthly cap</span>
              <input name="monthlyCap" inputMode="decimal" placeholder="No cap" defaultValue={values.monthlyCap} />
            </label>
          )}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <FormError state={state} />
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0">
        <p className="font-medium">{category.name}</p>
        {isExpense && averageCents !== undefined && (
          <p className={`text-sm ${cap !== null && averageCents > cap ? "text-danger" : "text-muted"}`}>
            Recently <Money cents={averageCents} /> a month
          </p>
        )}
      </div>
      <div className="flex items-center gap-4">
        {isExpense &&
          (cap === null ? (
            <span className="text-sm text-muted">No cap</span>
          ) : (
            <Money cents={cap} className="text-lg font-semibold" />
          ))}
        <div className="flex gap-1">
          <form action={moveCategory}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="direction" value="up" />
            <button
              className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-40"
              type="submit"
              disabled={isFirst}
              aria-label={`Move ${category.name} up`}
            >
              ↑
            </button>
          </form>
          <form action={moveCategory}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="direction" value="down" />
            <button
              className="btn btn-secondary px-2 py-1 text-xs disabled:opacity-40"
              type="submit"
              disabled={isLast}
              aria-label={`Move ${category.name} down`}
            >
              ↓
            </button>
          </form>
          <button className="btn btn-secondary px-2 py-1 text-xs" type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <form action={archiveCategory}>
            <input type="hidden" name="id" value={category.id} />
            <button className="btn btn-danger px-2 py-1 text-xs" type="submit">
              Archive
            </button>
          </form>
        </div>
      </div>
    </li>
  );
}

export function ArchivedCategoryRow({ category }: { category: Category }) {
  const [state, formAction, pending] = useActionState(restoreCategory, initialActionState);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
      <p>
        {category.name} <span className="text-sm text-muted">· {category.kind}</span>
      </p>
      <form action={formAction}>
        <input type="hidden" name="id" value={category.id} />
        <button className="btn btn-secondary px-2 py-1 text-xs" type="submit" disabled={pending}>
          Restore
        </button>
      </form>
      <FormError state={state} />
    </li>
  );
}
