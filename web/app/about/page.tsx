import { loadDataSources, loadMonthly } from "@/lib/data";
import { TIER1_NOTE, periodLabel } from "@/lib/labels";

export const metadata = { title: "Про дані · Ринок комікс-застосунків" };

const GRAN: Record<string, string> = { monthly: "місячні", weekly: "тижневі", daily: "денні" };

export default async function AboutPage() {
  const [sources, monthly] = await Promise.all([loadDataSources(), loadMonthly()]);
  const meta = monthly.meta;
  return (
    <article className="max-w-3xl space-y-6 text-sm leading-relaxed text-ink-2">
      <h1 className="text-2xl font-semibold text-ink">Про дані</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">Джерело</h2>
        <p>
          Усі цифри — оцінки <b>Sensor Tower</b> (експорти «Unified», App Store + Google Play, iPhone/iPad/Android),
          у доларах США. Дані до <b>{periodLabel(meta.period_end)}</b> включно; L12M = {periodLabel(meta.l12m)}.
          Інші джерела (AppKittie, AppMagic, внутрішні дані) будуть показані поруч, з підписом, і ніколи не сумуються з Sensor Tower.
        </p>
        <p>«Світ» = сума країн, що є в експорті (до 112; у Shonen Jump лише 39). «США» = рядки країни US.</p>
        <p>{TIER1_NOTE}. Список можна змінити в <code>data/catalog/regions.json</code> (потім <code>make build-data</code>).</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">Net і gross</h2>
        <p>
          Виручка Sensor Tower — <b>net</b>: після комісії Apple/Google. Режим <b>Gross</b> — лише <b>оцінка</b>:
          діапазон net ÷ 0,85 (комісія 15%) … net ÷ 0,70 (комісія 30%). На графіках у режимі gross відкладено нижню межу,
          а підказки показують увесь діапазон. Net і gross ніколи не додаються одне до одного.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-ink">Гранулярність</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Для кожного застосунку й місяця береться <b>одна</b> гранулярність: місячні &gt; тижневі &gt; денні. Вони ніколи не сумуються між собою.</li>
          <li>Тижневі значення розподіляються по днях (1/7 на день) і потрапляють у той місяць, до якого належить кожен день.
            Тому місяці з 4 і 5 тижнями порівнювані. Приклад: тиждень з 29.12.2025 — 3/7 у грудні (відкинуто, бо грудень є в місячних даних) і 4/7 у січні.</li>
          <li>Денні дані США за 13–30.09.2026 — окремий знімок (сторінка «США, вересень 2026»), не частина місячних рядів.</li>
          <li>Неповні місяці позначені як partial; місяці після останнього повного ({periodLabel(meta.period_end)}) відкинуто.</li>
          <li>2019–2020 — обережно: майже всі застосунки ростуть у 3–10 разів до 2021 (на обох платформах). Частково це реальний
            пандемічний бум, але може бути й нарощування покриття моделі Sensor Tower; порівнюйте з 2021 і пізніше.</li>
          <li>Нульова виручка в ранні роки (наприклад, WEBTOON до 2019) означає, що Sensor Tower не мав оцінки, а не нульові продажі.
            Тому «місяців від запуску» й «$10M ARR за 36 міс.» позначені як «невідомо», якщо дані почалися пізніше за запуск.</li>
        </ul>
      </section>

      {sources && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">Аудит файлів</h2>
          <p>
            Проскановано {sources.raw_files_scanned ?? "—"} файлів; {sources.byte_identical_duplicates ?? "—"} — побайтові дублікати
            (експорти «Revenue» і «Downloads» Sensor Tower однакові), їх не враховано. Використано {sources.files_used.length} файлів.
          </p>
          {sources.excluded.length > 0 && (
            <p>Виключено: {sources.excluded.map((e) => `${e.file} — ${e.reason}`).join("; ")}.</p>
          )}
          <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="tabular w-full min-w-[640px] text-xs">
              <thead className="text-left text-ink-2">
                <tr className="border-b border-hairline">
                  <th className="px-3 py-2 font-medium">Застосунок</th>
                  <th className="px-3 py-2 font-medium">Дані</th>
                  <th className="px-3 py-2 text-right font-medium">Країн</th>
                  <th className="px-3 py-2 font-medium">Файл</th>
                </tr>
              </thead>
              <tbody>
                {[...sources.files_used].sort((a, b) => a.apps[0].localeCompare(b.apps[0])).map((f) => (
                  <tr key={f.file} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-1.5 text-ink">{f.apps.join(", ")}</td>
                    <td className="px-3 py-1.5">
                      {f.granularity.map((g) => `${GRAN[g.granularity] ?? g.granularity} ${g.start}…${g.end}`).join("; ")}
                      {f.us_snapshot ? " (знімок США)" : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right">{f.countries}</td>
                    <td className="max-w-[260px] truncate px-3 py-1.5 text-muted" title={f.file}>{f.file}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-muted">Згенеровано {meta.generated_at.slice(0, 10)} пайплайном `make build-data`.</p>
    </article>
  );
}
