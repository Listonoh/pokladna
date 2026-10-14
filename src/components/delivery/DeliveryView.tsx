import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/posDatabase';
import { posService } from '../../domain/posService';
import { OrderItem } from '../../domain/types';
import { Check, RotateCcw, Clock, CheckCheck, AlertTriangle } from 'lucide-react';

export const DeliveryView: React.FC = () => {
  const tables = useLiveQuery(() => db.pos_tables.toArray()) ?? [];
  const orders = useLiveQuery(() => db.orders.where('status').anyOf(['open', 'paid']).toArray()) ?? [];
  const allItems = useLiveQuery(() => db.order_items.toArray()) ?? [];

  // Stav pro potvrzení vrácení zpět (Undo confirmation modal)
  const [revertingItem, setRevertingItem] = useState<OrderItem | null>(null);

  // Čekající položky (pending)
  const pendingItems = allItems.filter((i) => i.delivery_status === 'pending');

  // Nedávno doručené položky (posledních 15 doručených)
  const recentDeliveredItems = allItems
    .filter((i) => i.delivery_status === 'delivered')
    .sort((a, b) => new Date(b.delivered_at || b.updated_at).getTime() - new Date(a.delivered_at || a.updated_at).getTime())
    .slice(0, 15);

  // Seskupení čekajících položek podle objednávky / stolu
  const pendingByOrder: Record<string, OrderItem[]> = {};
  for (const item of pendingItems) {
    if (!pendingByOrder[item.order_id]) {
      pendingByOrder[item.order_id] = [];
    }
    pendingByOrder[item.order_id].push(item);
  }

  // Získání názvu stolu pro danou objednávku
  const getTableNameForOrder = (orderId: string): string => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return 'Neznámý stůl';
    if (!order.table_id) return 'S sebou / Bez stolu';
    const table = tables.find((t) => t.id === order.table_id);
    return table ? table.name : 'Stůl';
  };

  const formatElapsedMinutes = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'před chvílí';
    return `${mins} min`;
  };

  const handleDeliverAll = async (orderId: string) => {
    await posService.markAllItemsDeliveredForOrder(orderId);
  };

  const handleDeliverSingle = async (itemId: string) => {
    await posService.markItemDelivered(itemId);
  };

  const handleConfirmRevert = async () => {
    if (!revertingItem) return;
    await posService.revertItemDelivery(revertingItem.id);
    setRevertingItem(null);
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-61px)] overflow-hidden bg-parchment-100 p-4 select-none">
      {/* Hlavička sekce */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-ink-900 tracking-tight flex items-center gap-2">
            Fronta k doručení
            <span className="text-xs bg-amberGold-500 text-white font-bold px-2.5 py-0.5 rounded-full">
              {pendingItems.length} čeká
            </span>
          </h2>
          <p className="text-xs text-ink-500">
            Položky k přípravě a servírování hostům na stoly
          </p>
        </div>
      </div>

      {/* Hlavní plocha: Čekající objednávky (vlevo/střed) + Nedávno doručené (vpravo) */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* ČEKAJÍCÍ POLOŽKY SESKUPENÉ DLE STOLŮ */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {Object.keys(pendingByOrder).length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center bg-white rounded-2xl border border-dashed border-parchment-300 p-8 text-center text-ink-400">
              <CheckCheck className="w-12 h-12 text-tea-500/50 mb-2" />
              <p className="font-semibold text-ink-700">Všechny objednávky jsou doručeny</p>
              <p className="text-xs text-ink-400 mt-1">
                Jakmile host objedná nový čaj nebo pokrm, objeví se v této frontě.
              </p>
            </div>
          ) : (
            Object.entries(pendingByOrder).map(([orderId, items]) => {
              const tableName = getTableNameForOrder(orderId);
              const order = orders.find((o) => o.id === orderId);

              return (
                <div
                  key={orderId}
                  className="bg-white rounded-2xl border-2 border-amberGold-500/40 shadow-sm overflow-hidden"
                >
                  {/* Lišta stolu a hromadná akce */}
                  <div className="bg-amberGold-500/10 px-5 py-3 border-b border-amberGold-500/20 flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-base text-ink-900">{tableName}</h3>
                      <span className="text-xs text-ink-500 font-mono">
                        Účet #{order?.order_number || '---'} • {items.length} položek čeká
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeliverAll(orderId)}
                      className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-tea-600 text-white font-bold text-xs shadow hover:bg-tea-700 active:scale-95 transition-all"
                    >
                      <CheckCheck className="w-4 h-4" />
                      <span>Doručit vše na stole</span>
                    </button>
                  </div>

                  {/* Seznam položek stolu */}
                  <div className="p-3 divide-y divide-parchment-200">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="py-3 px-2 flex items-center justify-between hover:bg-parchment-50 rounded-xl transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="w-7 h-7 rounded-lg bg-tea-100 text-tea-800 font-black text-sm flex items-center justify-center">
                              {item.quantity}×
                            </span>
                            <span className="font-semibold text-base text-ink-900">
                              {item.product_name_snapshot}
                            </span>
                          </div>

                          {item.note && (
                            <p className="text-xs bg-amberGold-500/15 text-amberGold-600 font-medium px-2 py-0.5 rounded-md inline-block ml-9">
                              Poznámka: {item.note}
                            </p>
                          )}

                          <div className="flex items-center space-x-1 text-[11px] text-ink-400 font-mono ml-9">
                            <Clock className="w-3 h-3" />
                            <span>Objednáno: {formatElapsedMinutes(item.created_at)}</span>
                          </div>
                        </div>

                        {/* Tlačítko Doručit jedním dotykem */}
                        <button
                          type="button"
                          onClick={() => handleDeliverSingle(item.id)}
                          className="flex items-center space-x-1.5 px-4 py-3 rounded-xl bg-tea-50 text-tea-700 border-2 border-tea-600 font-bold text-sm hover:bg-tea-600 hover:text-white active:scale-95 transition-all shadow-sm"
                        >
                          <Check className="w-4 h-4" />
                          <span>Doručit</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* PRAVÝ PANEL: Nedávno doručené položky (s možností bezpečného vrácení zpět) */}
        <div className="w-[320px] bg-white rounded-2xl border border-parchment-300 p-4 flex flex-col shadow-sm shrink-0">
          <div className="border-b border-parchment-200 pb-3 mb-3">
            <h3 className="font-bold text-sm text-ink-800 flex items-center gap-1.5">
              <CheckCheck className="w-4 h-4 text-tea-600" />
              Nedávno doručené
            </h3>
            <p className="text-[11px] text-ink-400 mt-0.5">
              Případný překlik lze vrátit zpět
            </p>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {recentDeliveredItems.length === 0 ? (
              <p className="text-xs text-ink-400 text-center py-8">
                Zatím nebyly doručeny žádné položky.
              </p>
            ) : (
              recentDeliveredItems.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 bg-parchment-50 rounded-xl border border-parchment-200 text-xs flex flex-col space-y-1.5"
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className="font-semibold text-ink-900 leading-tight">
                      {item.quantity}× {item.product_name_snapshot}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRevertingItem(item)}
                      title="Vrátit položku zpět do čekajících"
                      className="p-1 rounded-lg bg-white border border-parchment-300 text-ink-600 hover:bg-parchment-200 hover:text-ink-900 transition-colors shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-[10px] text-ink-400 flex justify-between">
                    <span>{getTableNameForOrder(item.order_id)}</span>
                    <span>
                      {item.delivered_at
                        ? new Intl.DateTimeFormat('cs-CZ', {
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(item.delivered_at))
                        : ''}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Potvrzovací dialog pro vrácení zpět do čekajících */}
      {revertingItem && (
        <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-parchment-300 p-6 max-w-sm w-full space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-amberGold-500/10 text-amberGold-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-base text-ink-900">Vrátit položku do čekajících?</h4>
              <p className="text-xs text-ink-500 mt-1">
                Položka <strong>{revertingItem.product_name_snapshot}</strong> bude vrácena zpět na
                bar jako nedoručená.
              </p>
            </div>
            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setRevertingItem(null)}
                className="flex-1 py-2.5 rounded-xl border border-parchment-300 text-sm font-medium text-ink-700 hover:bg-parchment-100"
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={handleConfirmRevert}
                className="flex-1 py-2.5 rounded-xl bg-amberGold-500 text-white text-sm font-bold shadow hover:bg-amberGold-600"
              >
                Vrátit zpět
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
