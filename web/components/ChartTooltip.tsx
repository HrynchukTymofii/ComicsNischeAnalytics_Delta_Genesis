"use client";

import type { TooltipProps } from "recharts";
import { GROSS_LOW_DIVISOR, fmtMoney, monthLabel } from "@/lib/labels";
import type { Basis } from "@/lib/types";

/**
 * Tooltip for money charts. Plotted values are net (or the gross lower bound); the tooltip converts
 * back to net and shows the value in the active basis, so gross reads as a range.
 */
export function MoneyTooltip({
  active, payload, label, basis, labelFormat = monthLabel, footer, colors, rowColor, showTotal = true,
}: TooltipProps<number, string> & {
  basis: Basis; labelFormat?: (l: string) => string; footer?: string; showTotal?: boolean;
  /** dataKey -> colour of that series, so each row shows the same colour as the chart */
  colors?: Record<string, string>;
  /** for bars coloured per row (Cell): colour from the data row */
  rowColor?: (row: Record<string, unknown>) => string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null && p.value !== 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const toNet = (v: number) => (basis === "net" ? v : v * GROSS_LOW_DIVISOR);
  const total = rows.reduce((s, p) => s + toNet(p.value ?? 0), 0);
  return (
    <div className="max-w-xs rounded-lg border border-hairline bg-surface p-3 text-xs shadow-sm">
      <div className="mb-1 font-medium text-ink">{labelFormat(String(label))}</div>
      <table className="tabular w-full">
        <tbody>
          {rows.map((p) => (
            <tr key={String(p.dataKey)}>
              <td className="pr-2">
                <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                  style={{ background: colors?.[String(p.dataKey)] ?? rowColor?.(p.payload) ?? p.color }} aria-hidden />
                <span className="text-ink-2">{p.name}</span>
              </td>
              <td className="text-right text-ink">{fmtMoney(toNet(p.value ?? 0), basis)}</td>
            </tr>
          ))}
          {showTotal && rows.length > 1 && (
            <tr className="border-t border-hairline">
              <td className="pt-1 text-ink-2">Разом</td>
              <td className="pt-1 text-right font-medium text-ink">{fmtMoney(total, basis)}</td>
            </tr>
          )}
        </tbody>
      </table>
      {footer && <div className="mt-1 text-muted">{footer}</div>}
    </div>
  );
}
