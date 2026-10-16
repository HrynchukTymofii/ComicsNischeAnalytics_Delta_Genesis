"use client";

import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useMonthRange } from "@/lib/range";
import { useControls } from "@/lib/controls";
import {
  REGION_LABEL, chartBasisNote, chartValue, countryName, fmtAxisUsd, fmtCompact, fmtInt, fmtMoney, fmtPct, fmtUsdSmall, monthLabel, periodLabel,
} from "@/lib/labels";
import type { AppIntel, AppMetrics, ByCountry, CatalogApp, Region, Series } from "@/lib/types";
import { AppIntelSections, type StLatest } from "./AppIntel";
import { MoneyTooltip } from "./ChartTooltip";
import { AppIcon, ChartFrame, ExtLink, Flag, GrowthBadge, Metric, RangeButtons, SERIES, Section, SegmentBadge, StatusBadge } from "./ui";

const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };
const tooltipBox = { background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, fontSize: 12 };
const GRAN_UK: Record<string, string> = { monthly: "місячні", weekly: "тижневі (розподілені по днях)", daily: "денні" };

interface Props {
  app: CatalogApp;
  series: Partial<Record<Region, Series>>;
  metrics: Partial<Record<Region, AppMetrics>>;
  byCountry: ByCountry | null;
  platform: Partial<Record<Region, { yearly: ({ year: number } & Record<string, number | null>)[]; l12m: Record<string, number | null> }>>;
  intel: AppIntel | null;
}

/** Last complete month of the World series, for the "other sources" comparison table. */
function latestWorld(s: Series | undefined): StLatest | null {
  if (!s) return null;
  for (let i = s.months.length - 1; i >= 0; i--)
    if (!s.partial[i] && (s.revenue_net[i] ?? 0) > 0) return { month: s.months[i], revenue_net: s.revenue_net[i]!, downloads: s.downloads[i] ?? 0 };
  return null;
}

