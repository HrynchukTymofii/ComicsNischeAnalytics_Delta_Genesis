import { MarketView } from "@/components/MarketView";
import { loadCatalog, loadMarketSignals } from "@/lib/data";

export const metadata = { title: "Ринкові сигнали · Ринок комікс-застосунків" };

export default async function MarketPage() {
  const [market, catalog] = await Promise.all([loadMarketSignals(), loadCatalog()]);
  if (!market) return <p className="text-ink-2">Немає market_signals.json — запустіть <code>make intel</code>.</p>;
  return <MarketView m={market} catalog={catalog} />;
}
