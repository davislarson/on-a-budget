"use client";

import { useState } from "react";
import type { Account, Category } from "@/db/schema";
import { createTransaction } from "@/lib/actions";
import { todayIso } from "@/lib/dates";

export function TransactionForm({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: Category[];
}) {
  const [type, setType] = useState<"expense" | "income" | "transfer">("expense");
  const visibleCats = categories.filter((cat) =>
    type === "income" ? cat.kind === "income" : type === "expense" ? cat.kind === "expense" : false,
  );

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add an account first, then you can record transactions.
      </p>
    );
  }

  return (
    <form action={createTransaction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <label className="field">
        <span>Type</span>
        <select name="type" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label className="field">
        <span>Account</span>
        <select name="accountId" required defaultValue={accounts[0].id}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Date</span>
        <input type="date" name="date" required defaultValue={todayIso()} />
      </label>
      <label className="field">
        <span>Amount</span>
        <input name="amount" inputMode="decimal" placeholder="0.00" required />
      </label>
      <label className="field">
        <span>Payee</span>
        <input name="payee" placeholder="Who / where" />
      </label>
      {type === "transfer" ? (
        <p className="field self-end text-sm text-muted">Transfers are ignored in budget math.</p>
      ) : (
        <label className="field">
          <span>Category</span>
          <select name="categoryId" defaultValue="">
            <option value="">Uncategorized</option>
            {visibleCats.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field sm:col-span-2 lg:col-span-5">
        <span>Notes</span>
        <input name="rawDescription" placeholder="Optional description" />
      </label>
      <div className="flex items-end">
        <button className="btn btn-primary w-full" type="submit">
          Add
        </button>
      </div>
    </form>
  );
}
