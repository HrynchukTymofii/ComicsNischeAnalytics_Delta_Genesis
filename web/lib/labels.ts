// Every number in the UI states period, region and net/gross (CLAUDE.md rule 3).
// MetricContext is required by type wherever a number is rendered.
import type { Basis, GrowthStatus, IntelBasis, LifecycleStatus, Region, Segment, Store } from "./types";

export const GROSS_LOW_DIVISOR = 0.85; // 15% store fee
export const GROSS_HIGH_DIVISOR = 0.7; // 30% store fee

export interface MetricContext {
  period: string;
  region: Region;
  basis: Basis;
}

export const REGION_LABEL: Record<Region, string> = { world: "Світ", us: "США", tier1: "Tier-1", asia: "Азія" };
export const ASIA_NOTE = "Азія: Японія, Південна Корея, Китай, Тайвань, Гонконг, Макао, Таїланд, В'єтнам, Індонезія, Малайзія, Сінгапур, Філіппіни, Камбоджа, Лаос, М'янма, Індія, Пакистан, Бангладеш, Шрі-Ланка, Казахстан, Узбекистан (без Близького Сходу)";
export const TIER1_NOTE = "Tier-1: США, Канада, Велика Британія, Австралія, Нова Зеландія, Ірландія, Німеччина, Франція, Нідерланди, Бельгія, Австрія, Швейцарія, Люксембург, Швеція, Норвегія, Данія, Фінляндія, Японія, Південна Корея, Сінгапур";

export const BASIS_LABEL: Record<Basis, string> = {
  net: "Net (після комісії сторів)",
  gross: "Gross, оцінка (net ÷ 0,85…0,70)",
};

export const SEGMENT_LABEL: Record<Segment, string> = {
  webtoon_platform: "Вебтун-платформи",
  manga: "Манга",
  western_comics: "Західні комікси",
  webnovel: "Вебновели (суміжне)",
  short_drama: "Short drama (замінник)",
  ai_comic_drama: "AI comic drama",
  piracy: "Піратство (довідково)",
};

export const SEGMENT_ORDER: Segment[] = [
  "webtoon_platform", "manga", "western_comics", "webnovel", "short_drama", "ai_comic_drama", "piracy",
];
export const CORE_SEGMENTS: Segment[] = ["webtoon_platform", "manga", "western_comics"];
/** Video formats (not image comics). Always excluded from the dashboards; the data stays in the catalog and app pages. */
export const VIDEO_SEGMENTS: Segment[] = ["short_drama", "ai_comic_drama"];
export const DEFAULT_SEGMENTS: Segment[] = SEGMENT_ORDER.filter((s) => !VIDEO_SEGMENTS.includes(s));

export const STATUS_LABEL: Record<LifecycleStatus, string> = {
  active: "Активний",
  newcomer: "Новачок",
  declining: "Спад",
  closing: "Закривається",
  closed: "Закрито",
};

export const GROWTH_LABEL: Record<GrowthStatus, string> = {
  growing: "Зростає",
  stable: "Стабільний",
  declining: "Падає",
};

const MONTHS_UK = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_UK[m - 1]} ${y}`;
}

/** "2025-10..2026-09" -> "жов 2025 – вер 2026" */
export function periodLabel(range: string): string {
  const [a, b] = range.split("..");
  return b && a !== b ? `${monthLabel(a)} – ${monthLabel(b)}` : monthLabel(a);
}

export function metricLabel({ period, region, basis }: MetricContext): string {
  return `${period} · ${REGION_LABEL[region]} · ${BASIS_LABEL[basis]} · USD`;
}

/** $M with one decimal. Small values keep one significant decimal so they don't read as zero. */
export function fmtM(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const m = v / 1e6;
  if (m !== 0 && Math.abs(m) < 0.05) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${m.toFixed(1)}M`;
}

/** Net value, or the gross estimate range for the same net value. */
export function fmtMoney(net: number | null | undefined, basis: Basis): string {
  if (net == null || !Number.isFinite(net)) return "—";
  if (basis === "net") return fmtM(net);
  const lo = fmtM(net / GROSS_LOW_DIVISOR);
  const hi = fmtM(net / GROSS_HIGH_DIVISOR);
  return `${lo}–${hi.replace("$", "")}`;
}

/** Small dollar amounts such as revenue per download: $2.39, or the gross range $2.81–3.42. */
export function fmtUsdSmall(net: number | null | undefined, basis: Basis): string {
  if (net == null || !Number.isFinite(net)) return "—";
  if (basis === "net") return `$${net.toFixed(2)}`;
  return `$${(net / GROSS_LOW_DIVISOR).toFixed(2)}–${(net / GROSS_HIGH_DIVISOR).toFixed(2)}`;
}

/** Value plotted in charts: net, or the lower gross bound (tooltips show the full range). */
export function chartValue(net: number | null | undefined, basis: Basis): number | null {
  if (net == null) return null;
  return basis === "net" ? net : net / GROSS_LOW_DIVISOR;
}

export function chartBasisNote(basis: Basis): string {
  return basis === "net" ? "" : " · на графіку нижня межа gross (net ÷ 0,85); підказка показує діапазон";
}

export function fmtPct(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(1).replace(".", ",");
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("uk-UA");
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

/** Axis ticks: $12M, $1.5M, $300K */
export function fmtAxisUsd(v: number): string {
  if (Math.abs(v) >= 1e6) return `$${+(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

// --- Other sources (AppKittie, AppMagic, Similarweb, Google Play…): snapshots, never added to Sensor Tower.

export const STORE_LABEL: Record<Store, string> = { ios: "App Store", android: "Google Play", unknown: "стор не вказано" };

/** "2026-10-14" -> "14.10.2026" */
export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}.${m}.${y}` : iso;
}

/** Basis text for another source's money: AppKittie is net (config), AppMagic does not say. */
export function intelBasisLabel(basis: IntelBasis, ui: Basis): string {
  if (basis === null) return "net/gross не вказано джерелом";
  return ui === "net" ? "Net" : "Gross, оцінка (net ÷ 0,85…0,70)";
}

/** Money from another source. Net values follow the Net/Gross switch; unknown basis is shown as-is;
 *  lower bounds (AppMagic demo) are prefixed with "≥". */
export function fmtIntelMoney(v: number | null | undefined, basis: IntelBasis, ui: Basis, bound: "point" | "lower" = "point"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = basis === "net" ? fmtMoney(v, ui) : fmtM(v);
  return bound === "lower" ? `≥ ${s}` : s;
}

/** "AppKittie · 30 днів до 14.10.2026 · Світ · Net · USD" — the context line for every intel number. */
export function sourceLine(p: { source: string; period: string; region: string; basis?: string }): string {
  return [p.source, p.period, p.region, p.basis, p.basis && "USD"].filter(Boolean).join(" · ");
}

export function fmtUsdPrice(lo: number | null, hi?: number | null): string {
  if (lo == null) return "—";
  return hi != null && hi !== lo ? `$${lo.toFixed(2)}–${hi.toFixed(2)}` : `$${lo.toFixed(2)}`;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.replace(/\{\{[^}]*\}\}/g, "x")).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const regionNames = typeof Intl !== "undefined" ? new Intl.DisplayNames(["uk"], { type: "region" }) : null;
export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
