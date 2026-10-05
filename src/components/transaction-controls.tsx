"use client";

import type { Category } from "@/db/schema";
import { deleteTransaction, toggleTransfer, updateTransactionCategory } from "@/lib/actions";

export function CategorySelect({
  transactionId,
  categoryId,
  isTransfer,
  categories,
}: {
  transactionId: number;
  categoryId: number | null;
  isTransfer: boolean;
  categories: Category[];
}) {
  if (isTransfer) {
    return <span className="text-sm text-muted">Transfer</span>;
  }

  return (
    <form action={updateTransactionCategory}>
      <input type="hidden" name="id" value={transactionId} />
      <select
        name="categoryId"
        defaultValue={categoryId ?? ""}
        className="rounded-lg border border-line bg-white px-2 py-1 text-sm"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">Uncategorized</option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.kind === "income" ? "↓ " : ""}
            {cat.name}
          </option>
        ))}
      </select>
    </form>
  );
}

export function TransactionButtons({
  id,
  isTransfer,
}: {
  id: number;
  isTransfer: boolean;
}) {
  return (
    <div className="flex justify-end gap-1">
      <form action={toggleTransfer}>
        <input type="hidden" name="id" value={id} />
        <button className="btn btn-secondary px-2 py-1 text-xs" type="submit">
          {isTransfer ? "Not transfer" : "Mark transfer"}
        </button>
      </form>
      <form
        action={deleteTransaction}
        onSubmit={(event) => {
          if (!confirm("Delete this transaction? This can't be undone.")) event.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button className="btn btn-danger px-2 py-1 text-xs" type="submit">
          Delete
        </button>
      </form>
    </div>
  );
}
