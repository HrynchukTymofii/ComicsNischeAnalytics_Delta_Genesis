"use client";

// App page sections from sources other than Sensor Tower (`make intel`): other estimates side by side,
// monetization, Google Play reviews, ads & creatives, store pages, web traffic, search interest, deals.
// Every number names its source, period, region and (for money) net/gross — and is never added to Sensor Tower.

import { useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useControls } from "@/lib/controls";
import {
  REGION_LABEL, STORE_LABEL, dateLabel, fmtCompact, fmtInt, fmtIntelMoney, fmtM, fmtMoney, fmtPct, fmtUsdPrice, hostOf,
  intelBasisLabel, monthLabel, sourceLine,
} from "@/lib/labels";
import type { AppIntel, Creative, Estimate, MediaRef, Reviews, WebTraffic } from "@/lib/types";
import { SERIES, OTHER, Section } from "./ui";

const axis = { stroke: "var(--axis)", tick: { fill: "var(--muted)", fontSize: 12 }, tickLine: false };
const tooltipBox = { background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 8, fontSize: 12 };
const PERIOD_UK: Record<string, string> = { once: "разово", week: "тиждень", month: "місяць", year: "рік" };

export interface StLatest {
  month: string;
  revenue_net: number;
  downloads: number;
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-hairline bg-surface p-4 ${className}`}>{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}

function Tile({ label, value, sub, context }: { label: string; value: string; sub?: ReactNode; context: string }) {
  return (
    <Card>
      <div className="text-sm text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-2">{sub}</div>}
      <div className="mt-2 text-xs text-muted">{context}</div>
    </Card>
  );
}

/** Horizontal bar for shares / counts in a list; the number is always printed next to it. */
function ShareBar({ value, max = 1, color = SERIES[0] }: { value: number; max?: number; color?: string }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-grid" aria-hidden>
      <div className="h-2 rounded-full" style={{ width: `${w * 100}%`, background: color }} />
    </div>
  );
}

function Media({ m, alt, aspect = "aspect-square" }: { m: MediaRef | null; alt: string; aspect?: string }) {
  if (!m) return <div className={`flex ${aspect} items-center justify-center rounded-md bg-grid text-xs text-muted`}>немає медіа</div>;
  if (m.kind === "video")
    return <video src={m.src} poster={m.poster ?? undefined} controls preload="none" playsInline className={`${aspect} w-full rounded-md bg-grid object-contain`} aria-label={alt} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={m.src} alt={alt} loading="lazy" className={`${aspect} w-full rounded-md bg-grid object-contain`} />;
}

// --- 1. other sources' estimates ----------------------------------------------------------------

function EstimatesSection({ est, st }: { est: Estimate[]; st: StLatest | null }) {
  const { basis } = useControls();
  const ak = est.filter((e) => e.source === "AppKittie" && e.kind === "search");
  const akSum = ak.length > 1 && ak.every((e) => e.revenue != null) ? ak.reduce((s, e) => s + (e.revenue ?? 0), 0) : null;
  const akDl = ak.length > 1 && ak.every((e) => e.downloads != null) ? ak.reduce((s, e) => s + (e.downloads ?? 0), 0) : null;
  const rows: { source: string; period: string; store: string; revenue: string; downloads: string; basis: string; note?: string }[] = [];
  if (st)
    rows.push({ source: "Sensor Tower", period: `${monthLabel(st.month)} (календарний місяць)`, store: "обидва стори", revenue: fmtMoney(st.revenue_net, basis),
      downloads: fmtCompact(st.downloads), basis: basis === "net" ? "Net" : "Gross, оцінка" });
  for (const e of est) {
    rows.push({
      source: e.source + (e.kind === "card" ? " (картка)" : ""),
      period: `30 днів до ${dateLabel(e.as_of)}`,
      store: STORE_LABEL[e.store],
      revenue: fmtIntelMoney(e.revenue, e.revenue_basis, basis, e.bound),
      downloads: (e.bound === "lower" ? "≥ " : "") + fmtCompact(e.downloads),
      basis: intelBasisLabel(e.revenue_basis, basis),
      note: [
        e.revenue_growth_30d != null ? `виручка ${fmtPct(e.revenue_growth_30d)} за 30 дн.` : null,
        e.downloads_growth_30d != null ? `завантаження ${fmtPct(e.downloads_growth_30d)}` : null,
        e.revenue_by_country ? `виручка: ${e.revenue_by_country}` : null,
        e.downloads_by_country ? `завантаження: ${e.downloads_by_country}` : null,
        e.bound === "lower" ? "демо показує лише нижню межу" : null,
      ].filter(Boolean).join("; ") || undefined,
    });
  }
  if (akSum != null)
    rows.push({ source: "AppKittie, сума двох сторів", period: `30 днів до ${dateLabel(ak[0].as_of)}`, store: "App Store + Google Play",
      revenue: fmtIntelMoney(akSum, ak[0].revenue_basis, basis), downloads: fmtCompact(akDl), basis: intelBasisLabel(ak[0].revenue_basis, basis),
      note: "сума всередині одного джерела" });
  const trend = est.flatMap((e) => e.trend_notes ?? []);
  return (
    <Section title="Оцінки інших джерел">
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="tabular w-full min-w-[720px] text-sm">
          <caption className="px-3 pt-3 text-left text-xs text-muted">Світ · USD · кожен рядок — окреме джерело; джерела ніколи не сумуються між собою</caption>
          <thead className="text-left text-ink-2">
            <tr className="border-b border-hairline">
              <th className="px-3 py-2 font-medium">Джерело</th>
              <th className="px-3 py-2 font-medium">Період</th>
              <th className="px-3 py-2 font-medium">Стор</th>
              <th className="px-3 py-2 text-right font-medium">Виручка</th>
              <th className="px-3 py-2 text-right font-medium">Завантаження</th>
              <th className="px-3 py-2 font-medium">Net / gross</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-b border-hairline last:border-0 align-top ${i === 0 && st ? "bg-page" : ""}`}>
                <td className="px-3 py-1.5 text-ink">{r.source}{r.note && <div className="text-xs text-muted">{r.note}</div>}</td>
                <td className="px-3 py-1.5">{r.period}</td>
                <td className="px-3 py-1.5">{r.store}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium text-ink">{r.revenue}</td>
                <td className="px-3 py-1.5 text-right">{r.downloads}</td>
                <td className="px-3 py-1.5 text-xs">{r.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trend.length > 0 && <Note>Динаміка AppKittie: {trend.join(" · ")}</Note>}
      <Note>Періоди різні: Sensor Tower — останній повний календарний місяць, AppKittie й AppMagic — 30 днів до дати знімка. Порівнюйте порядок величин, а не долари.</Note>
    </Section>
  );
}

