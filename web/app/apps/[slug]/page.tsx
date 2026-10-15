import { notFound } from "next/navigation";
import { AppView } from "@/components/AppView";
import { loadByCountry, loadCatalog, loadMetrics, loadMonthly, loadPlatformSplit } from "@/lib/data";

export async function generateStaticParams() {
  const catalog = await loadCatalog();
  return catalog.apps.filter((a) => a.has_data).map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const app = (await loadCatalog()).apps.find((a) => a.slug === params.slug);
  return { title: app ? `${app.display_name} · Ринок комікс-застосунків` : "Застосунок" };
}

export default async function AppPage({ params }: { params: { slug: string } }) {
  const [catalog, monthly, metrics, split, byCountry] = await Promise.all([
    loadCatalog(), loadMonthly(), loadMetrics(), loadPlatformSplit(), loadByCountry(params.slug),
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
    />
  );
}
