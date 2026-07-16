import {
  DollarSign,
  BarChart2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Heart,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransparencyMonth {
  id: number;
  periodYear: number;
  periodMonth: number;
  expensesCents: number;
  donationsCents: number;
  goalFoundationCents: number;
  invoiceUrls: { label: string; url: string }[];
  notes: string | null;
}

interface TransparencyTotals {
  totalExpensesCents: number;
  totalDonationsCents: number;
  totalGoalFoundationCents: number;
  monthCount: number;
}

type SortKey = "period" | "donations" | "expenses" | "foundation";
type SortDir = "asc" | "desc";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Sort header button ───────────────────────────────────────────────────────

function SortButton({
  label,
  sortKey,
  current,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 font-semibold text-xs uppercase tracking-wider hover:text-foreground transition-colors group"
    >
      {label}
      <span className="text-muted-foreground/50 group-hover:text-muted-foreground">
        {active ? (
          dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ArrowUpDown size={12} />
        )}
      </span>
    </button>
  );
}

// ─── Single-month summary card (fallback when only 1 record) ─────────────────

function SingleMonthCard({ month }: { month: TransparencyMonth }) {
  const name = `${MONTH_NAMES[(month.periodMonth - 1) % 12]} ${month.periodYear}`;
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
        {name} — first report
      </p>
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Raised",
            value: `$${dollars(month.donationsCents)}`,
            color: "text-green-400",
          },
          {
            label: "Expenses",
            value: `$${dollars(month.expensesCents)}`,
            color: "text-foreground",
          },
          {
            label: "Goal Foundation",
            value: `$${dollars(month.goalFoundationCents)}`,
            color: "text-primary",
          },
        ].map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>
      {month.notes && (
        <p className="text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
          {month.notes}
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Transparency() {
  const [sortKey, setSortKey] = useState<SortKey>("period");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: monthsData, isLoading: monthsLoading } = useQuery({
    queryKey: ["transparency"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/transparency`);
      const json = (await res.json()) as { months: TransparencyMonth[] };
      return json.months;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: totalsData, isLoading: totalsLoading } = useQuery({
    queryKey: ["transparency-totals"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/transparency/totals`);
      return res.json() as Promise<TransparencyTotals>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const months = monthsData ?? [];
  const totals = totalsData;
  const isLoading = monthsLoading || totalsLoading;

  // Sorting
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function periodValue(m: TransparencyMonth) {
    return m.periodYear * 100 + m.periodMonth;
  }

  const sorted = [...months].sort((a, b) => {
    let diff = 0;
    if (sortKey === "period") diff = periodValue(a) - periodValue(b);
    else if (sortKey === "donations") diff = a.donationsCents - b.donationsCents;
    else if (sortKey === "expenses") diff = a.expensesCents - b.expensesCents;
    else if (sortKey === "foundation") diff = a.goalFoundationCents - b.goalFoundationCents;
    return sortDir === "asc" ? diff : -diff;
  });

  // Chart data (always chronological)
  const chartData = [...months]
    .sort((a, b) => periodValue(a) - periodValue(b))
    .map((m) => ({
      name: `${MONTH_SHORT[(m.periodMonth - 1) % 12]} ${m.periodYear}`,
      Donations: parseFloat((m.donationsCents / 100).toFixed(2)),
      Expenses: parseFloat((m.expensesCents / 100).toFixed(2)),
      "Goal Foundation": parseFloat((m.goalFoundationCents / 100).toFixed(2)),
    }));

  return (
    <div className="space-y-10 pb-16 max-w-3xl">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-primary/20 text-primary text-xs font-mono font-bold mb-3 tracking-wider">
          <DollarSign size={13} />
          TRANSPARENCY
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight uppercase mb-2">
          Monthly Report
        </h1>
        <p className="text-muted-foreground text-lg leading-relaxed">
          Every dollar that comes in, every dollar that goes out — published
          here each month so you always know where your support goes.
        </p>
      </div>

      {/* ── The promise ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-3">
        <div className="flex items-center gap-2 text-primary font-bold text-sm uppercase tracking-wider">
          <Heart size={16} />
          How it works
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This tracker is funded entirely by readers — through{" "}
          <a
            href="https://buymeacoffee.com/thetrutru"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
          >
            Buy Me a Coffee
          </a>
          . Operating costs include data APIs, Replit, and hosting. When
          donations exceed those costs, every extra dollar goes to the{" "}
          <a
            href="https://goalfoundation.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
          >
            Goal Foundation
          </a>{" "}
          — an organization that helps underprivileged youth access the
          pay-to-play soccer system.
        </p>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center space-y-2">
          <BarChart2 size={22} className="text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Loading transparency data…</p>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {!isLoading && months.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center space-y-3">
          <BarChart2 size={28} className="text-muted-foreground/50 mx-auto" />
          <p className="font-semibold text-sm">The first report is coming soon</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Monthly breakdowns of operating expenses, donations received, and
            Goal Foundation contributions will appear here. Check back after
            the first full month of tracking.
          </p>
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {!isLoading && months.length > 0 && (
        <div className="space-y-8">
          {/* All-time totals */}
          {totals && (
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "Total Raised",
                  value: `$${dollars(totals.totalDonationsCents)}`,
                  color: "text-green-400",
                  sub: "from Buy Me a Coffee",
                },
                {
                  label: "Operating Costs",
                  value: `$${dollars(totals.totalExpensesCents)}`,
                  color: "text-foreground",
                  sub: "APIs, hosting, Replit",
                },
                {
                  label: "Goal Foundation",
                  value: `$${dollars(totals.totalGoalFoundationCents)}`,
                  color: "text-primary",
                  sub: "donated so far",
                },
              ].map(({ label, value, color, sub }) => (
                <div
                  key={label}
                  className="rounded-xl border border-border bg-card p-4 text-center"
                >
                  <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
                  <p className="text-xs font-semibold mt-1">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Chart (≥2 months) or single-month card */}
          {months.length === 1 ? (
            <SingleMonthCard month={months[0]} />
          ) : (
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">
                Month-by-month breakdown
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barGap={2} barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `$${v}`}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, undefined]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                  <Bar dataKey="Donations" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  <Bar
                    dataKey="Expenses"
                    fill="hsl(var(--muted-foreground))"
                    radius={[3, 3, 0, 0]}
                    opacity={0.6}
                  />
                  <Bar
                    dataKey="Goal Foundation"
                    fill="hsl(var(--primary))"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Sortable month table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Full history — {months.length} month{months.length !== 1 ? "s" : ""}
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="w-32">
                    <SortButton
                      label="Month"
                      sortKey="period"
                      current={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortButton
                      label="Raised"
                      sortKey="donations"
                      current={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortButton
                      label="Expenses"
                      sortKey="expenses"
                      current={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortButton
                      label="Foundation"
                      sortKey="foundation"
                      current={sortKey}
                      dir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="w-24 text-right">Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((m) => {
                  const label = `${MONTH_NAMES[(m.periodMonth - 1) % 12]} ${m.periodYear}`;
                  const net = m.donationsCents - m.expensesCents;
                  return (
                    <TableRow key={m.id} className="border-border hover:bg-muted/30">
                      <TableCell className="font-medium text-sm py-3">
                        <div>{label}</div>
                        {m.notes && (
                          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                            {m.notes}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-green-400">
                        ${dollars(m.donationsCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                        ${dollars(m.expensesCents)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-primary">
                        ${dollars(m.goalFoundationCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.invoiceUrls?.length > 0 ? (
                          <div className="flex flex-col items-end gap-1">
                            {m.invoiceUrls.map((inv, i) => (
                              <a
                                key={i}
                                href={`${API_BASE}/api/transparency/invoice${inv.url.replace(/^\/objects/, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                              >
                                {inv.label}
                                <ExternalLink size={10} />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Net row */}
            {totals && (
              <div className="border-t border-border px-4 py-3 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono uppercase tracking-wider">All-time net</span>
                <span
                  className={`font-mono font-bold text-sm ${
                    totals.totalDonationsCents >= totals.totalExpensesCents
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {totals.totalDonationsCents >= totals.totalExpensesCents ? "+" : "−"}$
                  {dollars(Math.abs(totals.totalDonationsCents - totals.totalExpensesCents))}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
