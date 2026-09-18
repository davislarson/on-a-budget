import { formatCents, formatCentsSigned } from "@/lib/money";

export function Money({
  cents,
  signed = false,
  className = "",
}: {
  cents: number;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {signed ? formatCentsSigned(cents) : formatCents(cents)}
    </span>
  );
}
