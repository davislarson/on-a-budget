"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatMonthLabel, shiftMonth } from "@/lib/dates";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn btn-secondary" onClick={() => go(shiftMonth(month, -1))}>
        ←
      </button>
      <span className="min-w-40 text-center font-semibold">{formatMonthLabel(month)}</span>
      <button type="button" className="btn btn-secondary" onClick={() => go(shiftMonth(month, 1))}>
        →
      </button>
    </div>
  );
}
