import { CompareView } from "@/components/CompareView";
import { loadCatalog, loadMetrics, loadMonthly } from "@/lib/data";

export default async function ComparePage() {
  const [catalog, monthly, metrics] = await Promise.all([loadCatalog(), loadMonthly(), loadMetrics()]);
  return <CompareView catalog={catalog} monthly={monthly} metrics={metrics} />;
}
