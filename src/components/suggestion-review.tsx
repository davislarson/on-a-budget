"use client";

import { useRef, useState, useTransition } from "react";
import { Money } from "@/components/money";
import type { Category } from "@/db/schema";
import {
  acceptSuggestions,
  dismissSuggestions,
  suggestNextChunk,
  type SuggestionDecision,
} from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import type { SuggestionGroup } from "@/lib/queries";

export type SuggestionRunner = ReturnType<typeof useSuggestionRunner>;

// Lives in the import wizard so finishing an import can start it.
export function useSuggestionRunner() {
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const stopRequested = useRef(false);

  async function run() {
    stopRequested.current = false;
    setRunning(true);
    setStopping(false);
    setError(null);
    setProgress({ checked: 0, total: 0 });
    let checked = 0;
    try {
      while (!stopRequested.current) {
        const step = await suggestNextChunk();
        if (step.error !== undefined) {
          setError(step.error);
          break;
        }
        checked += step.checked;
        setProgress({ checked, total: checked + step.remaining });
        if (step.remaining === 0) break;
      }
    } catch {
      setError("Something went wrong while getting suggestions. Your import is saved.");
    }
    setRunning(false);
    setStopping(false);
  }

  function stop() {
    stopRequested.current = true;
    setStopping(true);
  }

  return { running, stopping, progress, error, run, stop };
}

type Choice = { categoryId?: number; makeRule?: boolean };

export function SuggestionReview({
  runner,
  groups,
  uncheckedCount,
  categories,
  modelName,
}: {
  runner: SuggestionRunner;
  groups: SuggestionGroup[];
  uncheckedCount: number;
  categories: Category[];
  modelName: string;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [outcome, setOutcome] = useState<ActionState>({});
  const [saving, startSaving] = useTransition();

  if (!runner.running && !runner.error && groups.length === 0 && uncheckedCount === 0 && !outcome.message) {
    return null;
  }

  const chosenCategory = (group: SuggestionGroup) => choices[group.merchantKey]?.categoryId ?? group.categoryId;
  const decisionFor = (group: SuggestionGroup): SuggestionDecision | null => {
    const categoryId = chosenCategory(group);
    if (categoryId === null) return null;
    return { merchantKey: group.merchantKey, categoryId, makeRule: choices[group.merchantKey]?.makeRule ?? false };
  };
  const ready = groups.map(decisionFor).filter((decision) => decision !== null);

  function accept(decisions: SuggestionDecision[]) {
    startSaving(async () => setOutcome(await acceptSuggestions(decisions)));
  }

  function choose(merchantKey: string, change: Choice) {
    setChoices((current) => ({ ...current, [merchantKey]: { ...current[merchantKey], ...change } }));
  }

  return (
    <section className="card p-5" aria-labelledby="suggestions-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="suggestions-heading" className="font-semibold">
            Review AI suggestions
          </h2>
          <p className="mt-1 text-sm text-muted">
            From {modelName}, running on this computer. Nothing changes until you accept it, and the AI can be wrong.
          </p>
        </div>
        {ready.length > 0 && (
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => accept(ready)}>
            {saving ? "Saving…" : `Accept ${ready.length === 1 ? "1 suggestion" : `all ${ready.length}`}`}
          </button>
        )}
      </div>

      {runner.running && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm" role="status">
          <span>
            {runner.progress.total > 0
              ? `Checked ${runner.progress.checked} of ${runner.progress.total} merchants…`
              : "Asking the AI… This can take a few minutes for a large file."}
          </span>
          <button
            type="button"
            className="btn btn-secondary px-2 py-1 text-xs"
            disabled={runner.stopping}
            onClick={runner.stop}
          >
            {runner.stopping ? "Stopping after this batch…" : "Stop"}
          </button>
        </div>
      )}

      {!runner.running && (runner.error || uncheckedCount > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          {runner.error ? (
            <p role="alert" className="text-danger">
              {runner.error} Your import is saved.
            </p>
          ) : (
            <p>
              {uncheckedCount} merchant{uncheckedCount === 1 ? " hasn't" : "s haven't"} been checked yet.
            </p>
          )}
          {uncheckedCount > 0 && (
            <button type="button" className="btn btn-secondary px-2 py-1 text-xs" onClick={() => void runner.run()}>
              {runner.error ? "Try again" : "Continue"}
            </button>
          )}
        </div>
      )}

      {outcome.error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {outcome.error}
        </p>
      )}
      {outcome.message && (
        <p role="status" className="mt-4 text-sm text-ok">
          {outcome.message}
        </p>
      )}

      {groups.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {groups.map((group) => {
            const decision = decisionFor(group);
            const selectId = `suggestion-${group.merchantKey}`;
            return (
              <li key={group.merchantKey} className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 py-3">
                <div className="min-w-48 flex-1">
                  <p className="font-medium break-words">{group.merchantText}</p>
                  <p className="text-sm text-muted">
                    {group.count} transaction{group.count === 1 ? "" : "s"} ·{" "}
                    {group.kind === "expense" ? "money out" : "money in"}, about <Money cents={group.typicalCents} />
                    {group.categoryId === null && " · The AI wasn't sure"}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="field min-w-40" htmlFor={selectId}>
                    <span>Category</span>
                    <select
                      id={selectId}
                      value={chosenCategory(group) ?? ""}
                      onChange={(event) => choose(group.merchantKey, { categoryId: Number(event.target.value) })}
                    >
                      <option value="" disabled>
                        Choose a category…
                      </option>
                      {categories
                        .filter((category) => category.kind === group.kind)
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={choices[group.merchantKey]?.makeRule ?? false}
                      onChange={(event) => choose(group.merchantKey, { makeRule: event.target.checked })}
                    />
                    Make a rule
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={saving || decision === null}
                      onClick={() => decision && accept([decision])}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={saving}
                      onClick={() => startSaving(() => dismissSuggestions(group.merchantKey))}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
