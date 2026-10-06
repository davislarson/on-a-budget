"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Money } from "@/components/money";
import type { Account } from "@/db/schema";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { createAccount, deleteAccount, updateAccount } from "@/lib/actions";
import type { AccountSummary } from "@/lib/queries";

const TYPE_LABELS: Record<Account["type"], string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
};
const ACCOUNT_TYPES = Object.keys(TYPE_LABELS) as Array<Account["type"]>;

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function AccountFields({
  values,
}: {
  values: { name?: string; type?: string; institution?: string; openingBalance?: string };
}) {
  return (
    <>
      <label className="field">
        <span>Name</span>
        <input name="name" required placeholder="Everyday checking" defaultValue={values.name} />
      </label>
      <label className="field">
        <span>Type</span>
        {/* Keyed so the choice survives the form reset after a failed submit. */}
        <select key={values.type} name="type" defaultValue={values.type ?? "checking"}>
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Bank (optional)</span>
        <input name="institution" placeholder="Bank name" defaultValue={values.institution} />
      </label>
      <label className="field">
        <span>Starting balance</span>
        <input
          name="openingBalance"
          inputMode="decimal"
          placeholder="0.00"
          defaultValue={values.openingBalance}
        />
      </label>
    </>
  );
}

function FormError({ state }: { state: ActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-sm text-danger sm:col-span-2 lg:col-span-5">
      {state.error}
    </p>
  );
}

export function AccountForm() {
  const [state, formAction, pending] = useActionState(createAccount, initialActionState);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <AccountFields values={state.values ?? {}} />
      <div className="flex items-end">
        <button className="btn btn-primary w-full" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add account"}
        </button>
      </div>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-5">
        Starting balance is what the account held before the first transaction you record or
        import. For a credit card, enter what you owed as a negative number, like -320.50.
      </p>
      <FormError state={state} />
    </form>
  );
}

export function AccountRow({ account }: { account: AccountSummary }) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction, saving] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await updateAccount(prev, formData);
      if (!result.error) setEditing(false);
      return result;
    },
    initialActionState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(deleteAccount, initialActionState);

  if (editing) {
    const values = editState.values ?? {
      name: account.name,
      type: account.type,
      institution: account.institution ?? "",
      openingBalance: centsToInput(account.openingBalanceCents),
    };
    return (
      <li className="py-4">
        <form action={editAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input type="hidden" name="id" value={account.id} />
          <AccountFields values={values} />
          <div className="flex items-end gap-2">
            <button className="btn btn-primary flex-1" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <FormError state={editState} />
        </form>
      </li>
    );
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="font-medium">{account.name}</p>
          <p className="text-sm text-muted">
            {TYPE_LABELS[account.type]}
            {account.institution ? ` · ${account.institution}` : ""}
            {" · "}
            <Link href={`/transactions?account=${account.id}`} className="hover:underline">
              {account.transactionCount} transaction{account.transactionCount === 1 ? "" : "s"}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Money
            cents={account.balanceCents}
            className={`text-lg font-semibold ${account.balanceCents < 0 ? "text-danger" : ""}`}
          />
          <div className="flex gap-1">
            <button
              className="btn btn-secondary px-2 py-1 text-xs"
              type="button"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <form
              action={deleteAction}
              onSubmit={(event) => {
                if (!confirm(`Delete "${account.name}"? This can't be undone.`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={account.id} />
              <button className="btn btn-danger px-2 py-1 text-xs" type="submit" disabled={deleting}>
                Delete
              </button>
            </form>
          </div>
        </div>
      </div>
      {deleteState.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {deleteState.error}
        </p>
      )}
    </li>
  );
}
