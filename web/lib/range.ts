"use client";

import { useState } from "react";
import { monthLabel } from "./labels";

export const RANGE_PRESETS = [
  { label: "12 міс.", months: 12 },
  { label: "3 роки", months: 36 },
  { label: "5 років", months: 60 },
  { label: "Усе", months: 0 },
];

/** The last N months (0 = all) of a sorted list of YYYY-MM months, shared by several charts. */
export function useMonthRange(months: string[], defaultMonths = 0) {
  const [preset, setPreset] = useState(defaultMonths);
  const n = months.length;
  const start = preset ? Math.max(0, n - preset) : 0;
  const end = Math.max(0, n - 1);
  return {
    preset,
    choosePreset: setPreset,
    slice: <T,>(rows: T[]) => rows.slice(start, end + 1),
    label: n ? `${monthLabel(months[start])} – ${monthLabel(months[end])}` : "",
  };
}

export type MonthRange = ReturnType<typeof useMonthRange>;
