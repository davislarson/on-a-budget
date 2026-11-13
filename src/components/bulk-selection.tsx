"use client";

import { createContext, useActionState, useContext, useState, type ReactNode } from "react";
import type { Category } from "@/db/schema";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { bulkUpdateTransactions } from "@/lib/actions";

type Selection = {
  isSelected: (id: number) => boolean;
  toggle: (id: number) => void;
  allSelected: boolean;
  someSelected: boolean;
  toggleAll: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection() {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("Use inside <BulkSelection>.");
  return selection;
}

// Lets you tick rows of the transactions table and change them together.
// `ids` are the rows on screen; ticks on rows that disappear are dropped.
export function BulkSelection({
  ids,
  categories,
  children,
}: {
  ids: number[];
  categories: Category[];
  children: ReactNode;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const selected = ids.filter((id) => ticked.has(id));
  const allSelected = ids.length > 0 && selected.length === ids.length;

  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await bulkUpdateTransactions(prev, formData);
      if (!result.error) {
        setTicked(new Set());
        setNotice(result.message ?? null);
      }
      return result;
    },
    initialActionState,
  );

  function change(next: ReadonlySet<number>) {
    setTicked(next);
    setNotice(null);
  }

  const selection: Selection = {
    isSelected: (id) => ticked.has(id),
    toggle: (id) => {
      const next = new Set(ticked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      change(next);
    },
    allSelected,
    someSelected: selected.length > 0 && !allSelected,
    toggleAll: () => change(allSelected ? new Set() : new Set(ids)),
  };

  const count = selected.length;

  return (
    <SelectionContext.Provider value={selection}>
      {count > 0 ? (
        <form
          action={formAction}
          className="sticky top-2 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-card px-4 py-3 shadow-sm"
          onSubmit={(event) => {
            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            if (
              submitter?.value === "delete" &&
              !confirm(`Delete ${count} transaction${count === 1 ? "" : "s"}? This can't be undone.`)
            ) {
              event.preventDefault();
            }
          }}
        >
          {selected.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          <span className="mr-2 text-sm font-semibold">{count} selected</span>
          <select
            name="categoryId"
            aria-label="Category for the selected transactions"
            defaultValue=""
            className="rounded-lg border border-line bg-white px-2 py-1 text-sm"
          >
            <option value="">Uncategorized</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.kind === "income" ? "↓ " : ""}
                {cat.name}
              </option>
            ))}
          </select>
          <button type="submit" name="op" value="category" disabled={pending} className="btn btn-secondary px-2 py-1 text-xs">
            Set category
          </button>
          <button type="submit" name="op" value="transfer" disabled={pending} className="btn btn-secondary px-2 py-1 text-xs">
            Mark transfer
          </button>
          <button type="submit" name="op" value="not-transfer" disabled={pending} className="btn btn-secondary px-2 py-1 text-xs">
            Not transfer
          </button>
          <button type="submit" name="op" value="delete" disabled={pending} className="btn btn-danger px-2 py-1 text-xs">
            Delete
          </button>
          <button
            type="button"
            onClick={() => change(new Set())}
            className="btn ml-auto px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            Clear selection
          </button>
          {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
        </form>
      ) : (
        notice && (
          <p role="status" className="mt-4 rounded-xl border border-line bg-card px-4 py-3 text-sm">
            {notice}
          </p>
        )
      )}
      {children}
    </SelectionContext.Provider>
  );
}

export function SelectAllCheckbox() {
  const { allSelected, someSelected, toggleAll } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label="Select all transactions"
      checked={allSelected}
      ref={(element) => {
        if (element) element.indeterminate = someSelected;
      }}
      onChange={toggleAll}
    />
  );
}

export function RowCheckbox({ id, label }: { id: number; label: string }) {
  const { isSelected, toggle } = useSelection();
  return <input type="checkbox" aria-label={`Select ${label}`} checked={isSelected(id)} onChange={() => toggle(id)} />;
}
