export function dollarsToCents(value: string | number): number {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  const cleaned = value.replace(/[$,\s]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    throw new Error("Invalid amount");
  }
  const negative = cleaned.startsWith("(") && cleaned.endsWith(")");
  const numeric = negative ? cleaned.slice(1, -1) : cleaned;
  const amount = Number.parseFloat(numeric);
  if (!Number.isFinite(amount)) {
    throw new Error("Invalid amount");
  }
  const cents = Math.round(amount * 100);
  return negative ? -cents : cents;
}

export function tryDollarsToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return dollarsToCents(value);
  } catch {
    return null;
  }
}

export function formatCents(cents: number, options?: { sign?: "auto" | "never" }): string {
  const signMode = options?.sign ?? "auto";
  const abs = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(abs);
  if (signMode === "never") return formatted;
  if (cents < 0) return `−${formatted}`;
  if (cents > 0 && signMode === "auto") return formatted;
  return formatted;
}

export function formatCentsSigned(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(abs);
  if (cents < 0) return `−${formatted}`;
  if (cents > 0) return `+${formatted}`;
  return formatted;
}
