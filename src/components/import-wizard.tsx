"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useState, useTransition } from "react";
import { Money } from "@/components/money";
import type { Account } from "@/db/schema";
import { importCsvRows, undoImport, type ImportResult } from "@/lib/actions";
import {
  emptyMapping,
  guessMapping,
  mapRow,
  mappingFits,
  mappingIsComplete,
  parseSavedMapping,
  readRow,
  type CsvRow,
  type ImportMapping,
} from "@/lib/import-mapping";

const PREVIEW_ROWS = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type ParsedFile = { name: string; headers: string[]; rows: CsvRow[] };

function mappingFor(accountId: number, headers: string[], savedMappings: Record<number, string>) {
  const saved = savedMappings[accountId] ? parseSavedMapping(savedMappings[accountId]) : null;
  if (saved && mappingFits(saved, headers)) return { mapping: saved, remembered: true };
  return { mapping: guessMapping(headers), remembered: false };
}

export function ImportWizard({
  accounts,
  savedMappings,
}: {
  accounts: Account[];
  savedMappings: Record<number, string>;
}) {
  const [accountId, setAccountId] = useState(accounts[0].id);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping);
  const [remembered, setRemembered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ImportResult & { month?: string }) | null>(null);
  const [pending, startTransition] = useTransition();
  // Remounts the file input so the same file can be chosen again.
  const [inputKey, setInputKey] = useState(0);

  function applyMapping(nextAccountId: number, headers: string[]) {
    const next = mappingFor(nextAccountId, headers, savedMappings);
    setMapping(next.mapping);
    setRemembered(next.remembered);
  }

  function reset() {
    setFile(null);
    setMapping(emptyMapping);
    setRemembered(false);
    setInputKey((key) => key + 1);
  }

  function onFile(chosen: File | undefined) {
    setError(null);
    setResult(null);
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) {
      setError("That file is larger than 10 MB. Export a shorter date range from your bank.");
      return;
    }
    Papa.parse<CsvRow>(chosen, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (parsed) => {
        const headers = (parsed.meta.fields ?? []).filter((header) => header.trim() !== "");
        if (headers.length === 0 || parsed.data.length === 0) {
          setError("Couldn't find any rows in that file. Is it a CSV with a header row?");
          return;
        }
        setFile({ name: chosen.name, headers, rows: parsed.data });
        applyMapping(accountId, headers);
      },
      error: () => setError("Couldn't read that file. Is it a CSV?"),
    });
  }

  const invert = mapping.amountMode === "single" && mapping.invert;
  const complete = mappingIsComplete(mapping);
  const mapped = useMemo(
    () => (file && complete ? file.rows.map((row) => mapRow(row, mapping)) : []),
    [file, mapping, complete],
  );
  const read = useMemo(() => mapped.map((row) => readRow(row, invert)), [mapped, invert]);
  const readable = read.filter((row) => row !== null);
  const spendingCount = readable.filter((row) => row.amountCents < 0).length;
  const incomeCount = readable.length - spendingCount;
  const unreadableCount = read.length - readable.length;

  function runImport() {
    if (!file) return;
    setError(null);
    const latest = readable.reduce((max, row) => (row.date > max ? row.date : max), "");
    startTransition(async () => {
      const outcome = await importCsvRows({ accountId, filename: file.name, mapping, rows: mapped });
      if (outcome.error !== undefined) {
        setError(outcome.error);
        return;
      }
      setResult({ ...outcome, month: latest.slice(0, 7) });
      reset();
    });
  }

  function set<K extends keyof ImportMapping>(key: K, value: ImportMapping[K]) {
    setMapping((current) => ({ ...current, [key]: value }));
    setRemembered(false);
  }

  function columnSelect(label: string, key: "date" | "amount" | "debit" | "credit" | "payee" | "description", optional = false) {
    return (
      <label className="field">
        <span>{label}</span>
        <select value={mapping[key]} onChange={(event) => set(key, event.target.value)}>
          <option value="">{optional ? "None" : "Choose a column…"}</option>
          {file?.headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {result && result.error === undefined && (
        <section className="card border-ok/40 p-5" role="status">
          <h2 className="font-semibold">Import finished</h2>
          <p className="mt-1 text-sm">
            Added {result.imported} transaction{result.imported === 1 ? "" : "s"}.
            {result.duplicates > 0 && ` Skipped ${result.duplicates} already imported.`}
            {result.unreadable > 0 && ` Skipped ${result.unreadable} that couldn't be read.`}
            {result.categorized > 0 && ` Your rules categorized ${result.categorized} of them.`}
          </p>
          {result.imported > 0 && (
            <Link
              href={`/transactions?month=${result.month}&account=${accountId}&category=uncategorized`}
              className="btn btn-primary mt-4"
            >
              Categorize them
            </Link>
          )}
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">1. Choose an account and a file</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span>Account</span>
            <select
              value={accountId}
              onChange={(event) => {
                const next = Number(event.target.value);
                setAccountId(next);
                if (file) applyMapping(next, file.headers);
              }}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>CSV file from your bank</span>
            <input
              key={inputKey}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted">
          The file is read in your browser and saved only to the database on this computer.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </section>

      {file && (
        <section className="card p-5">
          <h2 className="font-semibold">2. Match the columns</h2>
          <p className="mt-1 text-sm text-muted">
            {file.name} · {file.rows.length.toLocaleString("en-US")} rows.{" "}
            {remembered
              ? "Using the columns from this account's last import."
              : "These are best guesses from the column names — check them."}
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {columnSelect("Date", "date")}
            <label className="field">
              <span>Amounts are in</span>
              <select
                value={mapping.amountMode}
                onChange={(event) => set("amountMode", event.target.value as ImportMapping["amountMode"])}
              >
                <option value="single">One column</option>
                <option value="split">Separate money out / money in columns</option>
              </select>
            </label>
            {mapping.amountMode === "single" ? (
              columnSelect("Amount", "amount")
            ) : (
              <>
                {columnSelect("Money out (debit)", "debit")}
                {columnSelect("Money in (credit)", "credit")}
              </>
            )}
            {columnSelect("Description", "description", true)}
            {columnSelect("Payee", "payee", true)}
          </div>

          {mapping.amountMode === "single" && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mapping.invert}
                onChange={(event) => set("invert", event.target.checked)}
              />
              This file shows spending as positive numbers — flip the signs
            </label>
          )}
        </section>
      )}

      {file && complete && (
        <section className="card p-5">
          <h2 className="font-semibold">3. Check and import</h2>
          <p className="mt-1 text-sm text-muted">
            {spendingCount.toLocaleString("en-US")} spending (negative) and{" "}
            {incomeCount.toLocaleString("en-US")} income (positive).
            {unreadableCount > 0 &&
              ` ${unreadableCount.toLocaleString("en-US")} row${unreadableCount === 1 ? "" : "s"} can't be read and will be skipped.`}{" "}
            Rows you&apos;ve already imported into this account are skipped automatically.
          </p>
          {readable.length > 0 && spendingCount < incomeCount && (
            <p className="mt-2 text-sm text-danger">
              Most rows are positive. If these are purchases, the signs are probably reversed
              {mapping.amountMode === "single" ? " — tick the box above." : " — swap the two columns above."}
            </p>
          )}

          <div className="table-wrap mt-4">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Description</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {mapped.slice(0, PREVIEW_ROWS).map((row, index) => {
                  const ok = read[index];
                  return ok ? (
                    <tr key={index}>
                      <td className="whitespace-nowrap text-muted">{ok.date}</td>
                      <td>{ok.payee || "—"}</td>
                      <td className="text-muted">{ok.description}</td>
                      <td className="whitespace-nowrap text-right">
                        <Money cents={ok.amountCents} signed className={ok.amountCents > 0 ? "text-ok" : ""} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={index} className="text-danger">
                      <td className="whitespace-nowrap">{row.date || "(no date)"}</td>
                      <td colSpan={2}>Will be skipped — the date or amount can&apos;t be read</td>
                      <td className="whitespace-nowrap text-right">{row.amount || "(no amount)"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mapped.length > PREVIEW_ROWS && (
            <p className="mt-2 text-xs text-muted">
              Showing the first {PREVIEW_ROWS} of {mapped.length.toLocaleString("en-US")} rows.
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || readable.length === 0}
              onClick={runImport}
            >
              {pending
                ? "Importing…"
                : `Import ${readable.length.toLocaleString("en-US")} row${readable.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={reset}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export function UndoImportButton({ id, remainingCount }: { id: number; remainingCount: number }) {
  return (
    <form
      action={undoImport}
      onSubmit={(event) => {
        const message =
          remainingCount > 0
            ? `Undo this import? This deletes its ${remainingCount} transaction${remainingCount === 1 ? "" : "s"}, including any categories you set on them. This can't be undone.`
            : "Remove this entry from the import history?";
        if (!confirm(message)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-danger px-2 py-1 text-xs" type="submit">
        {remainingCount > 0 ? "Undo import" : "Remove"}
      </button>
    </form>
  );
}
