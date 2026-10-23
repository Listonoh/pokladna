import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/posDatabase';
import {
  generateDailyReport,
  formatCents,
  getLocalDateString,
} from '../../domain/calculations';
import { TransactionDetailModal } from '../pos/TransactionDetailModal';
import {
  Calendar,
  Banknote,
  CreditCard,
  Download,
  Receipt,
  FileSpreadsheet,
  TrendingUp,
  Heart,
  Search,
  Filter,
  Clock,
  Edit3,
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
  const tables = useLiveQuery(() => db.pos_tables.toArray()) ?? [];

  // Filtry transakcí
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMethod, setFilterMethod] = useState<'all' | 'cash' | 'card' | 'cancelled'>('all');
  const [selectedPaymentIdForDetail, setSelectedPaymentIdForDetail] = useState<string | null>(null);

  const categoriesMap = new Map<string, string>();
  categories.forEach((c) => categoriesMap.set(c.id, c.name));

  const productsCategoryMap = new Map<string, string>();
  products.forEach((p) => productsCategoryMap.set(p.id, p.category_id));

  const ordersMap = new Map(orders.map((o) => [o.id, o]));
  const tablesMap = new Map(tables.map((t) => [t.id, t.name]));

  const report = generateDailyReport(
    selectedDate,
    orders,
    items,
    payments,
    categoriesMap,
    productsCategoryMap
  );

  // Platby za vybraný den
  const dayPayments = payments
    .filter((p) => getLocalDateString(p.created_at) === selectedDate)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Filtrované platby pro tabulku
  const filteredPayments = dayPayments.filter((p) => {
    if (filterMethod === 'cash' && (p.payment_method !== 'cash' || p.status === 'cancelled')) return false;
    if (filterMethod === 'card' && (p.payment_method !== 'card' || p.status === 'cancelled')) return false;
    if (filterMethod === 'cancelled' && p.status !== 'cancelled') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const order = ordersMap.get(p.order_id);
      const tableName = order?.table_id ? tablesMap.get(order.table_id) || '' : 's sebou';
      const orderNum = order?.order_number || '';
      const itemsText = (p.paid_items || []).map((i) => i.product_name).join(' ');

      const match =
        tableName.toLowerCase().includes(q) ||
        orderNum.toLowerCase().includes(q) ||
        itemsText.toLowerCase().includes(q);

      if (!match) return false;
    }

    return true;
  });

  const cashCount = dayPayments.filter((p) => p.payment_method === 'cash' && p.status !== 'cancelled').length;
  const cardCount = dayPayments.filter((p) => p.payment_method === 'card' && p.status !== 'cancelled').length;
  const cancelledCount = dayPayments.filter((p) => p.status === 'cancelled').length;

  // Export do CSV
  const handleExportCsv = () => {
    let csv = `Denní uzávěrka: ${selectedDate}\n`;
    csv += `Vygenerováno: ${new Date().toLocaleString('cs-CZ')}\n\n`;

    csv += `Finanční souhrn plateb a spropitného\n`;
    csv += `Celkem přijaté platby (vč. spropitného);${report.totalPaymentsCents / 100} Kč\n`;
    csv += `Čisté tržby za zboží;${report.normalSalesCents / 100} Kč\n`;
    csv += `Spropitné celkem;${report.totalTipsCents / 100} Kč\n`;
    csv += `  - Spropitné hotově;${report.cashTipsCents / 100} Kč\n`;
    csv += `  - Spropitné kartou;${report.cardTipsCents / 100} Kč\n`;
    csv += `Hotovost celkem (zboží + spropitné);${report.cashPaymentsCents / 100} Kč\n`;
    csv += `Karta celkem (zboží + spropitné);${report.cardPaymentsCents / 100} Kč\n`;
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
    csv += `\n`;

    csv += `Detailní rozpis jednotlivých plateb a transakcí\n`;
    csv += `Čas;Účet;Stůl;Způsob;Zboží (Kč);Spropitné (Kč);Celkem (Kč);Stav;Položky\n`;
    dayPayments.forEach((p) => {
      const order = ordersMap.get(p.order_id);
      const tableName = order?.table_id ? tablesMap.get(order.table_id) || 'Stůl' : 'S sebou';
      const orderNum = order ? order.order_number : '—';
      const time = new Date(p.created_at).toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague' });
      const method = p.payment_method === 'card' ? 'Karta' : 'Hotovost';
      const status = p.status === 'cancelled' ? 'Stornováno' : 'Dokončeno';
      const itemsStr = (p.paid_items || []).map((i) => `${i.quantity}x ${i.product_name}`).join(', ');

      csv += `${time};${orderNum};${tableName};${method};${p.amount_cents / 100};${(p.tip_amount_cents || 0) / 100};${(p.amount_cents + (p.tip_amount_cents || 0)) / 100};${status};"${itemsStr}"\n`;
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
    const exportData = {
      ...report,
      payments: dayPayments.map((p) => {
        const order = ordersMap.get(p.order_id);
        const tableName = order?.table_id ? tablesMap.get(order.table_id) || 'Stůl' : 'S sebou';
        return {
          ...p,
          order_number: order?.order_number,
          table_name: tableName,
        };
      }),
    };

    const dataStr = JSON.stringify(exportData, null, 2);
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
    <div className="flex-1 min-h-0 overflow-y-auto bg-parchment-100 p-4 sm:p-6 select-none space-y-6 pb-16">
      {/* Hlavička s voličem data a exporty */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm shrink-0">
        <div>
          <h2 className="text-xl font-bold text-ink-900 tracking-tight flex items-center gap-2">
            <Receipt className="w-6 h-6 text-tea-600" />
            Denní přehled a statistika tržeb
          </h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Evidence plateb, prodaných položek a spropitného v čase Europe/Prague
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
              Tržba {formatCents(report.normalSalesCents)} + Dýška {formatCents(report.totalTipsCents)}
            </span>
          </div>
        </div>

        {/* Spropitné (Tips) */}
        <div className="bg-white p-5 rounded-2xl border border-amberGold-500/40 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-amberGold-600">
            <span>Spropitné (Dýška)</span>
            <div className="p-2 bg-amberGold-500/10 rounded-xl text-amberGold-600">
              <Heart className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-amberGold-600">
              {formatCents(report.totalTipsCents)}
            </span>
            <span className="text-xs text-ink-500 block mt-1">
              Hotově: {formatCents(report.cashTipsCents)} • Kartou: {formatCents(report.cardTipsCents)}
            </span>
          </div>
        </div>

        {/* Hotovost celkem */}
        <div className="bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-ink-600">
            <span>Hotovost v zásuvce</span>
            <div className="p-2 bg-tea-50 rounded-xl text-tea-600">
              <Banknote className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-ink-800">
              {formatCents(report.cashPaymentsCents)}
            </span>
            <span className="text-xs text-ink-400 block mt-1">
              (vč. {formatCents(report.cashTipsCents)} hotovostního dýška)
            </span>
          </div>
        </div>

        {/* Karta celkem */}
        <div className="bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase text-ink-600">
            <span>Karta (bankovní účet)</span>
            <div className="p-2 bg-tea-50 rounded-xl text-tea-600">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-black text-ink-800">
              {formatCents(report.cardPaymentsCents)}
            </span>
            <span className="text-xs text-ink-400 block mt-1">
              (vč. {formatCents(report.cardTipsCents)} kartového dýška)
            </span>
          </div>
        </div>
      </div>

      {/* Další souhrnné ukazatele */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-parchment-300 text-xs flex justify-between items-center text-ink-700">
          <span>Čistá hodnota prodaného zboží za den:</span>
          <span className="font-bold text-sm text-ink-900">{formatCents(report.soldItemsValueCents)}</span>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-parchment-300 text-xs flex justify-between items-center text-ink-700">
          <span>Neuhrazené účty hostů na stolech (dluh):</span>
          <span className="font-bold text-sm text-amberGold-600">{formatCents(report.unpaidReceivablesCents)}</span>
        </div>
      </div>

      {/* PODROBNÝ PŘEHLED TRANSAKCÍ A PLATEB (NOVÉ) */}
      <div className="bg-white rounded-2xl border border-parchment-300 shadow-sm overflow-hidden flex flex-col">
        {/* Hlavička tabulky s vyhledáváním a filtry */}
        <div className="p-5 border-b border-parchment-200 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-parchment-50/70">
          <div>
            <h3 className="font-bold text-base text-ink-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-tea-600" />
              Detailní historie plateb a transakcí ({dayPayments.length})
            </h3>
            <p className="text-xs text-ink-500 mt-0.5">
              Seznam všech realizovaných plateb za den {selectedDate}. Kliknutím na řádek můžete upravit způsob úhrady (karta / hotovost) či dýško.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Vyhledávání */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Hledat stůl, účet, položku..."
                className="pl-9 pr-3 py-2 text-xs rounded-xl border border-parchment-300 bg-white focus:outline-none focus:border-tea-600 w-full sm:w-56"
              />
            </div>

            {/* Filtry metod */}
            <div className="flex items-center space-x-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setFilterMethod('all')}
                className={`px-3 py-2 rounded-xl border transition-all ${
                  filterMethod === 'all'
                    ? 'bg-tea-600 border-tea-600 text-white shadow-sm'
                    : 'bg-white border-parchment-300 text-ink-700 hover:bg-parchment-100'
                }`}
              >
                Vše ({dayPayments.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMethod('cash')}
                className={`px-3 py-2 rounded-xl border transition-all flex items-center gap-1 ${
                  filterMethod === 'cash'
                    ? 'bg-tea-600 border-tea-600 text-white shadow-sm'
                    : 'bg-white border-parchment-300 text-ink-700 hover:bg-parchment-100'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
                Hotově ({cashCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMethod('card')}
                className={`px-3 py-2 rounded-xl border transition-all flex items-center gap-1 ${
                  filterMethod === 'card'
                    ? 'bg-tea-600 border-tea-600 text-white shadow-sm'
                    : 'bg-white border-parchment-300 text-ink-700 hover:bg-parchment-100'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                Kartou ({cardCount})
              </button>
              {cancelledCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterMethod('cancelled')}
                  className={`px-3 py-2 rounded-xl border transition-all text-rose-700 ${
                    filterMethod === 'cancelled'
                      ? 'bg-rose-600 border-rose-600 text-white'
                      : 'bg-rose-50 border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  Storna ({cancelledCount})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabulka transakcí */}
        <div className="overflow-x-auto">
          {filteredPayments.length === 0 ? (
            <div className="py-12 text-center text-ink-400 text-xs">
              <Filter className="w-8 h-8 mx-auto mb-2 text-ink-300" />
              <p className="font-semibold text-sm text-ink-600">Žádné platby k zobrazení</p>
              <p className="mt-1">
                {dayPayments.length === 0
                  ? 'V tento den nebyla zaúčtována žádná platba.'
                  : 'Žádná platba neodpovídá zvolenému filtru nebo hledání.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-parchment-100/70 border-b border-parchment-200 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                  <th className="py-3 px-4">Čas</th>
                  <th className="py-3 px-3">Účet / Objednávka</th>
                  <th className="py-3 px-3">Stůl / Typ</th>
                  <th className="py-3 px-3">Způsob platby</th>
                  <th className="py-3 px-4">Položky</th>
                  <th className="py-3 px-3 text-right">Zboží</th>
                  <th className="py-3 px-3 text-right">Spropitné</th>
                  <th className="py-3 px-3 text-right">Celkem</th>
                  <th className="py-3 px-3 text-center">Stav</th>
                  <th className="py-3 px-4 text-right">Akce</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment-200">
                {filteredPayments.map((p) => {
                  const order = ordersMap.get(p.order_id);
                  const tableName = order?.table_id ? tablesMap.get(order.table_id) || 'Stůl' : 'S sebou';
                  const orderNum = order?.order_number || '—';
                  const isCancelled = p.status === 'cancelled';
                  const totalPaid = p.amount_cents + (p.tip_amount_cents || 0);

                  const timeStr = new Date(p.created_at).toLocaleTimeString('cs-CZ', {
                    timeZone: 'Europe/Prague',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  const itemsPreview = (p.paid_items && p.paid_items.length > 0)
                    ? p.paid_items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ')
                    : 'Položky účtu';

                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedPaymentIdForDetail(p.id)}
                      className={`hover:bg-tea-50/40 cursor-pointer transition-colors ${
                        isCancelled ? 'bg-rose-50/40 opacity-70' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-ink-600 whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-ink-400" />
                          {timeStr}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-mono font-bold text-ink-800 whitespace-nowrap">
                        #{orderNum}
                      </td>

                      <td className="py-3 px-3 font-semibold text-ink-900 whitespace-nowrap">
                        {tableName}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${
                            p.payment_method === 'card'
                              ? 'bg-blue-50 text-blue-800 border-blue-200'
                              : 'bg-tea-50 text-tea-800 border-tea-200'
                          }`}
                        >
                          {p.payment_method === 'card' ? (
                            <>
                              <CreditCard className="w-3.5 h-3.5" />
                              Kartou
                            </>
                          ) : (
                            <>
                              <Banknote className="w-3.5 h-3.5" />
                              Hotově
                            </>
                          )}
                        </span>
                      </td>

                      <td className="py-3 px-4 max-w-xs truncate text-ink-600" title={itemsPreview}>
                        {itemsPreview}
                      </td>

                      <td className="py-3 px-3 text-right font-medium text-ink-700 whitespace-nowrap">
                        {formatCents(p.amount_cents)}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap font-medium">
                        {p.tip_amount_cents > 0 ? (
                          <span className="text-amberGold-600 font-bold">
                            +{formatCents(p.tip_amount_cents)}
                          </span>
                        ) : (
                          <span className="text-ink-400">0 Kč</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <strong className={`font-black ${isCancelled ? 'text-rose-600 line-through' : 'text-ink-900'}`}>
                          {formatCents(totalPaid)}
                        </strong>
                      </td>

                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isCancelled
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-tea-100 text-tea-700'
                          }`}
                        >
                          {isCancelled ? 'Storno' : 'Platná'}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPaymentIdForDetail(p.id);
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-parchment-300 bg-white hover:bg-parchment-200 text-ink-700 font-semibold text-xs flex items-center gap-1 ml-auto shadow-sm transition-colors"
                        >
                          <Edit3 className="w-3 h-3 text-tea-600" />
                          <span>Upravit / Detail</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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

      {/* Modální okno pro detail a úpravu transakce */}
      <TransactionDetailModal
        isOpen={Boolean(selectedPaymentIdForDetail)}
        onClose={() => setSelectedPaymentIdForDetail(null)}
        paymentId={selectedPaymentIdForDetail}
      />
    </div>
  );
};
