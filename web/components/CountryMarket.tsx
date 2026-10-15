"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartBasisNote, chartValue, countryName, fmtAxisUsd, fmtCompact, fmtMoney, fmtPct, periodLabel } from "@/lib/labels";
import type { Basis, CatalogApp, CountryByApp } from "@/lib/types";
import { MoneyTooltip } from "./ChartTooltip";
import { ChartFrame, Flag, SERIES, Section } from "./ui";

const TOP = 20;
const CHART_TOP = 15;
const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };

/** Revenue of the selected apps by country (always worldwide: this section *is* the country breakdown). */
export function CountryMarket({ apps, data, basis, tier1 }: {
  apps: CatalogApp[]; data: CountryByApp; basis: Basis; tier1: Set<string>;
}) {
  const [period, setPeriod] = useState<"l12m" | "all">("l12m");
  const name = (slug: string) => apps.find((a) => a.slug === slug)?.display_name ?? slug;

  const rows = useMemo(() => {
    const by = new Map<string, { rev: number; prev: number; dl: number; apps: { slug: string; rev: number }[] }>();
    for (const a of apps) {
      for (const [code, [l12, prev, all, dl]] of Object.entries(data.apps[a.slug] ?? {})) {
        const rev = (period === "l12m" ? l12 : all) ?? 0;
        const e = by.get(code) ?? { rev: 0, prev: 0, dl: 0, apps: [] };
        e.rev += rev;
        e.prev += prev ?? 0;
        e.dl += dl ?? 0;
        if (rev > 0) e.apps.push({ slug: a.slug, rev });
        by.set(code, e);
      }
    }
    const total = [...by.values()].reduce((s, e) => s + e.rev, 0);
    const list = [...by.entries()].filter(([, e]) => e.rev > 0).sort((a, b) => b[1].rev - a[1].rev).map(([code, e]) => {
      const lead = e.apps.sort((x, y) => y.rev - x.rev)[0];
      return {
        code, rev: e.rev, share: total ? e.rev / total : 0, dl: e.dl,
        yoy: period === "l12m" && e.prev > 0 ? e.rev / e.prev - 1 : null,
        lead: lead?.slug ?? null, leadShare: lead && e.rev ? lead.rev / e.rev : null,
      };
    });
    return { total, list, countries: list.length };
  }, [apps, data, period]);

  const top = rows.list.slice(0, TOP);
  const topShare = top.reduce((s, r) => s + r.share, 0);
  const periodText = period === "l12m" ? periodLabel(data.meta.l12m) : `увесь період до ${periodLabel(data.meta.period_end)}`;
  const ctx = { period: periodText, region: "world" as const, basis };
  const chartRows = top.slice(0, CHART_TOP).map((r) => ({ code: r.code, value: chartValue(r.rev, basis) }));

  return (
    <Section title="Виручка за країнами" aside={
      <div role="group" aria-label="Період" className="inline-flex rounded-lg border border-hairline bg-surface p-0.5 text-xs">
        {([["l12m", "L12M"], ["all", "Увесь період"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setPeriod(v)} aria-pressed={period === v}
            className={`rounded-md px-2 py-1 ${period === v ? "bg-ink text-page" : "text-ink-2 hover:text-ink"}`}>{l}</button>
        ))}
      </div>}>
      <p className="text-sm text-ink-2">
        Застосунки з вибраних сегментів, {rows.countries} країн із виручкою. Топ-{TOP} країн дають {fmtPct(topShare, false)} виручки.
        Розбивка завжди по всьому світу; позначка <span className="rounded bg-grid px-1 text-[10px] text-ink-2">T1</span> — країни Tier-1.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartFrame title={`Топ-${CHART_TOP} країн за виручкою`} context={ctx} note={chartBasisNote(basis)}>
          <div style={{ height: chartRows.length * 30 + 30 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={chartRows} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--grid)" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtAxisUsd} {...axis} />
                <YAxis type="category" dataKey="code" width={150} interval={0} axisLine={false} tickLine={false}
                  tick={({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => (
                    <g transform={`translate(${x},${y})`}>
                      <image href={`/flags/${payload.value.toLowerCase()}.svg`} x={-146} y={-6} width={16} height={12} />
                      <text x={-124} dy={4} fill="var(--ink-2)" fontSize={12}>{countryName(payload.value).slice(0, 18)}</text>
                    </g>
                  )} />
                <Tooltip content={<MoneyTooltip basis={basis} labelFormat={(c) => countryName(c)} colors={{ value: SERIES[0] }} />}
                  cursor={{ fill: "var(--grid)" }} />
                <Bar dataKey="value" name="Виручка" fill={SERIES[0]} radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>

        <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
          <table className="tabular w-full min-w-[520px] text-sm">
            <caption className="px-3 pt-3 text-left text-xs text-muted">
              {periodText} · за країнами · {basis === "net" ? "Net (після комісії сторів)" : "Gross, оцінка"} · USD
              {period === "l12m" && ` · зміна до ${periodLabel(data.meta.prev12)}`}
            </caption>
            <thead className="text-left text-ink-2">
              <tr className="border-b border-hairline">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Країна</th>
                <th className="px-3 py-2 text-right font-medium">Виручка</th>
                <th className="px-3 py-2 text-right font-medium">Частка</th>
                {period === "l12m" && <th className="px-3 py-2 text-right font-medium">До попер. 12 міс.</th>}
                <th className="px-3 py-2 font-medium">Лідер у країні</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.code} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <Flag code={r.code} />
                      {countryName(r.code)}
                      {tier1.has(r.code) && <span className="rounded bg-grid px-1 text-[10px] text-ink-2">T1</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">{fmtMoney(r.rev, basis)}</td>
                  <td className="px-3 py-1.5 text-right">{fmtPct(r.share, false)}</td>
                  {period === "l12m" && <td className="px-3 py-1.5 text-right">{fmtPct(r.yoy)}</td>}
                  <td className="px-3 py-1.5 text-ink-2">
                    {r.lead ? <>{name(r.lead)} <span className="text-xs text-muted">{fmtPct(r.leadShare, false)}</span></> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 pb-3 pt-1 text-xs text-muted">Завантаження L12M у топ-{TOP} країнах: {fmtCompact(top.reduce((s, r) => s + r.dl, 0))}.</p>
        </div>
      </div>
    </Section>
  );
}
