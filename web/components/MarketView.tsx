"use client";

// «Ринкові сигнали»: market-level data from sources other than Sensor Tower (free services workbook,
// AppKittie). Snapshots with their own source/period labels; nothing here is added to Sensor Tower.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useControls } from "@/lib/controls";
import { STORE_LABEL, dateLabel, fmtCompact, fmtInt, fmtIntelMoney, fmtPct, intelBasisLabel, monthLabel, sourceLine } from "@/lib/labels";
import type { Catalog, MarketSignals } from "@/lib/types";
import { ChannelBar, DealsList, SecTable, TrendsChart } from "./AppIntel";
import { AppIcon, SERIES, Section } from "./ui";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-hairline bg-surface p-4 ${className}`}>{children}</div>;
}

const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

/** Bar on a log scale, for counts spanning 4+ orders of magnitude (14 … 50 000 ads, 0.1M … 280M visits). */
function LogBar({ value, max, color = SERIES[0] }: { value: number | null | undefined; max: number; color?: string }) {
  const w = value && value > 0 ? Math.log10(value + 1) / Math.log10(max + 1) : 0;
  return (
    <div className="h-2 w-full min-w-[60px] rounded-full bg-grid" aria-hidden>
      <div className="h-2 rounded-full" style={{ width: `${w * 100}%`, background: color }} />
    </div>
  );
}

/** "1) … 2) … 3) …" -> items */
function numbered(text: string): string[] {
  const parts = text.split(/\s*(?=\d+\)\s)/).map((s) => s.replace(/^\d+\)\s*/, "").trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

export function MarketView({ m, catalog }: { m: MarketSignals; catalog: Catalog }) {
  const { basis } = useControls();
  const [akQuery, setAkQuery] = useState<"all" | "comics" | "manga">("all");
  const apps = Object.fromEntries(catalog.apps.map((a) => [a.slug, a]));
  const AppName = ({ slug, fallback }: { slug: string | null | undefined; fallback: string }) => {
    const a = slug ? apps[slug] : undefined;
    if (!a) return <span className="text-ink">{fallback}</span>;
    return (
      <Link href={`/apps/${a.slug}/`} className="inline-flex items-center gap-2 text-ink hover:underline">
        <AppIcon src={a.icon_path} name={a.display_name} size={20} />
        <span className="truncate">{fallback}</span>
      </Link>
    );
  };
  const findings = m.readme.filter((r) => r.key.includes("висновки")).flatMap((r) => numbered(r.text));
  const fs = m.as_of.free_services;
  const ak = m.as_of.appkittie;
  const akBasis = m.revenue_basis.AppKittie;
  const swPeriod = m.web.find((w) => w.period)?.period ? monthLabel(m.web.find((w) => w.period)!.period!) : "—";
  const maxVisits = Math.max(...m.web.map((w) => w.visits ?? 0));
  const maxAds = Math.max(...m.meta_ad_library.map((r) => r.active_ads ?? 0));
  const akRows = m.appkittie_search
    .filter((r) => akQuery === "all" || r.queries.includes(akQuery))
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const trends = m.google_trends;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Ринкові сигнали</h1>
        <p className="max-w-3xl text-sm text-ink-2">
          Дані не з Sensor Tower: Similarweb (веб-трафік), AppMagic (демо, нижні межі), Google Trends, Meta Ad Library, звітність WEBTOON
          у SEC — ручний збір {dateLabel(fs)}; AppKittie — {dateLabel(ak)}. Кожна цифра підписана джерелом і періодом; з даними Sensor Tower
          вони не сумуються.
        </p>
      </header>

      {findings.length > 0 && (
        <Section title="Головні висновки збору">
          <Card>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">{findings.map((f) => <li key={f}>{f}</li>)}</ol>
            <div className="mt-2 text-xs text-muted">З аркуша «Читати першим», ручний збір {dateLabel(fs)}</div>
          </Card>
        </Section>
      )}

      {trends.length > 0 && (
        <Section title="Пошуковий інтерес · Google Trends (США)">
          <div className="grid gap-4 lg:grid-cols-2">
            {trends.map((t, i) => (
              <Card key={i}>
                <div className="font-medium text-ink">{t.title ? "Бренди" : "Категорії й суміжні формати"}: {t.keywords.map((k) => `«${k}»`).join(", ")}</div>
                <div className="mb-2 text-xs text-muted">{t.source} · відносний інтерес 0–100 у межах цього порівняння; набори між собою не порівнюються</div>
                <TrendsChart years={t.years.map((y) => y.year)} keywords={Object.fromEntries(t.keywords.map((k) => [k, t.years.map((y) => y[k] ?? null)]))} />
                {t.note && <p className="mt-2 text-sm text-ink-2">{t.note}</p>}
              </Card>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {m.keywords.length > 0 && (
          <Section title="Ключові слова в App Store (США)">
            <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
              <table className="tabular w-full text-sm">
                <caption className="px-3 pt-3 text-left text-xs text-muted">AppKittie, {dateLabel(m.keywords[0].as_of)} · App Store США · шкали 0–100 AppKittie</caption>
                <thead className="text-left text-ink-2">
                  <tr className="border-b border-hairline">
                    <th className={th}>Запит</th><th className={`${th} text-right`}>Популярність</th>
                    <th className={`${th} text-right`}>Складність</th><th className={`${th} text-right`}>Можливість</th>
                  </tr>
                </thead>
                <tbody>
                  {m.keywords.map((k) => (
                    <tr key={k.keyword} className="border-b border-hairline last:border-0">
                      <td className={`${td} text-ink`}>{k.keyword}</td>
                      <td className={`${td} text-right`}>{k.popularity}</td>
                      <td className={`${td} text-right`}>{k.difficulty}</td>
                      <td className={`${td} text-right`}>{k.opportunity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
        {m.meta_ad_library.length > 0 && (
          <Section title="Активна реклама в Meta за запитом (США)">
            <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
              <table className="tabular w-full text-sm">
                <caption className="px-3 pt-3 text-left text-xs text-muted">
                  Meta Ad Library, {dateLabel(m.meta_ad_library[0].as_of)} · США · активні оголошення за ключовим словом (≈) · смуга в логарифмічній шкалі
                </caption>
                <thead className="text-left text-ink-2">
                  <tr className="border-b border-hairline"><th className={th}>Запит</th><th className={`${th} text-right`}>Оголошень</th><th className={th} /></tr>
                </thead>
                <tbody>
                  {m.meta_ad_library.map((r) => (
                    <tr key={r.keyword} className="border-b border-hairline last:border-0 align-top" title={r.top_advertisers ?? undefined}>
                      <td className={`${td} text-ink`}>{r.keyword}<div className="text-xs text-muted">{r.top_advertisers}</div></td>
                      <td className={`${td} text-right`}>{fmtInt(r.active_ads)}</td>
                      <td className={`${td} w-1/3`}><LogBar value={r.active_ads} max={maxAds} color={SERIES[1]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>

      {m.web.length > 0 && (
        <Section title="Веб-трафік сайтів">
          <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="tabular w-full min-w-[900px] text-sm">
              <caption className="px-3 pt-3 text-left text-xs text-muted">
                {sourceLine({ source: "Similarweb", period: swPeriod, region: "Світ" })} · лише веб (десктоп + мобільний браузер), без застосунків ·
                смуга візитів — логарифмічна шкала · піратські агрегатори — лише для масштабу
              </caption>
              <thead className="text-left text-ink-2">
                <tr className="border-b border-hairline">
                  <th className={th}>Сайт</th><th className={th}>Тип</th><th className={`${th} text-right`}>Візити/міс</th><th className={th} />
                  <th className={`${th} text-right`}>До серпня</th><th className={`${th} text-right`}>Моб. веб</th>
                  <th className={`${th} text-right`}>× webtoons.com</th><th className={`${th} w-[260px]`}>Канали</th>
                </tr>
              </thead>
              <tbody>
                {m.web.map((w) => (
                  <tr key={w.domain} className="border-b border-hairline last:border-0 align-top">
                    <td className={td}><AppName slug={w.slug} fallback={w.domain} /></td>
                    <td className={`${td} text-xs text-ink-2`}>{w.type}</td>
                    <td className={`${td} text-right text-ink`}>{fmtCompact(w.visits)}</td>
                    <td className={`${td} w-24`}><LogBar value={w.visits} max={maxVisits} /></td>
                    <td className={`${td} text-right`}>{fmtPct(w.mom)}</td>
                    <td className={`${td} text-right`}>{fmtPct(w.mobile_share, false)}</td>
                    <td className={`${td} text-right`}>{w.x_webtoons != null ? `${w.x_webtoons.toFixed(2).replace(".", ",")}×` : "—"}</td>
                    <td className={td}>{w.channels ? <ChannelBarCompact channels={w.channels} /> : <span className="text-xs text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.web.find((w) => w.channels) && (
            <Card>
              <div className="mb-2 text-sm text-ink-2">Легенда каналів (приклад: {m.web.find((w) => w.channels)!.domain})</div>
              <ChannelBar channels={m.web.find((w) => w.channels)!.channels!} />
            </Card>
          )}
        </Section>
      )}

      <Section title="Оцінки застосунків інших джерел">
        <div className="grid gap-6 xl:grid-cols-2">
          {m.appmagic.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
              <table className="tabular w-full text-sm">
                <caption className="px-3 pt-3 text-left text-xs text-muted">
                  AppMagic (демо) · 30 днів ≈ 13.09–12.10.2026 · Світ · лише НИЖНЯ межа («≥») · {intelBasisLabel(m.revenue_basis.AppMagic, basis)} · стори не вказано · USD
                </caption>
                <thead className="text-left text-ink-2">
                  <tr className="border-b border-hairline">
                    <th className={th}>Застосунок</th><th className={`${th} text-right`}>Виручка</th><th className={`${th} text-right`}>Завантаження</th><th className={th}>Країни (виручка)</th>
                  </tr>
                </thead>
                <tbody>
                  {m.appmagic.map((r) => (
                    <tr key={r.app_name} className="border-b border-hairline last:border-0">
                      <td className={td}><AppName slug={r.slug} fallback={r.app_name} /></td>
                      <td className={`${td} whitespace-nowrap text-right text-ink`}>{fmtIntelMoney(r.revenue, m.revenue_basis.AppMagic, basis, "lower")}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>≥ {fmtCompact(r.downloads)}</td>
                      <td className={`${td} text-xs text-ink-2`}>{r.revenue_by_country ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {m.appkittie_search.length > 0 && (
            <div className="space-y-2">
              <div role="group" aria-label="Пошуковий запит AppKittie" className="inline-flex rounded-lg border border-hairline bg-surface p-0.5 text-sm">
                {(["all", "comics", "manga"] as const).map((q) => (
                  <button key={q} type="button" onClick={() => setAkQuery(q)} aria-pressed={akQuery === q}
                    className={`rounded-md px-2.5 py-1 ${akQuery === q ? "bg-ink text-page" : "text-ink-2"}`}>
                    {q === "all" ? "Усі" : `«${q}»`}
                  </button>
                ))}
              </div>
              <div className="max-h-[560px] overflow-auto rounded-lg border border-hairline bg-surface">
                <table className="tabular w-full text-sm">
                  <caption className="px-3 pt-3 text-left text-xs text-muted">
                    {sourceLine({ source: "AppKittie, пошук", period: `30 днів до ${dateLabel(ak)}`, region: "Світ", basis: intelBasisLabel(akBasis, basis) })} ·
                    окремо за стором · «не в каталозі» — утиліти, ігри тощо з видачі
                  </caption>
                  <thead className="sticky top-0 bg-surface text-left text-ink-2">
                    <tr className="border-b border-hairline">
                      <th className={th}>Застосунок</th><th className={th}>Стор</th><th className={`${th} text-right`}>Виручка</th>
                      <th className={`${th} text-right`}>Завантаж.</th><th className={`${th} text-right`}>Рейтинг</th><th className={`${th} text-right`}>Meta, 30 дн.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {akRows.map((r) => (
                      <tr key={r.ak_slug} className="border-b border-hairline last:border-0">
                        <td className={td}>
                          <AppName slug={r.slug} fallback={r.app_name} />
                          {!r.slug && <span className="ml-1 text-xs text-muted">не в каталозі</span>}
                        </td>
                        <td className={`${td} text-xs`}>{STORE_LABEL[r.store]}</td>
                        <td className={`${td} text-right text-ink`}>{fmtIntelMoney(r.revenue, akBasis, basis)}</td>
                        <td className={`${td} text-right`}>{fmtCompact(r.downloads)}</td>
                        <td className={`${td} text-right`}>{r.rating?.toFixed(1).replace(".", ",") ?? "—"}★</td>
                        <td className={`${td} text-right`}>{r.meta_spend_30d != null ? `$${fmtInt(r.meta_spend_30d)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Section>

      {(m.deals.length > 0 || m.sec_webtoon.length > 0) && (
        <Section title="Угоди, оцінки компаній і звітність WEBTOON">
          <div className="space-y-4">
            <DealsList deals={m.deals} className="grid gap-2 lg:grid-cols-2" />
            {m.sec_webtoon.length > 0 && <SecTable rows={m.sec_webtoon} />}
          </div>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {m.alternativeto.length > 0 && (
          <Section title={`Альтернативи ${apps[m.alternativeto_for ?? ""]?.display_name.split(" ")[0] ?? ""} (AlternativeTo)`}>
            <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
              <table className="tabular w-full text-sm">
                <caption className="px-3 pt-3 text-left text-xs text-muted">Голоси користувачів AlternativeTo (якісний сигнал, не частка ринку) · знято {dateLabel(fs)}</caption>
                <thead className="text-left text-ink-2">
                  <tr className="border-b border-hairline"><th className={th}>Фільтр</th><th className={th}>Застосунок</th><th className={`${th} text-right`}>Лайки</th><th className={th}>Примітка</th></tr>
                </thead>
                <tbody>
                  {m.alternativeto.map((r, i) => (
                    <tr key={i} className="border-b border-hairline last:border-0">
                      <td className={`${td} text-xs text-ink-2`}>{r.filter}</td>
                      <td className={`${td} text-ink`}>{r.app}</td>
                      <td className={`${td} text-right`}>{r.likes}</td>
                      <td className={`${td} text-xs text-ink-2`}>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
        {m.gaps.length > 0 && (
          <Section title="Чого бракує в безкоштовних даних">
            <ul className="space-y-2 text-sm">
              {m.gaps.map((g, i) => (
                <li key={i} className="rounded-lg border border-hairline bg-surface p-3">
                  <div className="text-ink"><b>{g.service}</b>: {g.missing}</div>
                  <div className="text-xs text-muted">{[g.reason, g.fix && `як закрити: ${g.fix}`].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

/** Table-cell version of the channel bar: the bar only (legend below the table). */
function ChannelBarCompact({ channels }: { channels: Record<string, number | null> }) {
  return (
    <div className="[&_ul]:hidden">
      <ChannelBar channels={channels} />
    </div>
  );
}
