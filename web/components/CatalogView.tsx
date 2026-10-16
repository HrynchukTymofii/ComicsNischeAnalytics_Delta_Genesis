"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type MouseEvent } from "react";
import { useControls } from "@/lib/controls";
import { STATUS_LABEL, fmtMoney, fmtPct, monthLabel, periodLabel, REGION_LABEL, BASIS_LABEL } from "@/lib/labels";
import type { Catalog, LifecycleStatus, Metrics, MonthlyByApp } from "@/lib/types";
import { AppQuickView } from "./AppQuickView";
import { AppIcon, ExtLink, GrowthBadge, SegmentBadge, StatusBadge } from "./ui";

/** intel_index.json section keys -> short labels for the «Дані» column (only the ones worth listing). */
const INTEL_LABEL: Record<string, string> = {
  estimates: "оцінки AppKittie/AppMagic", monetization: "монетизація", reviews: "відгуки", ads: "реклама",
  web: "веб-трафік", trends: "Google Trends", deals: "угоди", sec: "звітність SEC", paywalls: "пейволи",
};

export function CatalogView({ catalog, metrics, monthly, intel }: {
  catalog: Catalog; metrics: Metrics; monthly: MonthlyByApp; intel: Record<string, string[]>;
}) {
  const { basis, region, segments } = useControls();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (slug: string, e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("a, input, select")) return; // links keep working
    setOpen((cur) => (cur === slug ? null : slug));
  };
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<LifecycleStatus | "">("");
  const [onlyShort, setOnlyShort] = useState(false);
  const [onlyData, setOnlyData] = useState(false);

  const apps = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.apps
      .filter((a) => !a.segment || segments.includes(a.segment))
      .filter((a) => !status || a.status === status)
      .filter((a) => !onlyShort || a.shortlist)
      .filter((a) => !onlyData || a.has_data || intel[a.slug])
      .filter((a) => !needle || [a.display_name, a.developer, a.publisher, a.company, a.parent]
        .some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => (metrics.apps[b.slug]?.[region]?.l12m.revenue_net ?? -1) - (metrics.apps[a.slug]?.[region]?.l12m.revenue_net ?? -1));
  }, [catalog.apps, metrics, intel, q, status, onlyShort, onlyData, segments, region]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Каталог застосунків</h1>
        <p className="text-sm text-ink-2">
          {catalog.apps.length} застосунків із реєстру; {catalog.apps.filter((a) => a.has_data).length} мають дані Sensor Tower,{" "}
          {catalog.apps.filter((a) => intel[a.slug]).length} — дані інших джерел (AppKittie, відгуки, Similarweb…).
          Клікніть рядок, щоб розгорнути графік і ключові цифри застосунку.
          Виручка: L12M ({periodLabel(metrics.meta.l12m)}) · {REGION_LABEL[region]} · {BASIS_LABEL[basis]} · USD.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук: назва, розробник, група…"
          className="w-full rounded-lg border border-hairline bg-surface px-3 py-1.5 text-ink placeholder:text-muted sm:w-72" />
        <select value={status} onChange={(e) => setStatus(e.target.value as LifecycleStatus | "")}
          className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-ink">
          <option value="">Усі статуси</option>
          {catalog.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-ink-2">
          <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} /> Шорт-лист
        </label>
        <label className="inline-flex items-center gap-1.5 text-ink-2">
          <input type="checkbox" checked={onlyData} onChange={(e) => setOnlyData(e.target.checked)} /> Є дані
        </label>
        <span className="text-muted">{apps.length} показано</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-ink-2">
            <tr className="border-b border-hairline">
              <th className="px-3 py-2 font-medium">Застосунок</th>
              <th className="px-3 py-2 font-medium">Сегмент · статус</th>
              <th className="px-3 py-2 font-medium">Розробник · категорія iOS</th>
              <th className="px-3 py-2 text-right font-medium">Виручка L12M</th>
              <th className="px-3 py-2 font-medium">Динаміка</th>
              <th className="px-3 py-2 text-right font-medium">Рейтинг</th>
              <th className="px-3 py-2 font-medium">Дані</th>
              <th className="px-3 py-2 font-medium">Посилання</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {apps.map((a) => {
              const m = metrics.apps[a.slug]?.[region];
              const cov = a.data_coverage;
              const isOpen = open === a.slug;
              return (
                <Fragment key={a.slug}>
                <tr onClick={a.has_data ? (e) => toggle(a.slug, e) : undefined}
                  className={`border-b border-hairline align-top ${a.has_data ? "cursor-pointer hover:bg-page" : ""} ${isOpen ? "bg-page" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {a.has_data ? (
                        <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Згорнути" : "Розгорнути"} ${a.display_name}`}
                          onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : a.slug); }}
                          className="w-4 shrink-0 text-ink-2">{isOpen ? "▾" : "▸"}</button>
                      ) : <span className="w-4 shrink-0" aria-hidden />}
                      <AppIcon src={a.icon_path} name={a.display_name} />
                      <div>
                        {a.has_data || intel[a.slug] ? (
                          <Link href={`/apps/${a.slug}/`} className="font-medium text-ink hover:underline">{a.display_name}</Link>
                        ) : <span className="font-medium text-ink">{a.display_name}</span>}
                        {a.shortlist && <span className="ml-1.5 rounded bg-grid px-1 text-[10px] uppercase text-ink-2">шорт-лист</span>}
                        <div className="text-xs text-muted">{a.parent ?? a.company ?? ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="space-y-1 px-3 py-2"><SegmentBadge segment={a.segment} /><div><StatusBadge status={a.status} /></div></td>
                  <td className="px-3 py-2 text-ink-2">{a.developer ?? "—"}<div className="text-xs text-muted">{a.ios_category ?? ""}</div></td>
                  <td className="px-3 py-2 text-right text-ink">{m ? fmtMoney(m.l12m.revenue_net, basis) : "—"}</td>
                  <td className="px-3 py-2"><GrowthBadge status={m?.status} />{m?.l12m.yoy != null && <div className="text-xs text-muted">{fmtPct(m.l12m.yoy)} YoY</div>}</td>
                  <td className="px-3 py-2 text-right text-ink-2">
                    {a.rating ? `${a.rating.toFixed(1).replace(".", ",")}★` : "—"}
                    {a.rating_count ? <div className="text-xs text-muted">{a.rating_count.toLocaleString("uk-UA")} · {a.rating_store?.toUpperCase()}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {cov.length ? cov.map((c, i) => (
                      <div key={i}>{c.granularity === "monthly" ? "міс." : c.granularity === "weekly" ? "тижн." : c.granularity === "daily" ? "день" : c.granularity}{" "}
                        {monthLabel(c.start.slice(0, 7))}–{monthLabel(c.end.slice(0, 7))}{c.regions === "US" ? " (США)" : ""}</div>
                    )) : <span className="text-muted">{intel[a.slug] ? "немає Sensor Tower" : "немає даних"}</span>}
                    {intel[a.slug]?.some((k) => INTEL_LABEL[k]) && (
                      <div className="mt-0.5 text-muted">+ {intel[a.slug].filter((k) => INTEL_LABEL[k]).map((k) => INTEL_LABEL[k]).join(", ")}</div>
                    )}
                  </td>
                  <td className="space-x-2 px-3 py-2 text-xs">
                    <ExtLink href={a.app_store_url}>App Store</ExtLink>
                    <ExtLink href={a.google_play_url}>Google Play</ExtLink>
                    <ExtLink href={a.website}>Сайт</ExtLink>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-hairline bg-page">
                    <td colSpan={8} className="px-4 py-4">
                      <AppQuickView app={a} series={monthly.apps[a.slug]?.[region]} metrics={metrics.apps[a.slug]?.[region]}
                        region={region} basis={basis} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
