import { CatalogView } from "@/components/CatalogView";
import { loadCatalog, loadMetrics, loadMonthly } from "@/lib/data";

export default async function CatalogPage() {
  const [catalog, metrics, monthly] = await Promise.all([loadCatalog(), loadMetrics(), loadMonthly()]);
  return <CatalogView catalog={catalog} metrics={metrics} monthly={monthly} />;
}
