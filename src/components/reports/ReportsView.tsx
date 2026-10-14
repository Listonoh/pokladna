import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/posDatabase';
import {
  generateDailyReport,
  formatCents,
  getLocalDateString,
} from '../../domain/calculations';
import {
  Calendar,
  Banknote,
  CreditCard,
  Download,
  Receipt,
  FileSpreadsheet,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  // Dnešní datum v lokální zóně Europe/Prague (YYYY-MM-DD)
  const todayStr = getLocalDateString(new Date().toISOString());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const orders = useLiveQuery(() => db.orders.toArray()) ?? [];
  const items = useLiveQuery(() => db.order_items.toArray()) ?? [];
  const payments = useLiveQuery(() => db.payments.toArray()) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray()) ?? [];
  const products = useLiveQuery(() => db.products.toArray()) ?? [];

  const categoriesMap = new Map<string, string>();
  categories.forEach((c) => categoriesMap.set(c.id, c.name));

  const productsCategoryMap = new Map<string, string>();
  products.forEach((p) => productsCategoryMap.set(p.id, p.category_id));

  const report = generateDailyReport(
    selectedDate,
    orders,
    items,
    payments,
    categoriesMap,
    productsCategoryMap
  );

  // Export do CSV
  const handleExportCsv = () => {
    let csv = `Denní uzávěrka: ${selectedDate}\n`;
    csv += `Vygenerováno: ${new Date().toLocaleString('cs-CZ')}\n\n`;

    csv += `Finanční souhrn plateb\n`;
    csv += `Celkem přijaté platby;${report.totalPaymentsCents / 100} Kč\n`;
    csv += `Platby v hotovosti;${report.cashPaymentsCents / 100} Kč\n`;
    csv += `Platby kartou;${report.cardPaymentsCents / 100} Kč\n`;
    csv += `Hodnota prodaného zboží;${report.soldItemsValueCents / 100} Kč\n`;
    csv += `Neuhrazené zůstatky otevřených účtů;${report.unpaidReceivablesCents / 100} Kč\n\n`;

    csv += `Prodeje podle kategorií\n`;
    csv += `Kategorie;Kusů;Tržba (Kč)\n`;
    Object.values(report.categoryBreakdown).forEach((c) => {
      csv += `${c.categoryName};${c.itemsCount};${c.totalCents / 100}\n`;
    });
    csv += `\n`;

    csv += `Prodeje podle produktů\n`;
    csv += `Produkt;Kusů;Tržba (Kč)\n`;
    Object.values(report.productBreakdown).forEach((p) => {
      csv += `${p.productName};${p.itemsCount};${p.totalCents / 100}\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `uzaverka-${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export do JSON
  const handleExportJson = () => {
    const dataStr = JSON.stringify(report, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `uzaverka-${selectedDate}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-61px)] overflow-y-auto bg-parchment-100 p-6 select-none space-y-6">
      {/* Hlavička s voličem data a exporty */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-ink-900 tracking-tight flex items-center gap-2">
            <Receipt className="w-6 h-6 text-tea-600" />
            Denní přehled a statistika tržeb
          </h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Přesná evidence plateb, prodaných položek a otevřených zůstatků v čase Europe/Prague
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Volič data */}
          <div className="flex items-center space-x-2 bg-parchment-100 border border-parchment-300 px-3 py-2 rounded-xl">
            <Calendar className="w-4 h-4 text-ink-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm font-semibold text-ink-800 focus:outline-none"
            />
          </div>

          {/* Tlačítka exportu */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-parchment-200 border border-parchment-300 text-ink-700 text-xs font-semibold hover:bg-parchment-300 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-tea-700" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-parchment-200 border border-parchment-300 text-ink-700 text-xs font-semibold hover:bg-parchment-300 transition-colors"
          >
            <Download className="w-4 h-4 text-tea-700" />
            <span>JSON</span>
          </button>
        </div>
      </div>

      {/* KARTY HLAVNÍCH STATISTICKÝCH UKAZATELŮ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Celkové přijaté platby */}
        <div className="bg-white p-5 rounded-2xl border border-tea-200/80 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-tea-800">
            <span>Přijaté platby celkem</span>
            <div className="p-2 bg-tea-50 rounded-xl text-tea-600">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-tea-700">
              {formatCents(report.totalPaymentsCents)}
            </span>
            <span className="text-xs text-ink-400 block mt-1">
              Za {selectedDate} (reálně přijaté peníze)
            </span>
          </div>
        </div>

        {/* Hotovost */}
        <div className="bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-ink-600">
            <span>Platby v hotovosti</span>
            <div className="p-2 bg-tea-50 rounded-xl text-tea-600">
              <Banknote className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-ink-800">
              {formatCents(report.cashPaymentsCents)}
            </span>
            <span className="text-xs text-ink-400 block mt-1">V pokladní zásuvce</span>
          </div>
        </div>

        {/* Karta */}
        <div className="bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-ink-600">
            <span>Platby kartou</span>
            <div className="p-2 bg-tea-50 rounded-xl text-tea-600">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-ink-800">
              {formatCents(report.cardPaymentsCents)}
            </span>
            <span className="text-xs text-ink-400 block mt-1">Na bankovní účet</span>
          </div>
        </div>

        {/* Neuhrazené otevřené účty */}
        <div className="bg-white p-5 rounded-2xl border border-amberGold-500/40 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-amberGold-600">
            <span>Neuhrazené účty (dluh)</span>
            <div className="p-2 bg-amberGold-500/10 rounded-xl text-amberGold-600">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-amberGold-600">
              {formatCents(report.unpaidReceivablesCents)}
            </span>
            <span className="text-xs text-ink-400 block mt-1">
              Otevřené účty hostů na stolech
            </span>
          </div>
        </div>
      </div>

      {/* ROZPAD PRODEJŮ: Dle kategorií a produktů */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Prodeje podle kategorií */}
        <div className="bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm flex flex-col">
          <h3 className="font-bold text-sm text-ink-900 border-b border-parchment-200 pb-3 mb-3">
            Tržby podle kategorií
          </h3>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-80">
            {Object.keys(report.categoryBreakdown).length === 0 ? (
              <p className="text-xs text-ink-400 py-6 text-center">
                V tento den nebyly prodány žádné položky.
              </p>
            ) : (
              Object.values(report.categoryBreakdown).map((cat) => (
                <div
                  key={cat.categoryName}
                  className="flex items-center justify-between p-3 bg-parchment-50 rounded-xl border border-parchment-200 text-sm"
                >
                  <div>
                    <span className="font-semibold text-ink-900 block">{cat.categoryName}</span>
                    <span className="text-xs text-ink-500">{cat.itemsCount} prodaných kusů</span>
                  </div>
                  <span className="font-bold text-ink-900">{formatCents(cat.totalCents)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Prodeje podle produktů */}
        <div className="bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm flex flex-col">
          <h3 className="font-bold text-sm text-ink-900 border-b border-parchment-200 pb-3 mb-3">
            Prodeje podle jednotlivých položek
          </h3>

          <div className="space-y-2 flex-1 overflow-y-auto max-h-80">
            {Object.keys(report.productBreakdown).length === 0 ? (
              <p className="text-xs text-ink-400 py-6 text-center">
                V tento den nebyly prodány žádné položky.
              </p>
            ) : (
              Object.values(report.productBreakdown).map((prod) => (
                <div
                  key={prod.productName}
                  className="flex items-center justify-between p-2.5 bg-parchment-50 rounded-xl border border-parchment-200 text-xs"
                >
                  <div>
                    <span className="font-semibold text-ink-900 block">{prod.productName}</span>
                    <span className="text-[11px] text-ink-500">{prod.itemsCount} ks</span>
                  </div>
                  <span className="font-bold text-ink-900">{formatCents(prod.totalCents)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
