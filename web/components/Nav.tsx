"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useControls } from "@/lib/controls";
import { CORE_SEGMENTS, DEFAULT_SEGMENTS, SEGMENT_LABEL, TIER1_NOTE, VIDEO_SEGMENTS } from "@/lib/labels";
import type { Segment } from "@/lib/types";
import { segmentColor } from "./ui";

const LINKS = [
  { href: "/", label: "Огляд" },
  { href: "/catalog/", label: "Каталог" },
  { href: "/compare/", label: "Порівняння" },
  { href: "/us-2026-09/", label: "США, вересень 2026" },
  { href: "/about/", label: "Про дані" },
];

function Toggle<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-hairline bg-surface p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-2.5 py-1 ${value === o.value ? "bg-ink text-page" : "text-ink-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Nav() {
  const path = usePathname();
  const { basis, setBasis, region, setRegion, segments, setSegments } = useControls();
  const video = VIDEO_SEGMENTS.every((s) => segments.includes(s));
  const nonVideo = segments.filter((s) => !VIDEO_SEGMENTS.includes(s));
  const isCore = nonVideo.length === CORE_SEGMENTS.length && CORE_SEGMENTS.every((s) => nonVideo.includes(s));
  const isAll = nonVideo.length === DEFAULT_SEGMENTS.length;
  const withVideo = (base: Segment[], on: boolean) => (on ? [...base, ...VIDEO_SEGMENTS] : base);
  const setVideo = (on: boolean) => setSegments(withVideo(nonVideo.length ? nonVideo : DEFAULT_SEGMENTS, on));
  const toggleSeg = (s: Segment) =>
    setSegments(segments.includes(s)
      ? (nonVideo.length > 1 ? segments.filter((x) => x !== s) : segments)
      : [...segments, s]);

  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-page">
      <div className="mx-auto max-w-7xl space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="font-semibold">
            Ринок комікс-застосунків
          </Link>
          <nav className="-mx-1 flex max-w-full gap-1 overflow-x-auto text-sm">
            {LINKS.map((l) => {
              const on = l.href === "/" ? path === "/" : path.startsWith(l.href.replace(/\/$/, ""));
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`whitespace-nowrap rounded-md px-2 py-1 ${on ? "bg-surface font-medium text-ink ring-1 ring-hairline" : "text-ink-2 hover:text-ink"}`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle label="Виручка" value={basis} onChange={setBasis}
            options={[{ value: "net", label: "Net" }, { value: "gross", label: "Gross (оцінка)" }]} />
          <Toggle label="Регіон" value={region} onChange={setRegion}
            options={[{ value: "world", label: "Світ" }, { value: "us", label: "США" }, { value: "tier1", label: "Tier-1" }]} />
          {region === "tier1" && <span className="text-xs text-muted" title={TIER1_NOTE}>20 країн ⓘ</span>}
          <Toggle label="Відео-формати (short drama, AI comic drama)" value={video ? "on" : "off"} onChange={(v) => setVideo(v === "on")}
            options={[{ value: "off", label: "Без відео" }, { value: "on", label: "З відео (short drama)" }]} />
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button type="button" onClick={() => setSegments(withVideo(DEFAULT_SEGMENTS, video))} aria-pressed={isAll}
              className={`rounded-md border border-hairline px-2 py-1 ${isAll ? "bg-ink text-page" : "bg-surface text-ink-2"}`}>
              Усі сегменти
            </button>
            <button type="button" onClick={() => setSegments(withVideo(CORE_SEGMENTS, video))} aria-pressed={isCore}
              className={`rounded-md border border-hairline px-2 py-1 ${isCore ? "bg-ink text-page" : "bg-surface text-ink-2"}`}>
              Лише комікси
            </button>
            {DEFAULT_SEGMENTS.map((s) => (
              <button key={s} type="button" onClick={() => toggleSeg(s)} aria-pressed={segments.includes(s)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${segments.includes(s) ? "border-hairline bg-surface text-ink" : "border-transparent text-muted line-through"}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: segmentColor(s) }} aria-hidden />
                {SEGMENT_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
