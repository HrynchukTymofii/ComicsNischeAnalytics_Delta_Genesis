import { UsSnapshotView } from "@/components/UsSnapshotView";
import { loadCatalog, loadUsSnapshot } from "@/lib/data";

export const metadata = { title: "США, вересень 2026 · Ринок комікс-застосунків" };

export default async function UsSnapshotPage() {
  const [catalog, snapshot] = await Promise.all([loadCatalog(), loadUsSnapshot()]);
  return <UsSnapshotView catalog={catalog} snapshot={snapshot} />;
}
