import { Overview } from "@/components/Overview";
import { loadCatalog, loadCountryByApp, loadMonthly } from "@/lib/data";

export default async function OverviewPage() {
  const [catalog, monthly, countries] = await Promise.all([loadCatalog(), loadMonthly(), loadCountryByApp()]);
  return <Overview catalog={catalog} monthly={monthly} countries={countries} />;
}
