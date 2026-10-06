"use client";

import { useActionState, useState } from "react";
import type { Category } from "@/db/schema";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { applyRules, createRule, deleteRule, updateRule } from "@/lib/actions";
import type { Rule } from "@/lib/rules";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="w-full text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="w-full text-sm text-ok">
        {state.message}
      </p>
    );
  }
  return null;
}

function RuleFields({
  categories,
  values,
}: {
  categories: Category[];
  values: { pattern?: string; categoryId?: string };
}) {
  return (
    <>
      <label className="field min-w-48 flex-1">
        <span>When the payee or description contains</span>
        <input name="pattern" required minLength={2} placeholder="e.g. trader joe" defaultValue={values.pattern} />
      </label>
      <label className="field min-w-40">
        <span>Categorize as</span>
        {/* Keyed so the choice survives the form reset after a failed submit. */}
        <select key={values.categoryId} name="categoryId" required defaultValue={values.categoryId ?? ""}>
          <option value="" disabled>
            Choose a category…
          </option>
          <optgroup label="Spending">
            {categories
              .filter((cat) => cat.kind === "expense")
              .map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Income">
            {categories
              .filter((cat) => cat.kind === "income")
              .map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
    </>
  );
}

export function RuleForm({ categories }: { categories: Category[] }) {
  const [state, formAction, pending] = useActionState(createRule, initialActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <RuleFields categories={categories} values={state.values ?? {}} />
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add rule"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ApplyRulesButton({ uncategorizedCount }: { uncategorizedCount: number }) {
  const [state, formAction, pending] = useActionState(applyRules, initialActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button className="btn btn-secondary" type="submit" disabled={pending || uncategorizedCount === 0}>
        {pending ? "Applying…" : "Apply rules now"}
      </button>
      <span className="text-sm text-muted">
        {uncategorizedCount === 0
          ? "Nothing is uncategorized."
          : `${uncategorizedCount} uncategorized transaction${uncategorizedCount === 1 ? "" : "s"}.`}
      </span>
      <Feedback state={state} />
    </form>
  );
}

export function RuleRow({
  rule,
  matchCount,
  categories,
}: {
  rule: Rule;
  matchCount: number;
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, saving] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await updateRule(prev, formData);
      if (!result.error) setEditing(false);
      return result;
    },
    initialActionState,
  );

  if (editing) {
    const values = state.values ?? { pattern: rule.pattern, categoryId: String(rule.categoryId) };
    return (
      <li className="py-3">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={rule.id} />
          <RuleFields categories={categories} values={values} />
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <Feedback state={state} />
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0">
        <p>
          <span className="text-muted">Contains </span>
          <span className="rounded bg-background px-1.5 py-0.5 font-mono text-sm">{rule.pattern}</span>
          <span className="text-muted"> → </span>
          <span className="font-medium">{rule.categoryName}</span>
          {rule.categoryArchived && <span className="text-sm text-danger"> (archived — rule is inactive)</span>}
        </p>
        <p className="text-sm text-muted">
          Appears in {matchCount} transaction{matchCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex gap-1">
        <button className="btn btn-secondary px-2 py-1 text-xs" type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <form
          action={deleteRule}
          onSubmit={(event) => {
            if (!confirm(`Delete the rule for "${rule.pattern}"? Transactions it already categorized stay as they are.`)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={rule.id} />
          <button className="btn btn-danger px-2 py-1 text-xs" type="submit">
            Delete
          </button>
        </form>
      </div>
    </li>
  );
}
