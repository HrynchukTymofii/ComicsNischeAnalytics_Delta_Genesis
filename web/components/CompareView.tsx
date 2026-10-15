"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { addMonths, appPoints, filterApps, monthsBetween, parseRange, sumRange } from "@/lib/calc";
import { useControls } from "@/lib/controls";
import { chartBasisNote, chartValue, fmtAxisUsd, fmtMoney, monthLabel } from "@/lib/labels";
import type { Basis, Catalog, Metrics, MonthlyByApp, Region } from "@/lib/types";
import { MoneyTooltip } from "./ChartTooltip";
import { ChartFrame, SERIES } from "./ui";

const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };
const MAX_APPS = 6;
const ARR_TARGET = 10_000_000;
type Window = "all" | "60" | "36" | "24" | "12";

export function CompareView({ catalog, monthly, metrics }: { catalog: Catalog; monthly: MonthlyByApp; metrics: Metrics }) {
  const { basis, region, segments } = useControls();
  const [l12From, l12To] = parseRange(monthly.meta.l12m);
  const candidates = useMemo(() => filterApps(catalog.apps, segments, monthly)
    .map((a) => ({ app: a, l12: sumRange(appPoints(monthly, a.slug, region), l12From, l12To) }))
    .sort((a, b) => b.l12 - a.l12), [catalog.apps, monthly, segments, region, l12From, l12To]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = (picked ?? candidates.slice(0, 4).map((c) => c.app.slug)).filter((s) => candidates.some((c) => c.app.slug === s));
  const [mode, setMode] = useState<"abs" | "index">("abs");
  const [win, setWin] = useState<Window>("36");

  const toggle = (slug: string) => {
    const cur = selected;
    if (cur.includes(slug)) setPicked(cur.filter((s) => s !== slug));
    else if (cur.length < MAX_APPS) setPicked([...cur, slug]);
  };
  const name = (slug: string) => catalog.apps.find((a) => a.slug === slug)?.display_name ?? slug;
  const color = (slug: string) => SERIES[selected.indexOf(slug) % SERIES.length];

  const overlay = useMemo(() => {
    const from = win === "all" ? "0000-00" : addMonths(l12To, -(Number(win) - 1));
    const pts = Object.fromEntries(selected.map((s) => [s, new Map(appPoints(monthly, s, region).filter((p) => p.month >= from).map((p) => [p.month, p.revenue]))]));
    const months = [...new Set(Object.values(pts).flatMap((m) => [...m.keys()]))].sort();
    // index base: first month in the window where every selected app has revenue
    const base = months.find((m) => selected.every((s) => (pts[s].get(m) ?? 0) > 0));
    const rows = months.map((m) => {
      const r: Record<string, number | string | null> = { month: m };
      for (const s of selected) {
        const v = pts[s].get(m);
        if (v == null) r[s] = null;
        else if (mode === "abs") r[s] = chartValue(v, basis);
        else r[s] = base && m >= base ? (v / pts[s].get(base)!) * 100 : null;
      }
      return r;
    });
    return { rows, base, period: months.length ? `${monthLabel(months[0])} – ${monthLabel(months.at(-1)!)}` : "" };
  }, [selected, monthly, region, mode, basis, win, l12To]);

  const ctx = (period: string) => ({ period, region, basis });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Порівняння застосунків</h1>
        <p className="text-sm text-ink-2">Оберіть 2–{MAX_APPS} застосунки (впорядковано за виручкою L12M у вибраних сегментах).</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {candidates.map(({ app, l12 }) => {
          const on = selected.includes(app.slug);
          return (
            <button key={app.slug} type="button" onClick={() => toggle(app.slug)} aria-pressed={on}
              disabled={!on && selected.length >= MAX_APPS}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm disabled:opacity-40 ${on ? "border-hairline bg-surface text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
              {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(app.slug) }} aria-hidden />}
              {app.display_name}
              <span className="text-xs text-muted">{fmtMoney(l12, basis)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {([["abs", "Абсолютні значення"], ["index", "Індекс (=100)"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setMode(v)} aria-pressed={mode === v}
            className={`rounded-md border border-hairline px-2.5 py-1 ${mode === v ? "bg-ink text-page" : "bg-surface text-ink-2"}`}>{l}</button>
        ))}
        <span className="mx-1 text-muted">|</span>
        {([["12", "12 міс."], ["24", "24 міс."], ["36", "36 міс."], ["60", "5 років"], ["all", "Увесь період"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setWin(v)} aria-pressed={win === v}
            className={`rounded-md border border-hairline px-2.5 py-1 ${win === v ? "bg-ink text-page" : "bg-surface text-ink-2"}`}>{l}</button>
        ))}
      </div>

      {selected.length < 2 ? <p className="text-ink-2">Оберіть щонайменше два застосунки.</p> : (
        <>
          <ChartFrame title={mode === "abs" ? "Місячна виручка" : `Місячна виручка, індекс (${overlay.base ? monthLabel(overlay.base) : "—"} = 100)`}
            context={ctx(overlay.period)} note={mode === "abs" ? chartBasisNote(basis) : " · індекс однаковий для net і gross"}>
            <div className="h-80">
              <ResponsiveContainer>
                <LineChart data={overlay.rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={40} {...axis} />
                  <YAxis tickFormatter={mode === "abs" ? fmtAxisUsd : (v: number) => String(Math.round(v))} width={64} axisLine={false} {...axis} />
                  {mode === "abs"
                    ? <Tooltip content={<MoneyTooltip basis={basis} colors={Object.fromEntries(selected.map((x) => [x, color(x)]))} showTotal={false} />} />
                    : <Tooltip labelFormatter={monthLabel} formatter={(v: number) => v.toFixed(0)} contentStyle={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, fontSize: 12 }} />}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {mode === "index" && <ReferenceLine y={100} stroke="var(--axis)" strokeDasharray="4 4" />}
                  {selected.map((s) => (
                    <Line key={s} dataKey={s} name={name(s)} stroke={color(s)} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartFrame>


        </>
      )}

      <ArrRace candidates={candidates.map((c) => ({ slug: c.app.slug, l12: c.l12 }))} metrics={metrics} monthly={monthly}
        region={region} basis={basis} name={name} />
    </div>
  );
}

const ARR_MONTHS = 36;

/** 0 → $10M ARR in the first 36 months after launch, for apps whose data covers (most of) that window. */
function ArrRace({ candidates, metrics, monthly, region, basis, name }: {
  candidates: { slug: string; l12: number }[]; metrics: Metrics; monthly: MonthlyByApp;
  region: Region; basis: Basis; name: (slug: string) => string;
}) {
  const info = candidates.map(({ slug, l12 }) => {
    const m = metrics.apps[slug]?.[region];
    const launch = m?.launch_month ?? null;
    const dataFrom = m?.revenue_from ?? m?.data_start ?? null;
    const firstK = launch && dataFrom ? Math.max(0, monthsBetween(launch, dataFrom)) : null;
    // full: data from launch (≤2 months gap) · partial: only the end of the first 36 months · none: launched before the data
    const kind: "full" | "partial" | "none" = firstK == null || firstK >= ARR_MONTHS ? "none" : firstK <= 2 ? "full" : "partial";
    return { slug, l12, launch, basis: m?.launch_basis, firstK, kind, milestone: m?.arr_10m_within_36m };
  });
  const [picked, setPicked] = useState<string[] | null>(null);
  const defaults = info.filter((i) => i.kind === "full").sort((a, b) => b.l12 - a.l12).slice(0, MAX_APPS).map((i) => i.slug);
  const sel = (picked ?? defaults).filter((s) => info.some((i) => i.slug === s && i.kind !== "none"));
  const color = (slug: string) => SERIES[sel.indexOf(slug) % SERIES.length];
  const toggle = (slug: string) =>
    setPicked(sel.includes(slug) ? sel.filter((s) => s !== slug) : sel.length < MAX_APPS ? [...sel, slug] : sel);

  const rows = Array.from({ length: ARR_MONTHS + 1 }, (_, k) => {
    const r: Record<string, number | null> = { k };
    for (const slug of sel) {
      const launch = info.find((i) => i.slug === slug)!.launch!;
      const p = appPoints(monthly, slug, region).find((x) => monthsBetween(launch, x.month) === k);
      r[slug] = p ? chartValue(p.revenue * 12, basis) : null;
    }
    return r;
  });
  const chip = (i: (typeof info)[number]) => {
    const on = sel.includes(i.slug);
    return (
      <button key={i.slug} type="button" onClick={() => toggle(i.slug)} aria-pressed={on} disabled={!on && sel.length >= MAX_APPS}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm disabled:opacity-40 ${on ? "border-hairline bg-surface text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
        {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(i.slug) }} aria-hidden />}
        {name(i.slug)}
        <span className="text-xs text-muted">{i.launch ? monthLabel(i.launch) : ""}{i.kind === "partial" ? ` · видно з ${i.firstK}-го міс.` : ""}</span>
      </button>
    );
  };
  const none = info.filter((i) => i.kind === "none");

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Від 0 до $10M ARR за 3 роки</h2>
      <p className="text-sm text-ink-2">
        Лише застосунки, для яких є дані за перші {ARR_MONTHS} міс. після запуску (запуск = реліз iOS, або перший місяць із виручкою).
        Дані Sensor Tower починаються з 2019 року, тож застосунки, запущені раніше, тут показати не можна.
      </p>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">Дані від запуску:</span>
          {info.filter((i) => i.kind === "full").map(chip)}
        </div>
        {info.some((i) => i.kind === "partial") && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">Лише кінець перших 3 років:</span>
            {info.filter((i) => i.kind === "partial").map(chip)}
          </div>
        )}
      </div>
      {sel.length === 0 ? <p className="text-ink-2">Оберіть застосунок вище.</p> : (
        <ChartFrame title="ARR (місячна виручка × 12) за перші 36 місяців від запуску" context={{ period: "0–36 міс. від запуску", region, basis }}
          note={chartBasisNote(basis)}>
          <div className="h-96">
            <ResponsiveContainer>
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="k" type="number" domain={[0, ARR_MONTHS]} ticks={[0, 6, 12, 18, 24, 30, 36]} {...axis}
                  label={{ value: "місяців від запуску", position: "insideBottom", offset: -8, fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickFormatter={fmtAxisUsd} width={64} axisLine={false} {...axis} />
                <Tooltip content={<MoneyTooltip basis={basis} labelFormat={(k) => `місяць ${k} від запуску`} footer="ARR = місячна виручка × 12"
                  colors={Object.fromEntries(sel.map((x) => [x, color(x)]))} showTotal={false} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={chartValue(ARR_TARGET, basis) ?? ARR_TARGET} stroke="var(--critical)" strokeDasharray="4 4"
                  label={{ value: "$10M ARR", position: "insideTopLeft", fill: "var(--ink-2)", fontSize: 11 }} />
                {sel.map((s) => (
                  <Line key={s} dataKey={s} name={name(s)} stroke={color(s)} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-0.5 text-xs text-ink-2">
            {sel.map((slug) => {
              const i = info.find((x) => x.slug === slug)!;
              const ms = i.milestone;
              return (
                <li key={slug}>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: color(slug) }} aria-hidden />
                  {name(slug)}: запуск {i.launch ? monthLabel(i.launch) : "—"}{i.basis === "first_revenue_month" ? " (перший місяць із виручкою)" : ""}
                  {" — "}{ms?.reached === true ? `$10M ARR за ${ms.months_to_reach} міс.` : ms?.reached === false ? "не досягнув $10M ARR за 36 міс." : ms?.note ?? "невідомо"}
                </li>
              );
            })}
          </ul>
        </ChartFrame>
      )}
      {none.length > 0 && (
        <p className="text-xs text-muted">
          Запущені до початку даних (перших 36 міс. немає): {none.map((i) => `${name(i.slug)}${i.launch ? ` (${i.launch.slice(0, 4)})` : ""}`).join(", ")}.
        </p>
      )}
    </section>
  );
}
