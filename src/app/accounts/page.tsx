import { connection } from "next/server";
import { AccountForm, AccountRow } from "@/components/account-controls";
import { Money } from "@/components/money";
import { listAccountSummaries } from "@/lib/queries";

export default async function AccountsPage() {
  // Read balances at request time rather than baking them in at build time.
  await connection();
  const accounts = listAccountSummaries();
  const assetsCents = accounts
    .filter((account) => account.balanceCents > 0)
    .reduce((sum, account) => sum + account.balanceCents, 0);
  const debtsCents = accounts
    .filter((account) => account.balanceCents < 0)
    .reduce((sum, account) => sum - account.balanceCents, 0);
  const netWorthCents = assetsCents - debtsCents;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>

      {accounts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Net worth">
            <Money cents={netWorthCents} className={netWorthCents < 0 ? "text-danger" : ""} />
          </Stat>
          <Stat label="You have">
            <Money cents={assetsCents} className="text-ok" />
          </Stat>
          <Stat label="You owe">
            <Money cents={debtsCents} className={debtsCents > 0 ? "text-danger" : ""} />
          </Stat>
        </div>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">Add an account</h2>
        <div className="mt-4">
          <AccountForm />
        </div>
      </section>

      <section className="card px-5 py-1">
        {accounts.length === 0 ? (
          <p className="py-4 text-sm text-muted">
            No accounts yet. Add your checking account above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-2 text-2xl font-semibold">{children}</div>
    </div>
  );
}
