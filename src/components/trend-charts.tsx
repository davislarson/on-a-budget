"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMonthLabel, formatMonthTick } from "@/lib/dates";
import { formatCents, formatCentsSigned } from "@/lib/money";

export type MonthPoint = {
  month: string;
  incomeCents: number;
  spendCents: number;
  netCents: number;
};

const AXIS_TICK = { fill: "var(--muted)", fontSize: 12 };
const HOVER_WASH = { fill: "var(--foreground)", fillOpacity: 0.05 };

// Whole-dollar axis labels: $0, $500, $1.5k, $12k.
function axisDollars(cents: number) {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "−" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function monthAxis(months: string[]) {
  return (
    <XAxis
      dataKey="month"
      tickFormatter={(month: string) => formatMonthTick(month, month === months[0])}
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={{ stroke: "var(--viz-axis)" }}
      interval="preserveStartEnd"
      minTickGap={12}
    />
  );
}

function TooltipCard({
  title,
  rows,
  note,
}: {
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-sm shadow-md">
      <p className="text-xs text-muted">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="mt-1 flex items-center gap-2">
          {row.color && <span className="h-0.5 w-3 rounded-full" style={{ background: row.color }} />}
          <span className="font-mono font-semibold tabular-nums">{row.value}</span>
          <span className="text-muted">{row.label}</span>
        </p>
      ))}
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function IncomeSpendingChart({ data }: { data: MonthPoint[] }) {
  const router = useRouter();
  const open = (bar: { payload?: MonthPoint }) => {
    if (bar.payload) router.push(`/transactions?month=${bar.payload.month}`);
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        {monthAxis(data.map((point) => point.month))}
        <YAxis tickFormatter={axisDollars} tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} />
        <Tooltip
          cursor={HOVER_WASH}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as MonthPoint | undefined;
            if (!active || !point) return null;
            return (
              <TooltipCard
                title={formatMonthLabel(point.month)}
                rows={[
                  { label: "Income", value: formatCents(point.incomeCents), color: "var(--series-1)" },
                  { label: "Spending", value: formatCents(point.spendCents), color: "var(--series-2)" },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="incomeCents"
          name="Income"
          fill="var(--series-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
          cursor="pointer"
          onClick={open}
        />
        <Bar
          dataKey="spendCents"
          name="Spending"
          fill="var(--series-2)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
          cursor="pointer"
          onClick={open}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function NetChart({ data }: { data: MonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        {monthAxis(data.map((point) => point.month))}
        <YAxis tickFormatter={axisDollars} tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} />
        <ReferenceLine y={0} stroke="var(--viz-axis)" />
        <Tooltip
          cursor={HOVER_WASH}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as MonthPoint | undefined;
            if (!active || !point) return null;
            const rate =
              point.incomeCents > 0
                ? `${Math.round((point.netCents / point.incomeCents) * 100)}% of income`
                : undefined;
            return (
              <TooltipCard
                title={formatMonthLabel(point.month)}
                rows={[
                  {
                    label: point.netCents < 0 ? "Overspent" : "Left over",
                    value: formatCentsSigned(point.netCents),
                    color: point.netCents < 0 ? "var(--viz-negative)" : "var(--series-1)",
                  },
                ]}
                note={rate}
              />
            );
          }}
        />
        <Bar dataKey="netCents" name="Left over" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
          {data.map((point) => (
            <Cell key={point.month} fill={point.netCents < 0 ? "var(--viz-negative)" : "var(--series-1)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export type CategorySeries = {
  id: number;
  name: string;
  capCents: number | null;
  points: Array<{ month: string; spentCents: number }>;
};

export function CategoryChart({ series }: { series: CategorySeries }) {
  const router = useRouter();
  const cap = series.capCents;
  const hasSpending = series.points.some((point) => point.spentCents > 0);
  const showCap = cap !== null && cap > 0;

  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={series.points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        {monthAxis(series.points.map((point) => point.month))}
        <YAxis
          // With nothing to plot, give the axis a range so it doesn't repeat "$0".
          domain={[0, hasSpending || showCap ? "auto" : 10000]}
          tickFormatter={axisDollars}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={44}
          tickCount={3}
        />
        <Tooltip
          cursor={HOVER_WASH}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as CategorySeries["points"][number] | undefined;
            if (!active || !point) return null;
            const note =
              cap === null
                ? undefined
                : point.spentCents > cap
                  ? `${formatCents(point.spentCents - cap)} over the ${formatCents(cap)} cap`
                  : `Within the ${formatCents(cap)} cap`;
            return (
              <TooltipCard
                title={formatMonthLabel(point.month)}
                rows={[{ label: series.name, value: formatCents(point.spentCents), color: "var(--series-1)" }]}
                note={note}
              />
            );
          }}
        />
        <Bar
          dataKey="spentCents"
          name={series.name}
          fill="var(--series-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={16}
          isAnimationActive={false}
          cursor="pointer"
          onClick={(bar: { payload?: CategorySeries["points"][number] }) => {
            if (bar.payload) router.push(`/transactions?month=${bar.payload.month}&category=${series.id}`);
          }}
        />
        {showCap && (
          <ReferenceLine
            y={cap}
            stroke="var(--foreground)"
            strokeOpacity={0.55}
            strokeDasharray="4 3"
            ifOverflow="extendDomain"
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