// --- 2. monetization --------------------------------------------------------------------------------

function MonetizationSection({ m, description }: { m: NonNullable<AppIntel["monetization"]>; description: AppIntel["store_description"] }) {
  return (
    <Section title="Монетизація">
      <div className={`grid gap-4 ${m.iap.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <Card className="space-y-3 text-sm">
          {m.models.map((x, i) => (
            <div key={i}>
              <div className="text-xs text-muted">Модель і ціни · ручний збір {dateLabel(x.as_of)}</div>
              <div className="text-ink">{x.text}</div>
            </div>
          ))}
          {m.store_iap_text.map((x, i) => (
            <div key={i}>
              <div className="text-xs text-muted">{x.source} · ціни покупок у застосунку · {dateLabel(x.as_of)}</div>
              <div className="text-ink">{x.text}</div>
            </div>
          ))}
          {description && (
            <details className="text-ink-2">
              <summary className="cursor-pointer text-xs text-muted">Опис зі стору ({STORE_LABEL[description.store]}, {description.source}, {dateLabel(description.as_of)})</summary>
              <p className="mt-2 whitespace-pre-line text-sm">{description.text}</p>
            </details>
          )}
        </Card>
        {m.iap.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="tabular w-full text-sm">
              <caption className="px-3 pt-3 text-left text-xs text-muted">
                Покупки в застосунку · {STORE_LABEL[m.iap[0].store]} · {m.iap[0].source}, {dateLabel(m.iap[0].as_of)} · ціни в сторі, USD (різняться за країнами й акціями)
              </caption>
              <thead className="text-left text-ink-2">
                <tr className="border-b border-hairline">
                  <th className="px-3 py-2 font-medium">Покупка</th>
                  <th className="px-3 py-2 font-medium">Період</th>
                  <th className="px-3 py-2 text-right font-medium">Ціна</th>
                </tr>
              </thead>
              <tbody>
                {m.iap.map((x) => (
                  <tr key={x.raw} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-1.5 text-ink">{x.name}</td>
                    <td className="px-3 py-1.5">{PERIOD_UK[x.period]}</td>
                    <td className="px-3 py-1.5 text-right">{fmtUsdPrice(x.price_min, x.price_max)}{x.n_prices > 1 && <span className="text-xs text-muted"> ({x.n_prices} ціни)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

// --- 3. reviews -------------------------------------------------------------------------------------

function Stars({ n }: { n: number }) {
  return <span aria-label={`${n} з 5`} className="tracking-tight text-ink">{"★".repeat(n)}<span className="text-grid">{"★".repeat(5 - n)}</span></span>;
}

function ReviewsSection({ r, storeRating }: { r: Reviews; storeRating: number | null }) {
  const [stars, setStars] = useState<number | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<"new" | "helpful">("new");
  const [shown, setShown] = useState(8);
  const ctx = sourceLine({ source: `Google Play, US, англ.`, period: `${dateLabel(r.period.from)} – ${dateLabel(r.period.to)}`, region: `${r.n} найновіших відгуків` });
  const items = useMemo(() => {
    const f = r.items.filter((x) => (stars == null || x.stars === stars) && (topic == null || x.topics.includes(topic)));
    return sort === "helpful" ? [...f].sort((a, b) => b.helpful - a.helpful) : f;
  }, [r.items, stars, topic, sort]);
  const maxStar = Math.max(...Object.values(r.stars));
  const topicLabel = Object.fromEntries(r.topics.map((t) => [t.key, t.label]));
  const chip = (on: boolean) => `rounded-md border border-hairline px-2 py-1 ${on ? "bg-ink text-page" : "bg-surface text-ink-2"}`;

  return (
    <Section title="Відгуки · Google Play (США)">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Відгуків у вибірці" value={fmtInt(r.n)} sub={`${dateLabel(r.period.from)} – ${dateLabel(r.period.to)}`} context={ctx} />
        <Tile label="Середня оцінка вибірки" value={`${r.avg_stars.toFixed(2).replace(".", ",")}★`}
          sub={storeRating != null ? `рейтинг у сторі ${storeRating.toFixed(1).replace(".", ",")}★ (за весь час)` : undefined} context={ctx} />
        <Tile label="Розробник відповідає" value={fmtPct(r.reply_rate, false)} sub="частка відгуків з відповіддю" context={ctx} />
        <Tile label="Найчастіша тема" value={r.topics[0]?.label.split(" (")[0] ?? "—"}
          sub={r.topics[0] ? `${fmtPct(r.topics[0].share, false)} відгуків · сер. ${r.topics[0].avg_stars.toFixed(1).replace(".", ",")}★` : undefined} context={ctx} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 font-medium text-ink">Розподіл оцінок</div>
          <div className="space-y-1.5 text-sm">
            {[5, 4, 3, 2, 1].map((s) => {
              const n = r.stars[String(s) as "1"];
              return (
                <button key={s} type="button" onClick={() => setStars(stars === s ? null : s)} aria-pressed={stars === s}
                  className="grid w-full grid-cols-[3.5rem_1fr_4.5rem] items-center gap-2 rounded px-1 text-left hover:bg-page" title={`${n} відгуків з оцінкою ${s}`}>
                  <span className="text-ink-2">{s}★</span>
                  <ShareBar value={n} max={maxStar} />
                  <span className="text-right tabular text-ink-2">{n} · {fmtPct(n / r.n, false)}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-xs text-muted">{ctx} · клік фільтрує список</div>
        </Card>
        <Card>
          <div className="mb-2 font-medium text-ink">Теми (автоматичні теги за ключовими словами)</div>
          <div className="space-y-1.5 text-sm">
            {r.topics.map((t) => (
              <button key={t.key} type="button" onClick={() => setTopic(topic === t.key ? null : t.key)} aria-pressed={topic === t.key}
                className="grid w-full grid-cols-[minmax(0,11rem)_1fr_6.5rem] items-center gap-2 rounded px-1 text-left hover:bg-page"
                title={`${t.n} відгуків, середня оцінка ${t.avg_stars}`}>
                <span className={`truncate ${topic === t.key ? "font-medium text-ink" : "text-ink-2"}`}>{t.label}</span>
                <ShareBar value={t.share} max={r.topics[0]?.share ?? 1} color={SERIES[1]} />
                <span className="text-right tabular text-ink-2">{fmtPct(t.share, false)} · {t.avg_stars.toFixed(1).replace(".", ",")}★</span>
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted">частка відгуків вибірки з темою · середня оцінка таких відгуків; відгук може мати кілька тем</div>
        </Card>
      </div>

      {r.monthly.length >= 3 && (
        <Card>
          <div className="font-medium text-ink">Середня оцінка відгуків за місяцями</div>
          <div className="mb-2 text-xs text-muted">{ctx} · у підказці — кількість відгуків за місяць (малі місяці шумні)</div>
          <div className="h-52">
            <ResponsiveContainer>
              <LineChart data={r.monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={monthLabel} minTickGap={30} {...axis} />
                <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} width={28} axisLine={false} {...axis} />
                <Tooltip labelFormatter={monthLabel} contentStyle={tooltipBox}
                  formatter={(v: number, _n, p) => [`${v.toFixed(2)}★ (${p.payload.n} відгуків)`, "Середня оцінка"]} />
                <Line dataKey="avg_stars" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-1 text-muted">Показано {Math.min(shown, items.length)} з {items.length}:</span>
        {stars != null && <button type="button" className={chip(true)} onClick={() => setStars(null)}>{stars}★ ✕</button>}
        {topic != null && <button type="button" className={chip(true)} onClick={() => setTopic(null)}>{topicLabel[topic]} ✕</button>}
        <button type="button" className={chip(sort === "new")} onClick={() => setSort("new")} aria-pressed={sort === "new"}>Найновіші</button>
        <button type="button" className={chip(sort === "helpful")} onClick={() => setSort("helpful")} aria-pressed={sort === "helpful"}>Найкорисніші</button>
      </div>
      <ul className="grid gap-3 lg:grid-cols-2">
        {items.slice(0, shown).map((x, i) => (
          <li key={`${x.date}-${i}`} className="rounded-lg border border-hairline bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <Stars n={x.stars} /> <span>{dateLabel(x.date)}</span>
              {x.helpful > 0 && <span>👍 {x.helpful}</span>}
              {x.topics.map((t) => <span key={t} className="rounded bg-grid px-1.5 py-0.5 text-ink-2">{topicLabel[t] ?? t}</span>)}
            </div>
            <p className="mt-1 whitespace-pre-line text-ink">{x.text}</p>
            {x.reply && (
              <details className="mt-1 text-ink-2">
                <summary className="cursor-pointer text-xs text-muted">Відповідь розробника</summary>
                <p className="mt-1 whitespace-pre-line">{x.reply}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
      {shown < items.length && (
        <button type="button" onClick={() => setShown(shown + 12)} className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-ink-2 hover:text-ink">
          Показати ще
        </button>
      )}
      <Note>
        Вибірка — найновіші відгуки на момент збору ({dateLabel(r.collected_on)}), тож її період різний для різних застосунків
        і середня оцінка не дорівнює рейтингу в сторі. Теги — пошук ключових слів в англійському тексті, не аналіз тональності.
      </Note>
    </Section>
  );
}

// --- 4. ads & creatives -----------------------------------------------------------------------------

function CreativeCard({ c }: { c: Creative }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3 text-sm">
      <Media m={c.media} alt={c.headline ?? "рекламний креатив"} />
      <div className="flex flex-wrap gap-1 text-xs">
        <span className="rounded bg-grid px-1.5 py-0.5 text-ink-2">{c.network === "meta" ? "Meta" : c.network}</span>
        <span className="rounded bg-grid px-1.5 py-0.5 text-ink-2">{c.format === "video" ? "відео" : c.format === "image" ? "зображення" : c.format}</span>
        {c.active && <span className="rounded border border-hairline px-1.5 py-0.5 text-ink"><span style={{ color: "var(--good)" }} aria-hidden>●</span> активне</span>}
      </div>
      {c.headline && <div className="font-medium text-ink">{c.headline}</div>}
      {c.text && <p className="line-clamp-4 whitespace-pre-line text-ink-2" title={c.text}>{c.text}</p>}
      <div className="mt-auto space-y-0.5 text-xs text-muted">
        <div>{[c.cta && `CTA «${c.cta}»`, c.start && `старт ${dateLabel(c.start)}`, c.days_live != null && `${c.days_live} дн. у показі`].filter(Boolean).join(" · ")}</div>
        {c.spend_30d != null && <div className="text-ink-2">Витрати за 30 днів: ${c.spend_30d.toFixed(0)} (оцінка AppKittie)</div>}
        {hostOf(c.landing_url) && <div>веде на {hostOf(c.landing_url)}</div>}
      </div>
    </li>
  );
}

function AdsSection({ ads, metaSpend }: { ads: NonNullable<AppIntel["ads"]>; metaSpend: Estimate | undefined }) {
  const lib = ads.ad_library;
  const creatives = ads.creatives ?? [];
  return (
    <Section title="Реклама і креативи">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lib && (
          <Tile label={`Активних оголошень у Meta за запитом «${lib.keyword}»`} value={`≈ ${fmtInt(lib.active_ads)}`} sub={lib.advertisers}
            context={sourceLine({ source: "Meta Ad Library", period: dateLabel(lib.as_of), region: REGION_LABEL.us })} />
        )}
        {metaSpend?.meta_spend_30d != null && (
          <Tile label="Витрати на рекламу в Meta" value={`$${fmtInt(metaSpend.meta_spend_30d)}`} sub={STORE_LABEL[metaSpend.store]}
            context={sourceLine({ source: "оцінка AppKittie", period: `30 днів до ${dateLabel(metaSpend.as_of)}`, region: "Світ", basis: "витрати рекламодавця" })} />
        )}
        {creatives.length > 0 && (
          <Tile label="Креативів у вибірці" value={String(creatives.length)}
            sub={`${creatives.filter((c) => c.format === "video").length} відео · ${creatives.filter((c) => c.format === "image").length} зображень · ${creatives.filter((c) => c.active).length} активних`}
            context={sourceLine({ source: "AppKittie", period: dateLabel(creatives[0].as_of), region: "Meta / Google" })} />
        )}
      </div>
      {ads.hooks && ads.hooks.hooks.length > 0 && (
        <Card className="text-sm">
          <div className="mb-1 font-medium text-ink">{ads.hooks.title}</div>
          <ul className="list-disc space-y-0.5 pl-5 text-ink-2">{ads.hooks.hooks.map((h) => <li key={h}>{h}</li>)}</ul>
          {ads.hooks.angles && <p className="mt-2 text-ink-2">{ads.hooks.angles}</p>}
          <div className="mt-2 text-xs text-muted">Meta Ad Library, США · ручний збір</div>
        </Card>
      )}
      {creatives.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {creatives.map((c, i) => <CreativeCard key={i} c={c} />)}
        </ul>
      )}
      {creatives.length > 0 && <Note>Креативи — вибірка AppKittie на {dateLabel(creatives[0].as_of)} (останні оголошення), завантажені й зменшені для сайту.</Note>}
    </Section>
  );
}

// --- 5. store pages --------------------------------------------------------------------------------

function StoresSection({ intel }: { intel: AppIntel }) {
  const us = intel.store_us;
  const list = intel.store_listings ?? [];
  return (
    <Section title="Сторінки в сторах">
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        <table className="tabular w-full min-w-[640px] text-sm">
          <thead className="text-left text-ink-2">
            <tr className="border-b border-hairline">
              <th className="px-3 py-2 font-medium">Стор · джерело</th>
              <th className="px-3 py-2 text-right font-medium">Рейтинг</th>
              <th className="px-3 py-2 text-right font-medium">Оцінок</th>
              <th className="px-3 py-2 font-medium">Категорія / чарт</th>
              <th className="px-3 py-2 font-medium">Реліз · оновлення</th>
            </tr>
          </thead>
          <tbody>
            {list.map((l, i) => (
              <tr key={i} className="border-b border-hairline last:border-0">
                <td className="px-3 py-1.5 text-ink">{STORE_LABEL[l.store]} <span className="text-xs text-muted">· {l.source}, світ, {dateLabel(l.as_of)}</span></td>
                <td className="px-3 py-1.5 text-right">{l.rating?.toFixed(1).replace(".", ",") ?? "—"}★</td>
                <td className="px-3 py-1.5 text-right">{fmtCompact(l.rating_count)}</td>
                <td className="px-3 py-1.5">{l.category ?? "—"}</td>
                <td className="px-3 py-1.5">{dateLabel(l.release_date)} · {dateLabel(l.updated)}</td>
              </tr>
            ))}
            {us && us.gp_rating != null && (
              <tr className="border-b border-hairline last:border-0">
                <td className="px-3 py-1.5 text-ink">Google Play <span className="text-xs text-muted">· сторінка в США, {dateLabel(us.as_of)}</span></td>
                <td className="px-3 py-1.5 text-right">{us.gp_rating.toFixed(1).replace(".", ",")}★</td>
                <td className="px-3 py-1.5 text-right">{fmtCompact(us.gp_reviews)}</td>
                <td className="px-3 py-1.5">{us.gp_installs ? `${us.gp_installs} інсталяцій` : "—"}</td>
                <td className="px-3 py-1.5 text-xs">{us.gp_note}</td>
              </tr>
            )}
            {us && us.ios_rating != null && (
              <tr className="border-b border-hairline last:border-0">
                <td className="px-3 py-1.5 text-ink">App Store <span className="text-xs text-muted">· сторінка в США, {dateLabel(us.as_of)}</span></td>
                <td className="px-3 py-1.5 text-right">{us.ios_rating.toFixed(1).replace(".", ",")}★</td>
                <td className="px-3 py-1.5 text-right">{fmtCompact(us.ios_ratings)}</td>
                <td className="px-3 py-1.5">{us.ios_chart && us.ios_chart !== "—" ? `чарт ${us.ios_chart}` : "—"}</td>
                <td className="px-3 py-1.5">—</td>
              </tr>
            )}
            {us && us.gp_rating == null && us.gp_note && (
              <tr><td colSpan={5} className="px-3 py-1.5 text-xs text-muted">Google Play (США): {us.gp_note}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// --- 6. web traffic --------------------------------------------------------------------------------

const CHANNEL_GROUPS: { label: string; keys: string[]; color: string }[] = [
  { label: "Прямі", keys: ["Direct"], color: SERIES[0] },
  { label: "Органічний пошук", keys: ["Org. Search"], color: SERIES[2] },
  { label: "Соцмережі (органіка)", keys: ["Org. Social"], color: SERIES[3] },
  { label: "Реферали", keys: ["Referrals"], color: SERIES[4] },
  { label: "Платне (пошук, дисплей, соцмережі)", keys: ["Paid Search", "Display", "Paid Social"], color: SERIES[1] },
  { label: "Інше (Gen AI, email, афіліати)", keys: ["Gen AI", "Email", "Affiliates"], color: OTHER },
];

export function ChannelBar({ channels }: { channels: Record<string, number | null> }) {
  const parts = CHANNEL_GROUPS.map((g) => ({ ...g, v: g.keys.reduce((s, k) => s + (channels[k] ?? 0), 0) }));
  return (
    <div>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded" role="img"
        aria-label={parts.map((p) => `${p.label} ${fmtPct(p.v, false)}`).join(", ")}>
        {parts.filter((p) => p.v > 0).map((p) => (
          <div key={p.label} style={{ width: `${p.v * 100}%`, background: p.color }} title={`${p.label}: ${fmtPct(p.v, false)}`} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
        {parts.map((p) => (
          <li key={p.label} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
            {p.label} {fmtPct(p.v, false)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebSection({ w }: { w: WebTraffic }) {
  const ctx = sourceLine({ source: "Similarweb (лише веб, без застосунків)", period: w.period ? monthLabel(w.period) : "—", region: "Світ" });
  return (
    <Section title={`Веб-трафік · ${w.domain}`}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Візити за місяць" value={fmtCompact(w.visits)} sub={w.mom != null ? `${fmtPct(w.mom)} до серпня` : undefined} context={ctx} />
        <Tile label="Мобільний веб" value={fmtPct(w.mobile_share, false)} sub={w.desktop_share != null ? `десктоп ${fmtPct(w.desktop_share, false)}` : undefined} context={ctx} />
        <Tile label="Ранг сайту в США" value={w.us_rank != null ? `#${fmtInt(w.us_rank)}` : "—"} context={ctx} />
        <Tile label="Візит" value={w.visit_duration ?? "—"}
          sub={[w.pages_per_visit != null && `${String(w.pages_per_visit).replace(".", ",")} стор./візит`, w.bounce_rate != null && `відмови ${fmtPct(w.bounce_rate, false)}`].filter(Boolean).join(" · ") || undefined}
          context={ctx} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {w.channels && (
          <Card>
            <div className="mb-2 font-medium text-ink">Канали трафіку</div>
            <ChannelBar channels={w.channels} />
            <div className="mt-2 text-xs text-muted">{ctx} · частка візитів</div>
          </Card>
        )}
        {w.countries && w.countries.length > 0 && (
          <Card>
            <div className="mb-2 font-medium text-ink">Топ-5 країн</div>
            <ShareList rows={w.countries} />
            <div className="mt-2 text-xs text-muted">{ctx} · частка візитів</div>
          </Card>
        )}
        {w.social && w.social.length > 0 && (
          <Card>
            <div className="mb-2 font-medium text-ink">Соцмережі</div>
            <ShareList rows={w.social} color={SERIES[3]} />
            <div className="mt-2 text-xs text-muted">{ctx} · частка соціального трафіку{w.social_note ? ` · ${w.social_note}` : ""}</div>
          </Card>
        )}
      </div>
      {w.details && w.details.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
          <table className="tabular w-full text-sm">
            <caption className="px-3 pt-3 text-left text-xs text-muted">Деталі {w.domain} · {ctx}</caption>
            <tbody>
              {w.details.map((d, i) => (
                <tr key={i} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-1.5 text-ink-2">{d.block}</td>
                  <td className="px-3 py-1.5 text-ink">{d.metric}</td>
                  <td className="px-3 py-1.5 text-right">{typeof d.value === "number" && d.value <= 1 ? fmtPct(d.value, false) : d.value}</td>
                  <td className="px-3 py-1.5 text-xs text-muted">{d.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function ShareList({ rows, color = SERIES[0] }: { rows: { name: string; share: number | null }[]; color?: string }) {
  const max = Math.max(...rows.map((r) => r.share ?? 0));
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,7rem)_1fr_3.5rem] items-center gap-2">
          <span className="truncate text-ink-2">{r.name}</span>
          <ShareBar value={r.share ?? 0} max={max} color={color} />
          <span className="text-right tabular text-ink-2">{fmtPct(r.share, false)}</span>
        </li>
      ))}
    </ul>
  );
}

// --- 7. search interest ----------------------------------------------------------------------------

export function TrendsChart({ years, keywords, highlight, height = 240 }: {
  years: number[]; keywords: Record<string, (number | null)[]>; highlight?: string; height?: number;
}) {
  const names = Object.keys(keywords);
  const data = years.map((y, i) => ({ year: String(y), ...Object.fromEntries(names.map((k) => [k, keywords[k][i]])) }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="year" {...axis} />
          <YAxis width={32} axisLine={false} {...axis} />
          <Tooltip contentStyle={tooltipBox} formatter={(v: number, n: string) => [v?.toFixed(1), n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {names.map((k, i) => (
            <Line key={k} dataKey={k} name={k} stroke={SERIES[i % SERIES.length]} isAnimationActive={false}
              strokeWidth={highlight && k !== highlight ? 1.5 : 2.5} strokeOpacity={highlight && k !== highlight ? 0.55 : 1} dot={{ r: 3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendsSection({ t }: { t: NonNullable<AppIntel["trends"]> }) {
  return (
    <Section title="Пошуковий інтерес · Google Trends (США)">
      <Card>
        <div className="font-medium text-ink">«{t.keyword}» порівняно з {Object.keys(t.compare).filter((k) => k !== t.keyword).map((k) => `«${k}»`).join(", ")}</div>
        <div className="mb-2 text-xs text-muted">{t.source} · відносний інтерес 0–100 у межах одного порівняння (не кількість пошуків)</div>
        <TrendsChart years={t.years.map((y) => y.year)} keywords={t.compare} highlight={t.keyword} />
        {t.note && <p className="mt-2 text-sm text-ink-2">{t.note}</p>}
      </Card>
    </Section>
  );
}

// --- 8. deals & finance ----------------------------------------------------------------------------

export function SecTable({ rows }: { rows: NonNullable<AppIntel["sec"]> }) {
  const cols = ["FY2024", "FY2025", "Q2 2025", "Q2 2026"];
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
      <table className="tabular w-full min-w-[720px] text-sm">
        <caption className="px-3 pt-3 text-left text-xs text-muted">
          WEBTOON Entertainment — звітність SEC (8-K, 10-K) і Nasdaq Key Metrics · уся компанія (Корея, Японія, решта світу; застосунки й веб) · USD.
          Це виручка компанії за звітністю, не оцінка Sensor Tower — не порівнювати напряму й не сумувати.
        </caption>
        <thead className="text-left text-ink-2">
          <tr className="border-b border-hairline">
            <th className="px-3 py-2 font-medium">Показник</th>
            {cols.map((c) => <th key={c} className="px-3 py-2 text-right font-medium">{c}</th>)}
            <th className="px-3 py-2 font-medium">Коментар</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.metric} className="border-b border-hairline last:border-0 align-top">
              <td className="px-3 py-1.5 text-ink" title={r.source ?? undefined}>{r.metric}</td>
              {cols.map((c) => <td key={c} className="px-3 py-1.5 text-right">{r.values[c] ?? ""}</td>)}
              <td className="px-3 py-1.5 text-xs text-muted">{r.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DealsList({ deals, className = "space-y-2" }: { deals: NonNullable<AppIntel["deals"]>; className?: string }) {
  return (
    <ul className={`text-sm ${className}`}>
      {deals.map((d, i) => (
        <li key={i} className="rounded-lg border border-hairline bg-surface p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-ink">{d.event}</span>
            <span className="tabular text-ink">{d.amount_usd == null ? "сума не розкрита" : d.amount_usd >= 1e9 ? `$${(d.amount_usd / 1e9).toFixed(2)}B` : fmtM(d.amount_usd)}</span>
          </div>
          <div className="text-xs text-muted">{[d.date, d.type, d.party, d.source && `джерело: ${d.source}`].filter(Boolean).join(" · ")}</div>
          {d.note && <div className="mt-1 text-ink-2">{d.note}</div>}
        </li>
      ))}
    </ul>
  );
}

// --- page -----------------------------------------------------------------------------------------

export function AppIntelSections({ intel, st }: { intel: AppIntel; st: StLatest | null }) {
  const metaSpend = intel.estimates?.find((e) => e.meta_spend_30d != null);
  const gpRating = intel.store_listings?.find((l) => l.store === "android")?.rating ?? intel.store_us?.gp_rating ?? null;
  return (
    <div className="space-y-8">
      {intel.profile?.note && (
        <Card className="text-sm">
          <div className="text-xs text-muted">Нотатка з ручного збору ({dateLabel(intel.profile.as_of)}){intel.profile.owner ? ` · власник: ${intel.profile.owner}` : ""}</div>
          <p className="mt-1 text-ink">{intel.profile.note}</p>
        </Card>
      )}
      {intel.estimates && intel.estimates.length > 0 && <EstimatesSection est={intel.estimates} st={st} />}
      {intel.monetization && <MonetizationSection m={intel.monetization} description={intel.store_description} />}
      {intel.reviews && <ReviewsSection r={intel.reviews} storeRating={gpRating} />}
      {intel.ads && <AdsSection ads={intel.ads} metaSpend={metaSpend} />}
      {intel.store_listings || intel.store_us?.gp_rating != null || intel.store_us?.ios_rating != null
        ? <StoresSection intel={intel} />
        : intel.store_us?.gp_note && <Note>Google Play (США), {dateLabel(intel.store_us.as_of)}: {intel.store_us.gp_note}</Note>}
      {intel.web && intel.web.visits != null && <WebSection w={intel.web} />}
      {intel.trends && <TrendsSection t={intel.trends} />}
      {(intel.deals || intel.sec) && (
        <Section title="Угоди і фінанси">
          {intel.deals && <DealsList deals={intel.deals} />}
          {intel.sec && <SecTable rows={intel.sec} />}
        </Section>
      )}
      {(intel.overlap || intel.similar_apps || intel.creators) && (
        <Section title="Конкуренти й аудиторія">
          <div className="grid gap-4 lg:grid-cols-3">
            {intel.overlap && (
              <Card>
                <div className="mb-2 font-medium text-ink">Перетин аудиторії (AppMagic)</div>
                <ShareList rows={intel.overlap.map((o) => ({ name: o.competitor, share: o.overlap }))} color={SERIES[6]} />
                <div className="mt-2 text-xs text-muted">AppMagic (демо), overlap score · видно 3 з 30 конкурентів</div>
              </Card>
            )}
            {intel.similar_apps && (
              <Card className="text-sm">
                <div className="mb-2 font-medium text-ink">«Схожі застосунки» (AppMagic)</div>
                <div className="flex flex-wrap gap-1">{intel.similar_apps.map((s) => <span key={s} className="rounded bg-grid px-1.5 py-0.5 text-ink-2">{s}</span>)}</div>
              </Card>
            )}
            {intel.creators && (
              <Card className="text-sm">
                <div className="mb-2 font-medium text-ink">Креатори</div>
                <ul className="space-y-1">
                  {intel.creators.map((c) => (
                    <li key={c.creator} className="flex justify-between gap-2">
                      <span className="truncate text-ink">{c.creator}</span>
                      <span className="shrink-0 tabular text-ink-2">{fmtCompact(c.subscribers)} підписників · {c.platform}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-xs text-muted">AppKittie, {dateLabel(intel.creators[0].as_of)}</div>
              </Card>
            )}
          </div>
        </Section>
      )}
      {intel.paywalls && (
        <Section title="Пейвол">
          {intel.paywalls.map((p) => (
            <div key={p.app_name} className="space-y-2">
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {p.shots.map((s) => <li key={s.src}><Media m={s} alt={`Екран ${p.app_name}`} aspect="aspect-[9/16]" /></li>)}
              </ul>
              <Note>Скріни пейволу · {p.app_name} · {p.source}, {dateLabel(p.as_of)}</Note>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
