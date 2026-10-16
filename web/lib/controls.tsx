"use client";

// Global dashboard controls (Net/Gross, World/US, segments), shared by every page.
// Remembered per browser in localStorage — a convenience only; the page works without it.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_SEGMENTS } from "./labels";
import type { Basis, Region, Segment } from "./types";

interface Controls {
  basis: Basis;
  region: Region;
  segments: Segment[];
  setBasis: (b: Basis) => void;
  setRegion: (r: Region) => void;
  setSegments: (s: Segment[]) => void;
}

const KEY = "cmd.controls.v2"; // v2: video formats off by default
const Ctx = createContext<Controls | null>(null);

export function ControlsProvider({ children }: { children: ReactNode }) {
  const [basis, setBasis] = useState<Basis>("net");
  const [region, setRegion] = useState<Region>("world");
  const [segments, setSegments] = useState<Segment[]>(DEFAULT_SEGMENTS);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (saved?.basis) setBasis(saved.basis);
      if (saved?.region) setRegion(saved.region);
      // Video formats are no longer selectable: drop them from segments saved by older versions.
      const segs = Array.isArray(saved?.segments) ? saved.segments.filter((s: Segment) => DEFAULT_SEGMENTS.includes(s)) : [];
      if (segs.length) setSegments(segs);
    } catch {
      /* storage unavailable: defaults */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ basis, region, segments }));
    } catch {
      /* ignore */
    }
  }, [basis, region, segments]);

  return (
    <Ctx.Provider value={{ basis, region, segments, setBasis, setRegion, setSegments }}>{children}</Ctx.Provider>
  );
}

export function useControls(): Controls {
  const c = useContext(Ctx);
  if (!c) throw new Error("useControls outside ControlsProvider");
  return c;
}
