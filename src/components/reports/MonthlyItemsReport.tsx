import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileSpreadsheet, Package } from 'lucide-react';
import { db } from '../../db/posDatabase';
import { formatCents, generateMonthlyItemReport, getLocalDateString } from '../../domain/calculations';

function getCurrentMonth(): string {
  return getLocalDateString(new Date().toISOString()).slice(0, 7);
}

function formatMonth(month: string): string {
  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  }).format(new Date(`${month}-01T12:00:00`));
}

export const MonthlyItemsReport: React.FC = () => {
  const items = useLiveQuery(() => db.order_items.toArray()) ?? [];
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);

  const availableMonths = useMemo(() => {
    const months = new Set(
      items
        .filter((item) => item.delivery_status !== 'cancelled')
        .map((item) => getLocalDateString(item.created_at).slice(0, 7))
    );
    months.add(getCurrentMonth());
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [items]);

  const products = useMemo(
    () => generateMonthlyItemReport(selectedMonth, items),
    [selectedMonth, items]
  );
  const totalItems = products.reduce((sum, product) => sum + product.itemsCount, 0);
  const totalCents = products.reduce((sum, product) => sum + product.totalCents, 0);

  const handleExportCsv = () => {
    const rows = [
      [`Měsíční přehled položek: ${selectedMonth}`],
      ['Položka', 'Počet kusů', 'Celkem (Kč)'],
      ...products.map((product) => [
        product.productName,
        String(product.itemsCount),
        (product.totalCents / 100).toFixed(2),
      ]),
      ['Celkem', String(totalItems), (totalCents / 100).toFixed(2)],
    ];
    const csv = rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mesicni-prehled-${selectedMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="bg-white rounded-2xl border border-parchment-300 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-parchment-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-parchment-50/70">
        <div>
          <h3 className="font-bold text-base text-ink-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-tea-600" />
            Měsíční přehled položek
          </h3>
          <p className="text-xs text-ink-500 mt-1">
            Počty a hodnota položek podle dne, kdy byly přidány do účtu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="monthly-items-month" className="text-xs font-semibold text-ink-600">
            Měsíc
          </label>
          <select
            id="monthly-items-month"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="bg-white border border-parchment-300 rounded-xl px-3 py-2 text-sm font-semibold text-ink-800"
          >
            {availableMonths.map((month) => (
              <option key={month} value={month}>{formatMonth(month)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-parchment-200 border border-parchment-300 text-ink-700 text-xs font-semibold hover:bg-parchment-300 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-tea-700" />
            <Download className="w-3.5 h-3.5 text-tea-700" />
            CSV
          </button>
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap gap-6 mb-4 text-sm">
          <div>
            <span className="text-ink-500">Prodané kusy</span>
            <strong className="ml-2 text-ink-900">{totalItems}</strong>
          </div>
          <div>
            <span className="text-ink-500">Hodnota položek</span>
            <strong className="ml-2 text-tea-700">{formatCents(totalCents)}</strong>
          </div>
        </div>

        {products.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-400">
            V tomto měsíci nebyly přidány žádné položky.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-parchment-200 text-xs uppercase text-ink-500">
                  <th className="py-2 pr-4">Položka</th>
                  <th className="py-2 px-4 text-right">Počet kusů</th>
                  <th className="py-2 pl-4 text-right">Celkem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment-100">
                {products.map((product) => (
                  <tr key={product.productName}>
                    <td className="py-3 pr-4 font-medium text-ink-800">{product.productName}</td>
                    <td className="py-3 px-4 text-right text-ink-600">{product.itemsCount}</td>
                    <td className="py-3 pl-4 text-right font-semibold text-ink-900">
                      {formatCents(product.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-parchment-300 font-bold">
                  <td className="py-3 pr-4">Celkem</td>
                  <td className="py-3 px-4 text-right">{totalItems}</td>
                  <td className="py-3 pl-4 text-right">{formatCents(totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
