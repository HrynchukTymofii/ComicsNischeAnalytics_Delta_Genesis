"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useControls } from "@/lib/controls";
import { chartBasisNote, chartValue, fmtAxisUsd, fmtCompact, fmtMoney, fmtPct } from "@/lib/labels";
import type { Catalog, UsSnapshot } from "@/lib/types";
import { MoneyTooltip } from "./ChartTooltip";
import { AppIcon, ChartFrame, SegmentBadge, segmentColor } from "./ui";

const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };

export function UsSnapshotView({ catalog, snapshot }: { catalog: Catalog; snapshot: UsSnapshot | null }) {
  const { basis, segments } = useControls();
  if (!snapshot) return <p className="text-ink-2">Немає даних знімка США.</p>;
  const app = (slug: string) => catalog.apps.find((a) => a.slug === slug);
  const rows = snapshot.apps.filter((a) => !a.segment || segments.includes(a.segment));
  const [start, end] = snapshot.meta.period.split("..");
  const period = `${start.slice(8)}–${end.slice(8)}.${end.slice(5, 7)}.${end.slice(0, 4)}`;
  // Region is fixed to the US on this page, whatever the global toggle says.
  const ctx = { period: `run-rate з ${period} (${rows[0]?.days ?? 18} дн. × 365/18)`, region: "us" as const, basis };
  const total = rows.reduce((s, r) => s + (r.run_rate_revenue_net ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">США, вересень 2026</h1>
        <p className="text-sm text-ink-2">
          Денні дані Sensor Tower по США за {period}, переведені в річний run-rate (сума × 365 / 18).
          Це окремий знімок: він не змішується з місячними рядами. Регіон тут завжди США.
        </p>
      </div>

      <ChartFrame title="Річний run-rate виручки в США" context={ctx} note={chartBasisNote(basis)}>
        <div style={{ height: Math.max(220, rows.length * 34) }}>
          <ResponsiveContainer>
            <BarChart layout="vertical" data={rows.map((r) => ({
              name: app(r.app_slug)?.display_name ?? r.app_slug, value: chartValue(r.run_rate_revenue_net, basis), segment: r.segment,
            }))} margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--grid)" horizontal={false} />
              <XAxis type="number" tickFormatter={fmtAxisUsd} {...axis} />
              <YAxis type="category" dataKey="name" width={170} interval={0} {...axis} fontSize={11} />
              <Tooltip content={<MoneyTooltip basis={basis} labelFormat={(l) => l} footer="річний run-rate"
                rowColor={(row) => segmentColor(row.segment as Parameters<typeof segmentColor>[0])} />} cursor={{ fill: "var(--grid)" }} />
              <Bar dataKey="value" name="Run-rate" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.app_slug} fill={segmentColor(r.segment)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted">Колір смуги = сегмент (див. таблицю).</p>
      </ChartFrame>

      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="tabular w-full min-w-[760px] text-sm">
          <caption className="px-3 pt-3 text-left text-xs text-muted">
            США · {period} · {basis === "net" ? "Net" : "Gross, оцінка (net ÷ 0,85…0,70)"} · USD
          </caption>
          <thead className="text-left text-ink-2">
            <tr className="border-b border-hairline">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Застосунок</th>
              <th className="px-3 py-2 text-right font-medium">Виручка за {rows[0]?.days ?? 18} дн.</th>
              <th className="px-3 py-2 text-right font-medium">Run-rate, рік</th>
              <th className="px-3 py-2 text-right font-medium">Частка</th>
              <th className="px-3 py-2 text-right font-medium">App Store / Google Play</th>
              <th className="px-3 py-2 text-right font-medium">Завантаження</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const a = app(r.app_slug);
              const ios = r.by_platform.ios ?? 0;
              const tot = (r.by_platform.ios ?? 0) + (r.by_platform.android ?? 0);
              return (
                <tr key={r.app_slug} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2 text-muted">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <AppIcon src={a?.icon_path ?? null} name={a?.display_name ?? r.app_slug} size={24} />
                      <span>{a?.display_name ?? r.app_slug}</span>
                      <SegmentBadge segment={r.segment} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{fmtMoney(r.revenue_net, basis)}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmtMoney(r.run_rate_revenue_net, basis)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(total ? (r.run_rate_revenue_net ?? 0) / total : null, false)}</td>
                  <td className="px-3 py-2 text-right text-ink-2">{tot ? `${Math.round((ios / tot) * 100)}% / ${100 - Math.round((ios / tot) * 100)}%` : "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtCompact(r.downloads)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
