import { CatalogView } from "@/components/CatalogView";
import { loadCatalog, loadCountryByApp, loadIntelIndex, loadMetrics, loadMonthly } from "@/lib/data";

export default async function CatalogPage() {
  const [catalog, metrics, monthly, intel, countries] = await Promise.all([
    loadCatalog(), loadMetrics(), loadMonthly(), loadIntelIndex(), loadCountryByApp(),
  ]);
  return <CatalogView catalog={catalog} metrics={metrics} monthly={monthly} intel={intel.apps} countries={countries} />;
}
