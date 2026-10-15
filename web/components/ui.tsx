import type { ReactNode } from "react";
import { GROWTH_LABEL, REGION_LABEL, SEGMENT_LABEL, SEGMENT_ORDER, STATUS_LABEL, metricLabel, type MetricContext } from "@/lib/labels";
import { RANGE_PRESETS, type MonthRange } from "@/lib/range";
import type { GrowthStatus, LifecycleStatus, Segment } from "@/lib/types";

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
export const OTHER = "var(--series-other)";

/** Segments always wear the same color, in fixed slot order. */
export function segmentColor(s: Segment | null | undefined): string {
  const i = s ? SEGMENT_ORDER.indexOf(s) : -1;
  return i >= 0 ? SERIES[i] : OTHER;
}

interface MetricProps {
  label: string;
  value: string;
  /** Required: every number states period, region and net/gross. */
  context: MetricContext;
  sub?: ReactNode;
}

export function Metric({ label, value, context, sub }: MetricProps) {
  const long = value.length > 14; // e.g. an app name in the "leader" card
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <div className="text-sm text-ink-2">{label}</div>
      <div className={`mt-1 font-semibold text-ink ${long ? "text-lg leading-snug" : "text-2xl sm:text-3xl"}`}>{value}</div>
      {sub && <div className="mt-1 text-sm text-ink-2">{sub}</div>}
      <div className="mt-2 text-xs text-muted">{metricLabel(context)}</div>
    </div>
  );
}

/** `unit="count"` for non-money charts (downloads, shares): net/gross does not apply and is not shown. */
export function ChartFrame({ title, context, note, unit = "money", children }: {
  title: string; context: MetricContext; note?: string; unit?: "money" | "count"; children: ReactNode;
}) {
  return (
    <figure className="rounded-lg border border-hairline bg-surface p-4">
      <figcaption className="mb-3">
        <div className="font-medium text-ink">{title}</div>
        <div className="text-xs text-muted">
          {unit === "money" ? metricLabel(context) : `${context.period} · ${REGION_LABEL[context.region]}`}
          {note}
        </div>
      </figcaption>
      {children}
    </figure>
  );
}

export function SegmentBadge({ segment }: { segment: Segment | null }) {
  if (!segment) return <span className="text-xs text-muted">без сегмента</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5 text-xs text-ink-2">
      <span className="h-2 w-2 rounded-full" style={{ background: segmentColor(segment) }} aria-hidden />
      {SEGMENT_LABEL[segment]}
    </span>
  );
}

const STATUS_STYLE: Record<LifecycleStatus, { color: string; icon: string }> = {
  active: { color: "var(--good)", icon: "●" },
  newcomer: { color: "var(--accent)", icon: "✦" },
  declining: { color: "var(--warning)", icon: "↘" },
  closing: { color: "var(--serious)", icon: "⏳" },
  closed: { color: "var(--critical)", icon: "✕" },
};

/** Status colors always come with an icon and a label (never color alone). */
export function StatusBadge({ status }: { status: LifecycleStatus | null }) {
  if (!status) return null;
  const s = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-xs text-ink">
      <span style={{ color: s.color }} aria-hidden>
        {s.icon}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

const GROWTH_ICON: Record<GrowthStatus, string> = { growing: "▲", stable: "■", declining: "▼" };
const GROWTH_COLOR: Record<GrowthStatus, string> = { growing: "var(--good)", stable: "var(--muted)", declining: "var(--critical)" };

export function GrowthBadge({ status }: { status: GrowthStatus | null | undefined }) {
  if (!status) return <span className="text-xs text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-ink">
      <span style={{ color: GROWTH_COLOR[status] }} aria-hidden>
        {GROWTH_ICON[status]}
      </span>
      {GROWTH_LABEL[status]}
    </span>
  );
}

export function AppIcon({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  if (!src)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-grid text-xs font-semibold text-ink-2"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {name.slice(0, 1)}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-lg" style={{ width: size, height: size }} />;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ExtLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function RangeButtons({ range }: { range: MonthRange }) {
  return (
    <div role="group" aria-label="Період на графіку" className="inline-flex flex-wrap items-center gap-1 text-xs">
      <span className="mr-1 text-muted">Період:</span>
      {RANGE_PRESETS.map((p) => (
        <button key={p.label} type="button" onClick={() => range.choosePreset(p.months)} aria-pressed={range.preset === p.months}
          className={`rounded-md border border-hairline px-2 py-1 ${range.preset === p.months ? "bg-ink text-page" : "bg-surface text-ink-2"}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Country flag (SVG from flag-icons, copied to public/flags by `npm run flags`) + optional name. */
export function Flag({ code, size = 16 }: { code: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/flags/${code.toLowerCase()}.svg`} alt="" width={Math.round(size * 4 / 3)} height={size}
    className="inline-block shrink-0 rounded-[2px] ring-1 ring-hairline" style={{ width: Math.round(size * 4 / 3), height: size }} />;
}
