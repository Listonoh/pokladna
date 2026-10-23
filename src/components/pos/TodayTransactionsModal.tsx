import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/posDatabase';
import { formatCents, getLocalDateString } from '../../domain/calculations';
import {
  X,
  Receipt,
  Search,
  CreditCard,
  Banknote,
  ChevronRight,
  Filter,
} from 'lucide-react';

interface TodayTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPayment: (paymentId: string) => void;
}

export const TodayTransactionsModal: React.FC<TodayTransactionsModalProps> = ({
  isOpen,
  onClose,
  onSelectPayment,
}) => {
  if (!isOpen) return null;

  const todayStr = getLocalDateString(new Date().toISOString());

  const payments = useLiveQuery(() => db.payments.toArray()) ?? [];
  const orders = useLiveQuery(() => db.orders.toArray()) ?? [];
  const tables = useLiveQuery(() => db.pos_tables.toArray()) ?? [];

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMethod, setFilterMethod] = useState<'all' | 'cash' | 'card' | 'cancelled'>('all');

  // Filtrování pouze na dnešní platby
  const todayPayments = payments
    .filter((p) => getLocalDateString(p.created_at) === todayStr)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Rychlá mapa pro stoly a objednávky
  const ordersMap = new Map(orders.map((o) => [o.id, o]));
  const tablesMap = new Map(tables.map((t) => [t.id, t.name]));

  const filteredPayments = todayPayments.filter((p) => {
    // Filtr podle metody / stavu
    if (filterMethod === 'cash' && (p.payment_method !== 'cash' || p.status === 'cancelled')) return false;
    if (filterMethod === 'card' && (p.payment_method !== 'card' || p.status === 'cancelled')) return false;
    if (filterMethod === 'cancelled' && p.status !== 'cancelled') return false;

    // Hledání
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

  const cashCount = todayPayments.filter((p) => p.payment_method === 'cash' && p.status !== 'cancelled').length;
  const cardCount = todayPayments.filter((p) => p.payment_method === 'card' && p.status !== 'cancelled').length;
  const cancelledCount = todayPayments.filter((p) => p.status === 'cancelled').length;

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-3 select-none">
      <div className="bg-parchment-100 rounded-2xl shadow-2xl border border-parchment-300 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Hlavička */}
        <div className="bg-tea-800 text-parchment-50 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-tea-700/80 border border-tea-500/40 flex items-center justify-center text-tea-200">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Dnešní platby a transakce</h2>
              <p className="text-xs text-tea-200">
                Přehled všech plateb za dnešní den ({todayPayments.length} plateb celkem)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-tea-200 hover:text-white rounded-lg hover:bg-tea-700/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Vyhledávání a filtry */}
        <div className="p-4 bg-white border-b border-parchment-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Hledat podle stolu, čísla účtu či položky..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-parchment-300 bg-parchment-50 focus:outline-none focus:border-tea-600 focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center space-x-1.5 overflow-x-auto text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFilterMethod('all')}
              className={`px-3 py-1.5 rounded-lg border transition-all ${
                filterMethod === 'all'
                  ? 'bg-tea-600 border-tea-600 text-white'
                  : 'bg-parchment-50 border-parchment-300 text-ink-700 hover:bg-parchment-200'
              }`}
            >
              Vše ({todayPayments.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMethod('cash')}
              className={`px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${
                filterMethod === 'cash'
                  ? 'bg-tea-600 border-tea-600 text-white'
                  : 'bg-parchment-50 border-parchment-300 text-ink-700 hover:bg-parchment-200'
              }`}
            >
              <Banknote className="w-3.5 h-3.5" />
              Hotově ({cashCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterMethod('card')}
              className={`px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1 ${
                filterMethod === 'card'
                  ? 'bg-tea-600 border-tea-600 text-white'
                  : 'bg-parchment-50 border-parchment-300 text-ink-700 hover:bg-parchment-200'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              Kartou ({cardCount})
            </button>
            {cancelledCount > 0 && (
              <button
                type="button"
                onClick={() => setFilterMethod('cancelled')}
                className={`px-3 py-1.5 rounded-lg border transition-all text-rose-700 ${
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

        {/* Seznam transakcí */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1">
          {filteredPayments.length === 0 ? (
            <div className="py-12 text-center text-ink-400 text-xs">
              <Filter className="w-8 h-8 mx-auto mb-2 text-ink-300" />
              <p className="font-semibold text-sm text-ink-600">Nebyly nalezeny žádné transakce</p>
              <p className="mt-1">Zkuste změnit kritéria vyhledávání nebo filtr.</p>
            </div>
          ) : (
            filteredPayments.map((p) => {
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

              // Náhled položek
              const itemsPreview = (p.paid_items && p.paid_items.length > 0)
                ? p.paid_items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ')
                : 'Položky objednávky';

              return (
                <div
                  key={p.id}
                  onClick={() => onSelectPayment(p.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between hover:shadow-md ${
                    isCancelled
                      ? 'bg-rose-50/50 border-rose-200 opacity-70'
                      : 'bg-white border-parchment-300 hover:border-tea-400'
                  }`}
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0 mr-3">
                    {/* Ikona metody */}
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isCancelled
                          ? 'bg-rose-100 text-rose-600'
                          : p.payment_method === 'card'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-tea-50 text-tea-700 border border-tea-200'
                      }`}
                    >
                      {p.payment_method === 'card' ? (
                        <CreditCard className="w-4 h-4" />
                      ) : (
                        <Banknote className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-xs text-ink-900">{tableName}</span>
                        <span className="text-[11px] text-ink-400 font-mono">#{orderNum}</span>
                        <span className="text-[11px] text-ink-500 font-mono">{timeStr}</span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            isCancelled
                              ? 'bg-rose-100 text-rose-700'
                              : p.payment_method === 'card'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-tea-100 text-tea-700'
                          }`}
                        >
                          {isCancelled ? 'Storno' : p.payment_method === 'card' ? 'Kartou' : 'Hotově'}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-500 truncate mt-0.5" title={itemsPreview}>
                        {itemsPreview}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <div className="text-right">
                      <span className={`font-black text-sm block ${isCancelled ? 'text-rose-600 line-through' : 'text-ink-900'}`}>
                        {formatCents(totalPaid)}
                      </span>
                      {p.tip_amount_cents > 0 && (
                        <span className="text-[10px] text-amberGold-600 font-semibold block">
                          dýško +{formatCents(p.tip_amount_cents)}
                        </span>
                      )}
                    </div>

                    <div className="p-1.5 rounded-lg bg-parchment-100 text-ink-600 hover:bg-parchment-200 transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Spodní lišta */}
        <div className="bg-parchment-200/80 px-6 py-3.5 flex items-center justify-between border-t border-parchment-300 shrink-0">
          <p className="text-xs text-ink-500">
            Kliknutím na transakci otevřete detail pro změnu metody (hotovost/karta) či dýška.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl font-bold text-xs bg-ink-800 text-white hover:bg-ink-900 transition-colors"
          >
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
};
