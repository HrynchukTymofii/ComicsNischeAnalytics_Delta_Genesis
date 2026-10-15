// Server-only loaders: read public/data at build time (the site is a static export).
import { promises as fs } from "fs";
import path from "path";
import type {
  ByCountry, Catalog, CountryByApp, DataSources, Metrics, MonthlyByApp, PlatformSplit, UsSnapshot,
} from "./types";

const dataDir = path.join(process.cwd(), "public", "data");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(dataDir, file), "utf-8")) as T;
}

async function readOptional<T>(file: string): Promise<T | null> {
  try {
    return await readJson<T>(file);
  } catch {
    return null;
  }
}

export const loadCatalog = () => readJson<Catalog>("apps.json");
export const loadMonthly = () => readJson<MonthlyByApp>("monthly_by_app.json");
export const loadMetrics = () => readJson<Metrics>("metrics.json");
export const loadPlatformSplit = () => readJson<PlatformSplit>("platform_split.json");
export const loadUsSnapshot = () => readOptional<UsSnapshot>("us_snapshot.json");
export const loadDataSources = () => readOptional<DataSources>("data_sources.json");
export const loadByCountry = (slug: string) => readOptional<ByCountry>(`by_country_${slug}.json`);
export const loadCountryByApp = () => readOptional<CountryByApp>("country_by_app.json");
