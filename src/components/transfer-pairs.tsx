import { Money } from "@/components/money";
import { dismissTransferPair, markTransferPair, markTransferPairs } from "@/lib/actions";
import type { TransferSide } from "@/lib/queries";
import type { TransferMatch } from "@/lib/transfers";

const SHOWN = 10;

function Side({ side, label }: { side: TransferSide; label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="truncate">{side.payee || side.rawDescription || "—"}</div>
      <div className="text-xs text-muted">
        {side.accountName} · {side.date}
        {side.categoryName && ` · ${side.categoryName}`}
      </div>
    </div>
  );
}

// Pairs of transactions that look like money moving between your own accounts.
export function TransferPairs({ pairs }: { pairs: TransferMatch<TransferSide>[] }) {
  if (pairs.length === 0) return null;
  const count = pairs.length;
  const shown = pairs.slice(0, SHOWN);

  return (
    <details id="transfers" className="card p-5" open>
      <summary className="cursor-pointer font-semibold">
        {count} possible transfer{count === 1 ? "" : "s"} between your accounts
      </summary>
      <p className="mt-2 text-sm text-muted">
        Each pair is the same amount leaving one account and arriving in another within a few days, like a
        credit card payment. Transfers don&apos;t count as income or spending.
      </p>
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {shown.map((pair) => (
          <li
            key={`${pair.out.id}-${pair.in.id}`}
            className="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-[1fr_1fr_auto_auto]"
          >
            <Side side={pair.out} label="Out of" />
            <Side side={pair.in} label="Into" />
            <Money cents={Math.abs(pair.out.amountCents)} className="font-semibold sm:text-right" />
            <div className="flex gap-1">
              <form action={markTransferPair}>
                <input type="hidden" name="outId" value={pair.out.id} />
                <input type="hidden" name="inId" value={pair.in.id} />
                <button type="submit" className="btn btn-secondary px-2 py-1 text-xs">
                  Mark as transfer
                </button>
              </form>
              <form action={dismissTransferPair}>
                <input type="hidden" name="outId" value={pair.out.id} />
                <input type="hidden" name="inId" value={pair.in.id} />
                <button type="submit" className="btn px-2 py-1 text-xs text-muted hover:text-foreground">
                  Not a transfer
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {shown.length > 1 && (
          <form action={markTransferPairs}>
            {shown.map((pair) => (
              <input key={pair.out.id} type="hidden" name="pairs" value={`${pair.out.id}-${pair.in.id}`} />
            ))}
            <button type="submit" className="btn btn-primary text-sm">
              Mark {count > SHOWN ? "these" : "all"} {shown.length} as transfers
            </button>
          </form>
        )}
        {count > SHOWN && (
          <span className="text-sm text-muted">
            Showing the {SHOWN} most recent of {count}. More appear as you deal with these.
          </span>
        )}
      </div>
    </details>
  );
}
