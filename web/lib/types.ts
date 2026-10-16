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

// --- Other sources (`make intel`): AppKittie, Google Play reviews, free services. Snapshots, not series.

/** "net" = set in source_config.json (AppKittie: user decision 2026-10-16); null = the source does not state it. */
export type IntelBasis = "net" | null;
export type Store = "ios" | "android" | "unknown";

export interface Estimate {
  source: "AppKittie" | "AppMagic";
  kind: "search" | "card" | "demo";
  as_of: string;
  store: Store;
  region: "world";
  period_days: number;
  period_note?: string | null;
  revenue: number | null;
  downloads: number | null;
  /** "lower" = AppMagic demo shows only "> X" */
  bound: "point" | "lower";
  revenue_basis: IntelBasis;
  meta_spend_30d?: number | null;
  queries?: string[];
  revenue_growth_30d?: number | null;
  downloads_growth_30d?: number | null;
  trend_notes?: string[];
  revenue_by_country?: string | null;
  downloads_by_country?: string | null;
}

export interface StoreListing {
  source: string; as_of: string; store: Store; app_name: string | null; category: string | null;
  rating: number | null; rating_count: number | null; release_date: string | null; updated: string | null;
}

export interface StoreUs {
  app_name: string; as_of: string; region: "US";
  gp_rating: number | null; gp_reviews: number | null; gp_installs: string | null; gp_note: string | null;
  ios_rating: number | null; ios_ratings: number | null; ios_chart: string | null; ios_iap: string | null;
}

export interface Iap {
  name: string; period: "once" | "week" | "month" | "year"; price_min: number | null; price_max: number | null;
  n_prices: number; raw: string; store: Store; source: string; as_of: string;
}

export interface Monetization {
  models: { text: string; source: string; as_of: string }[];
  iap: Iap[];
  store_iap_text: { text: string; store: Store; region: string; source: string; as_of: string }[];
}

export interface ReviewItem { date: string; stars: number; helpful: number; text: string | null; reply: string | null; topics: string[] }

export interface Reviews {
  source: string; collection: string; collected_on: string; store: Store; country: string; language: string;
  period: { from: string; to: string };
  n: number; avg_stars: number; stars: Record<"1" | "2" | "3" | "4" | "5", number>; reply_rate: number;
  monthly: { month: string; n: number; avg_stars: number }[];
  topics: { key: string; label: string; n: number; share: number; avg_stars: number }[];
  items: ReviewItem[];
}

export interface MediaRef { kind: "image" | "video"; src: string; poster: string | null }

export interface Creative {
  source: string; as_of: string; app_name: string; page: string | null; network: string | null; format: string | null;
  headline: string | null; text: string | null; cta: string | null; start: string | null; days_live: number | null;
  active: boolean; spend_30d: number | null; countries: string | null; landing_url: string | null; media: MediaRef | null;
}

export interface AdLibrary { keyword: string; active_ads: number | null; advertisers: string | null; region: string; as_of: string; source: string }

export interface Ads {
  creatives?: Creative[];
  ad_library?: AdLibrary;
  hooks?: { title: string | null; hooks: string[]; angles: string | null };
}

export interface NamedShare { name: string; share: number | null }

export interface WebTraffic {
  domain: string; slug?: string | null; type?: string | null; source?: string; period?: string; region?: string; as_of?: string;
  visits?: number | null; mom?: number | null; mobile_share?: number | null; desktop_share?: number | null;
  us_rank?: number | null; visit_duration?: string | null; pages_per_visit?: number | null; bounce_rate?: number | null;
  x_webtoons?: number | null;
  countries?: NamedShare[]; channels?: Record<string, number | null>; social?: NamedShare[]; social_note?: string | null;
  details?: { block: string; metric: string | null; value: string | number | null; comment: string | null }[];
}

export interface TrendsSet {
  title: string | null; keywords: string[]; note?: string; source: string;
  years: ({ year: number } & Record<string, number | null>)[];
}

export interface Deal {
  date: string | null; event: string | null; type: string | null; amount_usd: number | null;
  party: string | null; source: string | null; note: string | null; slugs: string[];
}

export interface SecRow {
  metric: string; values: Record<string, string | null>; numbers: Record<string, number | null>;
  comment: string | null; source: string | null;
}

export interface AppIntel {
  meta: { generated_at: string; slug: string };
  estimates?: Estimate[];
  store_listings?: StoreListing[];
  store_us?: StoreUs;
  store_description?: { text: string; store: Store; source: string; as_of: string };
  profile?: { brand: string; type: string | null; owner: string | null; note: string | null; deals_text: string | null; source: string; as_of: string };
  monetization?: Monetization;
  reviews?: Reviews;
  ads?: Ads;
  web?: WebTraffic;
  trends?: {
    keyword: string; set: string | null; note?: string | null; source: string;
    years: { year: number; value: number | null }[]; compare: Record<string, (number | null)[]>;
  };
  overlap?: { app: string; competitor: string; competitor_slug: string | null; overlap: number | null }[];
  similar_apps?: string[];
  deals?: Deal[];
  sec?: SecRow[];
  creators?: { creator: string; platform: string | null; subscribers: number | null; country: string | null; as_of: string }[];
  paywalls?: { app_name: string; shots: MediaRef[]; source: string; as_of: string }[];
}

export interface IntelIndex { generated_at: string; apps: Record<string, string[]> }

export interface AkSearchRow {
  as_of: string; slug: string | null; app_name: string; store: Store; ak_slug: string; category: string | null;
  rating: number | null; rating_count: number | null; downloads: number | null; revenue: number | null;
  meta_spend_30d: number | null; release_date: string | null; updated: string | null; queries: string[];
}

export interface MarketSignals {
  meta: { generated_at: string };
  as_of: { free_services: string | null; appkittie: string | null };
  revenue_basis: { AppKittie: IntelBasis; AppMagic: IntelBasis };
  readme: { key: string; text: string }[];
  how_to_read: string[];
  google_trends: TrendsSet[];
  keywords: { as_of: string; store: string; region: string | null; keyword: string; popularity: number | null; difficulty: number | null; opportunity: number | null; apps_in_results: number | null }[];
  meta_ad_library: { keyword: string; active_ads: number | null; top_advertisers: string | null; region: string; as_of: string }[];
  web: WebTraffic[];
  appmagic: {
    app_name: string; slug: string | null; publisher: string | null; revenue: number | null; downloads: number | null;
    period_note: string | null; as_of: string; revenue_by_country: string | null; downloads_by_country: string | null;
  }[];
  appmagic_overlap: { app: string; app_slug: string | null; competitor: string; competitor_slug: string | null; overlap: number | null }[];
  deals: Deal[];
  sec_webtoon: SecRow[];
  alternativeto: { filter: string | null; app: string | null; likes: number | null; price: string | null; country: string | null; note: string | null }[];
  alternativeto_for: string | null;
  gaps: { service: string | null; missing: string | null; reason: string | null; fix: string | null }[];
  appkittie_search: AkSearchRow[];
  brands: { brand: string; slug: string | null; type: string | null; owner: string | null; note: string | null }[];
  sources: {
    used: { file: string; kind: string }[];
    ignored: { file: string; reason: string }[];
    excluded: { file: string; reason: string | null }[];
  };
}
