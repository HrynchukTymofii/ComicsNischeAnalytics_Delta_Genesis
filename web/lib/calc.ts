// Client-side aggregation over monthly_by_app.json for the current filters.
// Revenue here is always NET; convert for display with fmtMoney/chartValue.
import type { CatalogApp, MonthlyByApp, Region, Segment } from "./types";

export interface MonthPoint {
  month: string;
  revenue: number;
  downloads: number;
  partial: boolean;
}

export function appPoints(monthly: MonthlyByApp, slug: string, region: Region): MonthPoint[] {
  const s = monthly.apps[slug]?.[region];
  if (!s) return [];
  return s.months.map((m, i) => ({
    month: m,
    revenue: s.revenue_net[i] ?? 0,
    downloads: s.downloads[i] ?? 0,
    partial: s.partial[i],
  }));
}

export function parseRange(range: string): [string, string] {
  const [a, b] = range.split("..");
  return [a, b ?? a];
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** Apps in the selected segments that have monthly series (US-snapshot-only apps are excluded). */
export function filterApps(apps: CatalogApp[], segments: Segment[], monthly?: MonthlyByApp): CatalogApp[] {
  return apps.filter((a) => a.has_data && a.segment && segments.includes(a.segment) && (!monthly || a.slug in monthly.apps));
}

/** Sum of revenue for an app over [from, to] inclusive (YYYY-MM strings compare lexically). */
export function sumRange(points: MonthPoint[], from: string, to: string, key: "revenue" | "downloads" = "revenue"): number {
  return points.filter((p) => p.month >= from && p.month <= to).reduce((s, p) => s + p[key], 0);
}

export interface YearTotal {
  year: number;
  revenue: number;
  months: number; // months of the year present in the data (max over apps)
  lastMonth: string;
  yoy: number | null; // like-for-like (same months) when the year is partial
}

export function yearlyTotals(series: MonthPoint[][]): YearTotal[] {
  const byMonth = new Map<string, number>();
  for (const pts of series) for (const p of pts) byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + p.revenue);
  const years = new Map<number, { revenue: number; months: string[] }>();
  for (const [m, v] of byMonth) {
    const y = Number(m.slice(0, 4));
    const e = years.get(y) ?? { revenue: 0, months: [] };
    e.revenue += v;
    e.months.push(m);
    years.set(y, e);
  }
  const out: YearTotal[] = [];
  for (const [y, e] of [...years].sort((a, b) => a[0] - b[0])) {
    const months = e.months.sort();
    const mm = new Set(months.map((m) => m.slice(5)));
    const prev = [...byMonth].filter(([m]) => Number(m.slice(0, 4)) === y - 1 && mm.has(m.slice(5)));
    const prevSum = prev.reduce((s, [, v]) => s + v, 0);
    out.push({
      year: y,
      revenue: e.revenue,
      months: months.length,
      lastMonth: months.at(-1)!,
      // a tiny base year (e.g. the first months of an app's revenue data) gives meaningless +10 000%
      yoy: prev.length === months.length && prevSum > 0.05 * e.revenue ? e.revenue / prevSum - 1 : null,
    });
  }
  return out;
}

/** Shares of #1, top 2 and top 5 apps in a set of per-app totals. */
export function concentration(totals: { slug: string; revenue: number }[]) {
  const sorted = [...totals].filter((t) => t.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((s, t) => s + t.revenue, 0);
  const share = (n: number) => (total ? sorted.slice(0, n).reduce((s, t) => s + t.revenue, 0) / total : null);
  return { total, leader: sorted[0]?.slug ?? null, top1: share(1), top2: share(2), top5: share(5), apps: sorted.length };
}
