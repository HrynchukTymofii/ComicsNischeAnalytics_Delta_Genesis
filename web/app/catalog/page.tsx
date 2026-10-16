import { CatalogView } from "@/components/CatalogView";
import { loadCatalog, loadIntelIndex, loadMetrics, loadMonthly } from "@/lib/data";

export default async function CatalogPage() {
  const [catalog, metrics, monthly, intel] = await Promise.all([loadCatalog(), loadMetrics(), loadMonthly(), loadIntelIndex()]);
  return <CatalogView catalog={catalog} metrics={metrics} monthly={monthly} intel={intel.apps} />;
}
