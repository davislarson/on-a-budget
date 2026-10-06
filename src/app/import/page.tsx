import Link from "next/link";
import { connection } from "next/server";
import { ImportWizard, UndoImportButton } from "@/components/import-wizard";
import { todayIso } from "@/lib/dates";
import { lastMappingByAccount, listAccounts, listImportHistory } from "@/lib/queries";

export default async function ImportPage() {
  // Read accounts and history at request time rather than baking them in at build time.
  await connection();
  const accounts = listAccounts();
  const history = listImportHistory();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Import</h1>

      {accounts.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-muted">Add an account first, then you can import its transactions.</p>
          <Link href="/accounts" className="btn btn-primary mt-6">
            Add an account
          </Link>
        </div>
      ) : (
        <ImportWizard accounts={accounts} savedMappings={lastMappingByAccount()} />
      )}

      {history.length > 0 && (
        <section className="card p-5">
          <h2 className="font-semibold">Import history</h2>
          <div className="table-wrap mt-2">
            <table className="data">
              <thead>
                <tr>
                  <th>Imported</th>
                  <th>File</th>
                  <th>Account</th>
                  <th className="text-right">Added</th>
                  <th className="text-right">Skipped</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((batch) => (
                  <tr key={batch.id}>
                    <td className="whitespace-nowrap text-muted">{todayIso(new Date(batch.createdAt))}</td>
                    <td>{batch.filename}</td>
                    <td className="text-muted">{batch.accountName ?? "—"}</td>
                    <td className="text-right font-mono tabular-nums">
                      {batch.importedCount}
                      {batch.remainingCount !== batch.importedCount && (
                        <span className="text-muted"> ({batch.remainingCount} left)</span>
                      )}
                    </td>
                    <td className="text-right font-mono tabular-nums">{batch.skippedCount}</td>
                    <td>
                      <div className="flex justify-end">
                        <UndoImportButton id={batch.id} remainingCount={batch.remainingCount} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
