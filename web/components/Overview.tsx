"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { addMonths, appPoints, concentration, filterApps, parseRange, sumRange, yearlyTotals } from "@/lib/calc";
import { useControls } from "@/lib/controls";
import {
  SEGMENT_LABEL, SEGMENT_ORDER, chartBasisNote, metricLabel, chartValue, fmtAxisUsd, fmtMoney, fmtPct, monthLabel, periodLabel,
} from "@/lib/labels";
import { useMonthRange } from "@/lib/range";
import type { Catalog, CountryByApp, MonthlyByApp, Segment } from "@/lib/types";
import { CountryMarket } from "./CountryMarket";
import { MoneyTooltip } from "./ChartTooltip";
import { AppIcon, ChartFrame, Metric, OTHER, RangeButtons, SERIES, Section, segmentColor } from "./ui";

const TOP_N = 8;
const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };
type Mode = "lines" | "stacked";

function Switch<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-hairline bg-surface p-0.5 text-xs">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={`rounded-md px-2 py-1 ${value === o.value ? "bg-ink text-page" : "text-ink-2 hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Overview({ catalog, monthly, countries }: { catalog: Catalog; monthly: MonthlyByApp; countries: CountryByApp | null }) {
  const { basis, region, segments } = useControls();
  const [mode, setMode] = useState<Mode>("lines");
  const [l12From, l12To] = parseRange(monthly.meta.l12m);
  const prevFrom = addMonths(l12From, -12);
  const prevTo = addMonths(l12To, -12);
  const ctx = (period: string) => ({ period, region, basis });

  const d = useMemo(() => {
    const apps = filterApps(catalog.apps, segments, monthly);
    const pts = new Map(apps.map((a) => [a.slug, appPoints(monthly, a.slug, region)]));
    const l12 = apps.map((a) => ({ slug: a.slug, revenue: sumRange(pts.get(a.slug)!, l12From, l12To) }));
    const prev = apps.map((a) => sumRange(pts.get(a.slug)!, prevFrom, prevTo)).reduce((s, v) => s + v, 0);
    const conc = concentration(l12);
    const top = [...l12].sort((a, b) => b.revenue - a.revenue).filter((x) => x.revenue > 0).slice(0, TOP_N).map((x) => x.slug);
    const topSet = new Set(top);

    const months = [...new Set([...pts.values()].flatMap((p) => p.map((x) => x.month)))].sort();
    const byMonth = months.map((m) => {
      // `apps` = revenue of every app in the top N (null where the app has no data that month)
      const row: Record<string, number | string | null> = { month: m, __other: 0 };
      const seg: Record<string, number | string> = { month: m };
      let total = 0;
      for (const a of apps) {
        const p = pts.get(a.slug)!.find((x) => x.month === m);
        if (!p) continue;
        total += p.revenue;
        if (topSet.has(a.slug)) row[a.slug] = p.revenue;
        else row.__other = (row.__other as number) + p.revenue;
        seg[a.segment!] = ((seg[a.segment!] as number) ?? 0) + p.revenue;
      }
      return { row, seg, total };
    });
    const firstIdx = byMonth.findIndex((x) => x.total > 0);
    const visible = byMonth.slice(Math.max(firstIdx, 0));

    const years = yearlyTotals([...pts.values()]);
    const concByYear = years.map((y) => {
      const c = concentration(apps.map((a) => ({
        slug: a.slug, revenue: pts.get(a.slug)!.filter((p) => p.month.startsWith(String(y.year))).reduce((s, p) => s + p.revenue, 0),
      })));
      return { year: y.year, top1: c.top1, top2: c.top2, top5: c.top5, apps: c.apps };
    }).filter((c) => c.apps >= 3);

    return { apps, l12, prev, conc, top, visible, years, concByYear };
  }, [catalog.apps, monthly, segments, region, l12From, l12To, prevFrom, prevTo]);

  const range = useMonthRange(d.visible.map((x) => x.row.month as string));

  const name = (slug: string) => catalog.apps.find((a) => a.slug === slug)?.display_name ?? slug;
  const total = d.conc.total;
  const yoy = d.prev > 0 ? total / d.prev - 1 : null;
  const l12Label = periodLabel(monthly.meta.l12m);
  const top5 = [...d.l12].sort((a, b) => b.revenue - a.revenue).filter((x) => x.revenue > 0).slice(0, 5);
  const segsShown = SEGMENT_ORDER.filter((s) => segments.includes(s) && d.apps.some((a) => a.segment === s));
  const series = [...d.top.map((slug, i) => ({ key: slug, label: name(slug), color: SERIES[i] })),
    ...(mode === "stacked" && d.apps.length > d.top.length ? [{ key: "__other", label: "Інші", color: OTHER }] : [])];
  const appColors = Object.fromEntries(series.map((s) => [s.key, s.color]));
  const segColors = Object.fromEntries(segsShown.map((s) => [s, segmentColor(s)]));

  const appRows = range.slice(d.visible).map((x) => Object.fromEntries(Object.entries(x.row).map(([k, v]) => [
    k, typeof v === "number" ? chartValue(v, basis) : v,
  ])));
  const segRows = range.slice(d.visible).map((x) => ({
    month: x.seg.month, ...Object.fromEntries(segsShown.map((s) => [s, chartValue((x.seg[s] as number) ?? 0, basis)])),
  }));

  if (!d.apps.length) return <p className="text-ink-2">У вибраних сегментах немає застосунків із даними.</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Огляд ринку</h1>
        <p className="text-sm text-ink-2">
          Sensor Tower, {d.apps.length} застосунків у вибраних сегментах. «Світ» = сума країн в експорті (до 112).
          {!segments.includes("short_drama") && " Відео-формати (short drama, AI comic drama) не враховано."}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Виручка датасету, L12M" value={fmtMoney(total, basis)} context={ctx(l12Label)} />
        <Metric label="Зміна до попередніх 12 міс." value={fmtPct(yoy)} context={ctx(`${l12Label} vs ${periodLabel(`${prevFrom}..${prevTo}`)}`)}
          sub={d.prev ? `було ${fmtMoney(d.prev, basis)}` : undefined} />
        <Metric label="Застосунків із виручкою" value={String(d.conc.apps)} context={ctx(l12Label)}
          sub={`з ${d.apps.length} у вибраних сегментах`} />
        <Metric label="Лідер" value={d.conc.leader ? name(d.conc.leader) : "—"} context={ctx(l12Label)}
          sub={d.conc.leader ? `${fmtMoney(d.l12.find((x) => x.slug === d.conc.leader)?.revenue, basis)} · ${fmtPct(d.conc.top1, false)} датасету` : undefined} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <RangeButtons range={range} />
        <Switch label="Вигляд графіка" value={mode} onChange={setMode}
          options={[{ value: "lines", label: "Окремі лінії" }, { value: "stacked", label: "Накопичено (сума)" }]} />
      </div>

      <ChartFrame
        title={mode === "lines"
          ? `Місячна виручка кожного застосунку: топ-${d.top.length}`
          : `Загальна місячна виручка: топ-${d.top.length} застосунків + інші (смуги складаються)`}
        context={ctx(range.label)}
        note={`${chartBasisNote(basis)} · виручка за кожен місяць, сума всіх країн і платформ · топ за L12M`}>
        <div className="h-[672px]">
          <ResponsiveContainer>
            {mode === "lines" ? (
              <LineChart data={appRows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
                <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis}
                  domain={[0, "auto"]} />
                <Tooltip content={<MoneyTooltip basis={basis} colors={appColors} showTotal={false} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.map((s) => (
                  <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false}
                    connectNulls={false} isAnimationActive={false} />
                ))}
              </LineChart>
            ) : (
              <AreaChart data={appRows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
                <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis} />
                <Tooltip content={<MoneyTooltip basis={basis} colors={appColors} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {series.map((s) => (
                  <Area key={s.key} dataKey={s.key} name={s.label} stackId="1" type="monotone"
                    stroke={s.color} strokeWidth={1} fill={s.color} fillOpacity={0.85} isAnimationActive={false} />
                ))}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted">
          {mode === "stacked" && "У режимі «Накопичено» кожна смуга лежить на попередніх, тому форма смуги повторює загальну суму — для динаміки окремого застосунку використовуйте «Окремі лінії»."}
        </p>
      </ChartFrame>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame title="Виручка за роками, зі зміною до попереднього року" context={ctx(`${d.years[0]?.year ?? ""}–${d.years.at(-1)?.year ?? ""}`)}
          note={`${chartBasisNote(basis)} · неповний рік порівнюється з тими ж місяцями · застосунки входять у датасет у різні роки, тож ріст частково — розширення вибірки`}>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={d.years.filter((y) => y.revenue > 0.01 * Math.max(...d.years.map((x) => x.revenue))).map((y) => ({
                year: y.months < 12 ? `${y.year} (до ${monthLabel(y.lastMonth).split(" ")[0]})` : String(y.year),
                value: chartValue(y.revenue, basis), yoy: y.yoy == null ? "" : fmtPct(y.yoy),
              }))} margin={{ top: 20, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="year" {...axis} interval={0} fontSize={11} />
                <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis} />
                <Tooltip content={<MoneyTooltip basis={basis} labelFormat={(l) => l} colors={{ value: SERIES[0] }} />} cursor={{ fill: "var(--grid)" }} />
                <Bar dataKey="value" name="Виручка" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="yoy" position="top" fontSize={11} fill="var(--ink-2)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <ChartFrame title="Виручка за сегментами (смуги складаються)" context={ctx(range.label)} note={chartBasisNote(basis)}>
          <div className="h-72">
            <ResponsiveContainer>
              <AreaChart data={segRows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
                <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis} />
                <Tooltip content={<MoneyTooltip basis={basis} colors={segColors} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {segsShown.map((s: Segment) => (
                  <Area key={s} dataKey={s} name={SEGMENT_LABEL[s]} stackId="1" type="monotone"
                    stroke={segmentColor(s)} strokeWidth={1} fill={segmentColor(s)} fillOpacity={0.85} isAnimationActive={false} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>
      </div>

      <Section title="Концентрація ринку">
        <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
        <ChartFrame title="Частка №1, топ-2 і топ-5 застосунків у виручці року" context={ctx(`${d.concByYear[0]?.year ?? ""}–${d.concByYear.at(-1)?.year ?? ""}`)}
          unit="count" note=" · частка виручки року (однакова для net і gross) · роки з ≥3 застосунками">
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={d.concByYear} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="year" {...axis} />
                <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={48} axisLine={false} {...axis} />
                <Tooltip formatter={(v: number) => fmtPct(v, false)} contentStyle={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="top1" name="№1" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line dataKey="top2" name="Топ-2" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                <Line dataKey="top5" name="Топ-5" stroke={SERIES[2]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>
        </div>
        <div className="rounded-lg border border-hairline bg-surface p-4">
          <div className="font-medium text-ink">Топ-5 застосунків</div>
          <div className="mb-3 text-xs text-muted">{metricLabel(ctx(l12Label))} · частка = від виручки вибраних сегментів</div>
          <ol className="space-y-3">
            {top5.map((t, i) => {
              const app = catalog.apps.find((a) => a.slug === t.slug);
              const share = total ? t.revenue / total : 0;
              return (
                <li key={t.slug}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-4 text-right text-muted tabular">{i + 1}</span>
                    <AppIcon src={app?.icon_path ?? null} name={name(t.slug)} size={24} />
                    <Link href={`/apps/${t.slug}/`} className="min-w-0 flex-1 truncate text-ink hover:underline">{name(t.slug)}</Link>
                    <span className="tabular text-ink">{fmtMoney(t.revenue, basis)}</span>
                  </div>
                  <div className="ml-[3.25rem] mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-grid">
                      <div className="h-1.5 rounded-full" style={{ width: `${share * 100}%`, background: SERIES[0] }} />
                    </div>
                    <span className="w-24 text-right text-xs text-ink-2 tabular">
                      {fmtPct(share, false)} · Σ {fmtPct(top5.slice(0, i + 1).reduce((s2, x) => s2 + x.revenue, 0) / (total || 1), false)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-muted">Σ — накопичена частка (№1, топ-2 … топ-5).</p>
        </div>
        </div>
        <p className="text-sm text-ink-2">
          L12M ({l12Label}): №1 — {d.conc.leader ? name(d.conc.leader) : "—"} ({fmtPct(d.conc.top1, false)}), топ-2 — {fmtPct(d.conc.top2, false)},
          топ-5 — {fmtPct(d.conc.top5, false)} виручки вибраних сегментів.
        </p>
      </Section>

      {countries && (
        <CountryMarket apps={d.apps} data={countries} basis={basis}
          tier1={new Set(monthly.meta.region_countries?.tier1 ?? [])} />
      )}
    </div>
  );
}
