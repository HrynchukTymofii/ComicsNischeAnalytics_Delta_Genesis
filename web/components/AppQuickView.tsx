"use client";

import Link from "next/link";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  REGION_LABEL, chartBasisNote, chartValue, fmtAxisUsd, fmtCompact, fmtInt, fmtMoney, fmtPct, fmtUsdSmall, metricLabel, monthLabel, periodLabel,
} from "@/lib/labels";
import { useMonthRange } from "@/lib/range";
import type { AppMetrics, Basis, CatalogApp, Region, Series } from "@/lib/types";
import { MoneyTooltip } from "./ChartTooltip";
import { GrowthBadge, RangeButtons, SERIES } from "./ui";

const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false };

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 last:border-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right">
        <span className="font-medium text-ink">{value}</span>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </dd>
    </div>
  );
}

/** Expanded catalog row: one app's own monthly curve + key figures, in the current region/basis. */
export function AppQuickView({ app, series, metrics, region, basis }: {
  app: CatalogApp; series: Series | undefined; metrics: AppMetrics | undefined; region: Region; basis: Basis;
}) {
  const [metric, setMetric] = useState<"revenue" | "downloads">("revenue");
  const rows = series ? series.months.map((m, i) => ({
    month: m, revenue: series.revenue_net[i] ?? 0, downloads: series.downloads[i] ?? 0, partial: series.partial[i],
  })) : [];
  const first = rows.findIndex((r) => (metric === "revenue" ? r.revenue : r.downloads) > 0);
  const all = rows.slice(Math.max(first, 0));
  const range = useMonthRange(all.map((r) => r.month));

  if (!series || !metrics) {
    return (
      <p className="text-sm text-ink-2">
        Немає місячних даних Sensor Tower для регіону «{REGION_LABEL[region]}»
        {app.data_coverage.some((c) => c.regions === "US") ? " (є лише денний знімок США за вересень 2026 — див. сторінку «США, вересень 2026»)" : ""}.
      </p>
    );
  }

  const m = metrics;
  const arr = m.arr_10m_within_36m;
  const data = range.slice(all).map((r) => ({ month: r.month, value: metric === "revenue" ? chartValue(r.revenue, basis) : r.downloads }));
  const ctx = { period: range.label, region, basis };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Показник" className="inline-flex rounded-lg border border-hairline bg-page p-0.5 text-xs">
            {([["revenue", "Виручка"], ["downloads", "Завантаження"]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setMetric(v)} aria-pressed={metric === v}
                className={`rounded-md px-2 py-1 ${metric === v ? "bg-ink text-page" : "text-ink-2"}`}>{l}</button>
            ))}
          </div>
          <RangeButtons range={range} />
        </div>
        <div className="text-xs text-muted">
          {metric === "revenue"
            ? `Місячна виручка · ${metricLabel(ctx)}${chartBasisNote(basis)}`
            : `Місячні завантаження · ${range.label} · ${REGION_LABEL[region]}`}
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
              <YAxis tickFormatter={metric === "revenue" ? fmtAxisUsd : fmtCompact} width={56} axisLine={false} {...axis} />
              {metric === "revenue"
                ? <Tooltip content={<MoneyTooltip basis={basis} colors={{ value: SERIES[0] }} />} />
                : <Tooltip labelFormatter={monthLabel} formatter={(v: number) => [fmtInt(v), "Завантаження"]}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, fontSize: 12 }} />}
              <Line dataKey="value" name={metric === "revenue" ? "Виручка" : "Завантаження"}
                stroke={metric === "revenue" ? SERIES[0] : SERIES[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="text-sm">
        <div className="mb-1 text-xs text-muted">
          {REGION_LABEL[region]} · {basis === "net" ? "Net" : "Gross, оцінка"} · USD
        </div>
        <dl>
          <Row label={`Виручка L12M`} value={fmtMoney(m.l12m.revenue_net, basis)} sub={periodLabel(m.l12m.period)} />
          <Row label="До попередніх 12 міс." value={<span className="inline-flex items-center gap-2">{fmtPct(m.l12m.yoy)} <GrowthBadge status={m.status} /></span>} />
          <Row label={`Останній місяць`} value={fmtMoney(m.mom.revenue_net, basis)} sub={`${monthLabel(m.mom.month)} · ${fmtPct(m.mom.change)} м/м`} />
          <Row label="Пік" value={fmtMoney(m.peak.revenue_net, basis)}
            sub={`${m.peak.month ? monthLabel(m.peak.month) : "—"} · зараз ${fmtPct(m.peak.drawdown_from_peak)} від піку`} />
          <Row label="CAGR (повні роки)" value={m.cagr ? fmtPct(m.cagr.value) : "—"} sub={m.cagr ? `${m.cagr.from}–${m.cagr.to}` : undefined} />
          <Row label="Завантаження L12M" value={fmtCompact(m.l12m.downloads)} sub={`RPD ${fmtUsdSmall(m.l12m.rpd, basis)}`} />
          <Row label="$10M ARR за 36 міс.?"
            value={arr.reached === true ? `так, за ${arr.months_to_reach} міс.` : arr.reached === false ? "ні" : "невідомо"}
            sub={arr.note ?? undefined} />
          <Row label="Дані" value={`${monthLabel(m.data_start)} – ${monthLabel(m.data_end)}`}
            sub={m.revenue_from && m.revenue_from !== m.data_start ? `виручка з ${monthLabel(m.revenue_from)}` : undefined} />
        </dl>
        <Link href={`/apps/${app.slug}/`} className="mt-3 inline-block text-accent hover:underline">
          Відкрити сторінку застосунку →
        </Link>
      </div>
    </div>
  );
}