export function AppView({ app, series, metrics, byCountry, platform, intel }: Props) {
  const { basis, region } = useControls();
  const [countryPeriod, setCountryPeriod] = useState<"l12m" | "all_time">("l12m");
  const s = series[region];
  const m = metrics[region];
  const ctx = (period: string) => ({ period, region, basis });

  const rows = s ? s.months.map((month, i) => ({
    month, revenue: s.revenue_net[i] ?? 0, downloads: s.downloads[i] ?? 0, granularity: s.granularity[i], partial: s.partial[i],
  })) : [];
  const firstRev = rows.findIndex((r) => r.revenue > 0);
  const all = rows.slice(Math.max(firstRev, 0));
  const range = useMonthRange(all.map((r) => r.month));
  const shown = range.slice(all);
  const fullPeriod = range.label;
  const grans = [...new Set(shown.map((r) => r.granularity))].map((g) => GRAN_UK[g] ?? g).join(", ");
  const arr = m?.arr_10m_within_36m;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start gap-4">
        <AppIcon src={app.icon_path} name={app.display_name} size={72} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-2xl font-semibold">{app.display_name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentBadge segment={app.segment} />
            <StatusBadge status={app.status} />
            {app.shortlist && <span className="rounded bg-grid px-1.5 py-0.5 text-xs text-ink-2">шорт-лист</span>}
          </div>
          <p className="text-sm text-ink-2">
            {[app.developer, app.parent && `група ${app.parent}`, app.ios_category && `iOS: ${app.ios_category}`,
              app.release_date && `реліз iOS ${app.release_date}`].filter(Boolean).join(" · ")}
          </p>
          {app.status_note && <p className="text-sm text-muted">{app.status_note}</p>}
          <p className="space-x-3 text-sm">
            <ExtLink href={app.app_store_url}>App Store</ExtLink>
            <ExtLink href={app.google_play_url}>Google Play</ExtLink>
            <ExtLink href={app.website}>Сайт</ExtLink>
            {app.rating && <span className="text-ink-2">{app.rating.toFixed(1).replace(".", ",")}★ ({fmtInt(app.rating_count)} оцінок, {app.rating_store?.toUpperCase()})</span>}
          </p>
        </div>
      </header>

      {!s || !m ? (
        <p className="text-ink-2">
          {app.has_data ? `Немає даних Sensor Tower для регіону «${REGION_LABEL[region]}».` : "Даних Sensor Tower для цього застосунку немає."}
          {intel ? " Нижче — дані інших джерел." : ""}
        </p>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Виручка L12M" value={fmtMoney(m.l12m.revenue_net, basis)} context={ctx(periodLabel(m.l12m.period))}
              sub={<span className="inline-flex gap-2"><GrowthBadge status={m.status} /> {fmtPct(m.l12m.yoy)} до попередніх 12 міс.</span>} />
            <Metric label="Завантаження L12M · виручка на завантаження" value={`${fmtCompact(m.l12m.downloads)} · ${fmtUsdSmall(m.l12m.rpd, basis)}`}
              context={ctx(periodLabel(m.l12m.period))} sub="RPD = виручка ÷ завантаження" />
            <Metric label={`Останній місяць (${monthLabel(m.mom.month)})`} value={fmtMoney(m.mom.revenue_net, basis)} context={ctx(monthLabel(m.mom.month))}
              sub={`${fmtPct(m.mom.change)} до попереднього місяця`} />
            <Metric label="Пік місячної виручки" value={fmtMoney(m.peak.revenue_net, basis)} context={ctx(m.peak.month ? monthLabel(m.peak.month) : "—")}
              sub={`зараз ${fmtPct(m.peak.drawdown_from_peak)} від піку`} />
            <Metric label="CAGR (повні роки)" value={m.cagr ? fmtPct(m.cagr.value) : "—"} context={ctx(m.cagr ? `${m.cagr.from}–${m.cagr.to}` : "—")}
              sub={m.revenue_from ? `дані про виручку з ${monthLabel(m.revenue_from)}` : undefined} />
            <Metric label="$10M ARR за 36 міс. від запуску?" context={ctx(arr?.launch_month ? `з ${monthLabel(arr.launch_month)}` : "—")}
              value={arr?.reached === true ? `Так, за ${arr.months_to_reach} міс.` : arr?.reached === false ? "Ні" : "Невідомо"}
              sub={arr?.note ?? (arr?.month_reached ? `досягнуто ${monthLabel(arr.month_reached)}` : `${m.months_since_launch ?? "—"} міс. від запуску`)} />
          </section>

          <RangeButtons range={range} />

          <ChartFrame title="Місячна виручка (за кожен місяць, усі країни й платформи)" context={ctx(fullPeriod)} note={`${chartBasisNote(basis)} · джерело: ${grans}`}>
            <div className="h-80">
              <ResponsiveContainer>
                <LineChart data={shown.map((r) => ({ month: r.month, value: chartValue(r.revenue, basis) }))} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
                  <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis} />
                  <Tooltip content={<MoneyTooltip basis={basis} colors={{ value: SERIES[0] }} />} />
                  <Line dataKey="value" name="Виручка" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartFrame>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartFrame title="Місячні завантаження" context={ctx(fullPeriod)} unit="count" note=" · завантаження, шт.">
              <div className="h-60">
                <ResponsiveContainer>
                  <LineChart data={shown} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
                    <YAxis tickFormatter={fmtCompact} width={48} axisLine={false} {...axis} />
                    <Tooltip labelFormatter={monthLabel} formatter={(v: number) => fmtInt(v)} contentStyle={tooltipBox} />
                    <Line dataKey="downloads" name="Завантаження" stroke={SERIES[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>

            <ChartFrame title="Виручка на завантаження (RPD) за місяць" context={ctx(fullPeriod)} note=" · у gross — нижня межа">
              <div className="h-60">
                <ResponsiveContainer>
                  <LineChart data={shown.map((r) => ({ month: r.month, rpd: r.downloads ? chartValue(r.revenue, basis)! / r.downloads : null }))}
                    margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
                    <YAxis tickFormatter={(v: number) => `$${v.toFixed(1)}`} width={48} axisLine={false} {...axis} />
                    <Tooltip labelFormatter={monthLabel} formatter={(v: number) => `$${v.toFixed(2)}`} contentStyle={tooltipBox} />
                    <Line dataKey="rpd" name="RPD" stroke={SERIES[6]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartFrame title="Виручка за роками і зміна до попереднього року" context={ctx(`${m.years[0]?.year}–${m.years.at(-1)?.year}`)}
              note={`${chartBasisNote(basis)} · неповний рік — порівняння тих самих місяців`}>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={m.years.filter((y) => (y.revenue_net ?? 0) > 0).map((y) => ({
                    year: y.partial_year ? `${y.year}*` : String(y.year), value: chartValue(y.revenue_net, basis), yoy: y.yoy == null ? "" : fmtPct(y.yoy),
                  }))} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="year" interval={0} {...axis} />
                    <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis} />
                    <Tooltip content={<MoneyTooltip basis={basis} labelFormat={(l) => l} footer="* неповний рік" colors={{ value: SERIES[0] }} />} cursor={{ fill: "var(--grid)" }} />
                    <Bar dataKey="value" name="Виручка" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      <LabelList dataKey="yoy" position="top" fontSize={11} fill="var(--ink-2)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>

            <ChartFrame title="Платформи: App Store vs Google Play" context={ctx("за роками")} note={chartBasisNote(basis)}>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={(platform[region]?.yearly ?? []).filter((y) => (y.ios ?? 0) + (y.android ?? 0) > 0)
                    .map((y) => ({ year: String(y.year), ios: chartValue(y.ios ?? 0, basis), android: chartValue(y.android ?? 0, basis) }))}
                    margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="year" {...axis} />
                    <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis} />
                    <Tooltip content={<MoneyTooltip basis={basis} labelFormat={(l) => l} colors={{ ios: SERIES[0], android: SERIES[2] }} />} cursor={{ fill: "var(--grid)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="ios" name="App Store" stackId="p" fill={SERIES[0]} isAnimationActive={false} />
                    <Bar dataKey="android" name="Google Play" stackId="p" fill={SERIES[2]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>
          </div>

          <Section title="Топ країн" aside={
            <div className="inline-flex rounded-lg border border-hairline bg-surface p-0.5 text-sm">
              {(["l12m", "all_time"] as const).map((p) => (
                <button key={p} type="button" onClick={() => setCountryPeriod(p)} aria-pressed={countryPeriod === p}
                  className={`rounded-md px-2.5 py-1 ${countryPeriod === p ? "bg-ink text-page" : "text-ink-2"}`}>
                  {p === "l12m" ? "L12M" : "Увесь період"}
                </button>
              ))}
            </div>}>
            {region !== "world" ? (
              <p className="text-sm text-ink-2">Розбивка за країнами показується для регіону «Світ» (у ній видно й США та країни Tier-1).</p>
            ) : byCountry ? (() => {
              const c = byCountry[countryPeriod];
              const cctx = { period: periodLabel(c.period), region: "world" as Region, basis };
              return (
                <div className="grid gap-6 lg:grid-cols-2">
                  <ChartFrame title="Виручка за країнами, топ-20" context={cctx} note={chartBasisNote(basis)}>
                    <div style={{ height: Math.max(200, c.countries.length * 22) }}>
                      <ResponsiveContainer>
                        <BarChart layout="vertical" data={c.countries.map((r) => ({ country: countryName(r.country), value: chartValue(r.revenue_net, basis) }))}
                          margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                          <CartesianGrid stroke="var(--grid)" horizontal={false} />
                          <XAxis type="number" tickFormatter={fmtAxisUsd} {...axis} />
                          <YAxis type="category" dataKey="country" width={120} {...axis} interval={0} fontSize={11} />
                          <Tooltip content={<MoneyTooltip basis={basis} labelFormat={(l) => l} colors={{ value: SERIES[0] }} />} cursor={{ fill: "var(--grid)" }} />
                          <Bar dataKey="value" name="Виручка" fill={SERIES[0]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartFrame>
                  <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
                    <table className="tabular w-full text-sm">
                      <caption className="px-3 pt-3 text-left text-xs text-muted">
                        {periodLabel(c.period)} · Світ (усього {fmtMoney(c.total_revenue_net, basis)}) · {basis === "net" ? "Net" : "Gross, оцінка"} · USD
                      </caption>
                      <thead className="text-left text-ink-2">
                        <tr className="border-b border-hairline">
                          <th className="px-3 py-2 font-medium">Країна</th>
                          <th className="px-3 py-2 text-right font-medium">Виручка</th>
                          <th className="px-3 py-2 text-right font-medium">Частка</th>
                          <th className="px-3 py-2 text-right font-medium">Завантаження</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.countries.map((r) => (
                          <tr key={r.country} className="border-b border-hairline last:border-0">
                            <td className="px-3 py-1.5"><span className="inline-flex items-center gap-2"><Flag code={r.country} />{countryName(r.country)}</span></td>
                            <td className="px-3 py-1.5 text-right">{fmtMoney(r.revenue_net, basis)}</td>
                            <td className="px-3 py-1.5 text-right">{fmtPct(r.share, false)}</td>
                            <td className="px-3 py-1.5 text-right">{fmtCompact(r.downloads)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })() : <p className="text-sm text-ink-2">Немає даних за країнами.</p>}
          </Section>
        </>
      )}

      {intel && <AppIntelSections intel={intel} st={latestWorld(series.world)} />}
    </div>
  );
}
