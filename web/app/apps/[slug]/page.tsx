import { notFound } from "next/navigation";
import { AppView } from "@/components/AppView";
import { loadByCountry, loadCatalog, loadIntel, loadIntelIndex, loadMetrics, loadMonthly, loadPlatformSplit } from "@/lib/data";

export async function generateStaticParams() {
  const [catalog, index] = await Promise.all([loadCatalog(), loadIntelIndex()]);
  // Sensor Tower apps, plus apps that only have data from other sources (AppKittie, reviews, Similarweb…)
  return catalog.apps.filter((a) => a.has_data || index.apps[a.slug]).map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const app = (await loadCatalog()).apps.find((a) => a.slug === params.slug);
  return { title: app ? `${app.display_name} · Ринок комікс-застосунків` : "Застосунок" };
}

export default async function AppPage({ params }: { params: { slug: string } }) {
  const [catalog, monthly, metrics, split, byCountry, intel] = await Promise.all([
    loadCatalog(), loadMonthly(), loadMetrics(), loadPlatformSplit(), loadByCountry(params.slug), loadIntel(params.slug),
  ]);
  const app = catalog.apps.find((a) => a.slug === params.slug);
  if (!app) notFound();
  const { segment: _segment, ...appMetrics } = metrics.apps[app.slug] ?? { segment: null };
  return (
    <AppView
      app={app}
      series={monthly.apps[app.slug] ?? {}}
      metrics={appMetrics}
      byCountry={byCountry}
      platform={split.apps[app.slug] ?? {}}
      intel={intel}
    />
  );
}
