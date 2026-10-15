// Shapes of the JSON files in public/data (written by the Python pipeline).

export type Region = "world" | "us" | "tier1";
export type Basis = "net" | "gross";
export type Segment =
  | "webtoon_platform" | "manga" | "western_comics" | "webnovel" | "short_drama" | "ai_comic_drama" | "piracy";
export type LifecycleStatus = "active" | "declining" | "closing" | "closed" | "newcomer";
export type GrowthStatus = "growing" | "stable" | "declining";

export interface Coverage {
  granularity: string;
  start: string;
  end: string;
  regions: string;
  file: string;
}

export interface CatalogApp {
  slug: string;
  display_name: string;
  unified_id: string | null;
  unified_name: string | null;
  ios_ids: string[];
  android_packages: string[];
  developer: string | null;
  publisher: string | null;
  company: string | null;
  parent: string | null;
  segment: Segment | null;
  ios_category: string | null;
  status: LifecycleStatus | null;
  status_note: string | null;
  shortlist: boolean;
  markets: string | null;
  monetization: string | null;
  website: string | null;
  app_store_url: string | null;
  google_play_url: string | null;
  icon_path: string | null;
  rating: number | null;
  rating_count: number | null;
  rating_store: string | null;
  release_date: string | null;
  in_registry: boolean;
  has_data: boolean;
  data_coverage: Coverage[];
}

export interface Catalog {
  generated_at: string;
  segments: Segment[];
  statuses: LifecycleStatus[];
  apps: CatalogApp[];
}

export interface DataMeta {
  generated_at: string;
  source: string;
  currency: "USD";
  revenue_basis: "net";
  gross_estimate: string;
  period_end: string; // YYYY-MM
  l12m: string; // "YYYY-MM..YYYY-MM"
  regions: Record<Region, string>;
  region_countries?: Partial<Record<Region, string[] | null>>;
  notes: string[];
}

export interface Series {
  months: string[];
  revenue_net: (number | null)[];
  downloads: (number | null)[];
  granularity: string[];
  partial: boolean[];
}

export interface MonthlyByApp {
  meta: DataMeta;
  apps: Record<string, Record<Region, Series>>;
}

export interface YearMetric {
  year: number;
  revenue_net: number | null;
  downloads: number | null;
  months: number;
  partial_year: boolean;
  period: string;
  yoy: number | null;
  yoy_basis: string | null;
  rpd: number | null;
}

export interface AppMetrics {
  data_start: string;
  data_end: string;
  revenue_from: string | null;
  l12m: {
    period: string;
    revenue_net: number | null;
    downloads: number | null;
    rpd: number | null;
    complete: boolean;
    prev_period: string;
    prev_revenue_net: number | null;
    yoy: number | null;
  };
  status: GrowthStatus | null;
  mom: { month: string; revenue_net: number | null; prev_revenue_net: number | null; change: number | null };
  years: YearMetric[];
  cagr: { from: number; to: number; value: number } | null;
  share_l12m: { of_dataset: number | null; of_core: number | null; of_segment: number | null };
  peak: { month: string | null; revenue_net: number | null; drawdown_from_peak: number | null };
  months_since_launch: number | null;
  launch_month: string | null;
  launch_basis: string | null;
  arr_10m_within_36m: {
    target_arr: number;
    window_months: number;
    launch_month: string | null;
    launch_basis: string | null;
    reached: boolean | null;
    month_reached: string | null;
    months_to_reach: number | null;
    note: string | null;
  };
}

export interface Metrics {
  meta: { generated_at: string; period_end: string; l12m: string; core_segments: Segment[]; definitions: Record<string, string> };
  apps: Record<string, { segment: Segment | null } & Partial<Record<Region, AppMetrics>>>;
}

export interface CountryRow {
  country: string;
  revenue_net: number | null;
  downloads: number | null;
  share: number | null;
}

export interface ByCountry {
  meta: DataMeta & { app: string };
  all_time: { period: string; total_revenue_net: number | null; countries: CountryRow[] };
  l12m: { period: string; total_revenue_net: number | null; countries: CountryRow[] };
}

export interface PlatformSplit {
  meta: DataMeta;
  apps: Record<string, Record<Region, { yearly: ({ year: number } & Record<string, number | null>)[]; l12m: Record<string, number | null> }>>;
}

export interface UsSnapshotApp {
  app_slug: string;
  segment: Segment | null;
  days: number;
  revenue_net: number | null;
  downloads: number | null;
  run_rate_revenue_net: number | null;
  run_rate_revenue_gross_low: number | null;
  run_rate_revenue_gross_high: number | null;
  by_platform: Record<string, number | null>;
}

export interface UsSnapshot {
  meta: DataMeta & { region: "US"; period: string; run_rate: string };
  apps: UsSnapshotApp[];
}

export interface DataSources {
  generated_at: string;
  raw_files_scanned: number | null;
  byte_identical_duplicates: number | null;
  excluded: { file: string | null; reason: string | null }[];
  files_used: {
    file: string;
    apps: string[];
    countries: number;
    us_snapshot: boolean;
    granularity: { granularity: string; start: string; end: string }[];
    rows: number;
  }[];
}

/** country_by_app.json: per app, per country -> [revenue_net_l12m, revenue_net_prev_12m, revenue_net_all_time, downloads_l12m] */
export interface CountryByApp {
  meta: DataMeta & { prev12: string; columns: string[] };
  apps: Record<string, Record<string, [number | null, number | null, number | null, number | null]>>;
}
