import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/posDatabase';
import { posService } from '../../domain/posService';
import { Product, Order, OrderItem, PaymentMethod, PaymentItemDetail, DiscountPercent } from '../../domain/types';
import { formatCents, calculateOrder, getLocalDateString } from '../../domain/calculations';
import { PaymentModal } from './PaymentModal';
import { ItemNoteModal } from './ItemNoteModal';
import { TransactionDetailModal } from './TransactionDetailModal';
import { TodayTransactionsModal } from './TodayTransactionsModal';
import {
  Star,
  Plus,
  Minus,
  Trash2,
  FileText,
  CreditCard,
  UserCheck,
  Coffee,
  Check,
  CheckCircle,
  Clock,
  Heart,
  Receipt,
} from 'lucide-react';

export const PosView: React.FC = () => {
  // 1. Lokální data z Dexie
  const tables = useLiveQuery(() => db.pos_tables.filter((t) => t.is_active).sortBy('sort_order')) ?? [];
  const categories = useLiveQuery(() => db.categories.filter((c) => c.is_active).sortBy('sort_order')) ?? [];
  const products = useLiveQuery(() => db.products.filter((p) => p.is_active).sortBy('sort_order')) ?? [];
  const openOrders = useLiveQuery(() => db.orders.where('status').equals('open').toArray()) ?? [];
  const allOrderItems = useLiveQuery(() => db.order_items.toArray()) ?? [];
  const allPayments = useLiveQuery(() => db.payments.toArray()) ?? [];

  // Vybraný stůl (null = "S sebou / Bez stolu")
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  // Vybrané ID neuzavřené objednávky S sebou
  const [selectedTakeoutOrderId, setSelectedTakeoutOrderId] = useState<string | null>(null);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);

  // Filtrování kategorie
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | 'all'>('all');

  // Modály
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [editingItemNote, setEditingItemNote] = useState<OrderItem | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedPaymentIdForDetail, setSelectedPaymentIdForDetail] = useState<string | null>(null);

  // Počet dnešních plateb
  const todayStr = getLocalDateString(new Date().toISOString());
  const todayPaymentsCount = allPayments.filter(
    (p) => getLocalDateString(p.created_at) === todayStr && p.status !== 'cancelled'
  ).length;

  // Neuzavřené objednávky S sebou
  const openTakeoutOrders = openOrders.filter((o) => !o.table_id);

  // Načtení nebo založení objednávky pro stůl či S sebou
  useEffect(() => {
    let isCancelled = false;
    async function loadOrder() {
      if (selectedTableId) {
        const order = await posService.getOrCreateOrderForTable(selectedTableId);
        if (!isCancelled) {
          setCurrentOrder(order);
        }
      } else if (selectedTakeoutOrderId) {
        const order = await db.orders.get(selectedTakeoutOrderId);
        if (order && order.status === 'open' && !isCancelled) {
          setCurrentOrder(order);
        } else if (!isCancelled) {
          const fallbackOrder = await posService.getOrCreateOrderForTable(null);
          setSelectedTakeoutOrderId(fallbackOrder.id);
          setCurrentOrder(fallbackOrder);
        }
      } else {
        const order = await posService.getOrCreateOrderForTable(null);
        if (!isCancelled) {
          setSelectedTakeoutOrderId(order.id);
          setCurrentOrder(order);
        }
      }
    }
    loadOrder();
    return () => {
      isCancelled = true;
    };
  }, [selectedTableId, selectedTakeoutOrderId]);

  // Položky a platby aktuální objednávky
  const currentItems = currentOrder
    ? allOrderItems.filter((i) => i.order_id === currentOrder.id && i.delivery_status !== 'cancelled')
    : [];

  const currentPayments = currentOrder
    ? allPayments.filter((p) => p.order_id === currentOrder.id)
    : [];

  const calc = calculateOrder(currentItems, currentPayments);

  // Produkty dle kategorie a oblíbené
  const filteredProducts = products.filter((p) => {
    if (selectedCategoryId === 'all') return true;
    return p.category_id === selectedCategoryId;
  });

  const favoriteProducts = products.filter((p) => p.is_favorite);

  // Přidání produktu jedním dotykem
  const handleAddProduct = async (product: Product) => {
    if (!currentOrder) return;
    await posService.addItemToOrder(currentOrder.id, product, 1);
  };

  // Zpracování platby s dýškem
  const handleConfirmPayment = async (
    amountCents: number,
    method: PaymentMethod,
    options: { tipAmountCents: number; paidItems: PaymentItemDetail[]; discountPercent: DiscountPercent }
  ) => {
    if (!currentOrder) return;
    await posService.recordPayment(currentOrder.id, amountCents, method, options);

    // Pokud je objednávka zaplacena, načteme znovu aktuální stav
    const updated = await db.orders.get(currentOrder.id);
    if (updated) {
      setCurrentOrder(updated);
    }
  };

  // Název stolu pro zobrazení
  const selectedTable = tables.find((t) => t.id === selectedTableId);
  const tableNameDisplay = selectedTable
    ? selectedTable.name
    : currentOrder
      ? `S sebou #${currentOrder.order_number.includes('-') ? currentOrder.order_number.split('-')[1] : currentOrder.order_number}`
      : 'S sebou / Bez stolu';

  // Pomocná funkce pro zjištění stavu stolu
  const getTableStatus = (tableId: string) => {
    const order = openOrders.find((o) => o.table_id === tableId);
    if (!order) return { state: 'free', label: 'Volný' };

    const items = allOrderItems.filter((i) => i.order_id === order.id && i.delivery_status !== 'cancelled');
    const payments = allPayments.filter((p) => p.order_id === order.id);
    const tableCalc = calculateOrder(items, payments);

    if (tableCalc.pendingDeliveryCount > 0) {
      return { state: 'pending_delivery', label: `K doručení (${tableCalc.pendingDeliveryCount})` };
    }
    if (tableCalc.remainingCents > 0) {
      return { state: 'has_balance', label: formatCents(tableCalc.remainingCents) };
    }
    return { state: 'open', label: 'Otevřený' };
  };

  // Pomocná funkce pro zjištění stavu objednávky S sebou
  const getTakeoutStatus = (order: Order) => {
    const items = allOrderItems.filter((i) => i.order_id === order.id && i.delivery_status !== 'cancelled');
    const payments = allPayments.filter((p) => p.order_id === order.id);
    const orderCalc = calculateOrder(items, payments);

    if (orderCalc.pendingDeliveryCount > 0) {
      return { state: 'pending_delivery', label: `K doručení (${orderCalc.pendingDeliveryCount})` };
    }
    if (orderCalc.remainingCents > 0) {
      return { state: 'has_balance', label: formatCents(orderCalc.remainingCents) };
    }
    if (items.length === 0) {
      return { state: 'free', label: 'Prázdný' };
    }
    return { state: 'open', label: 'Otevřený' };
  };

  const handleSelectTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setSelectedTakeoutOrderId(null);
  };

  const handleSelectTakeoutOrder = (order: Order) => {
    setSelectedTableId(null);
    setSelectedTakeoutOrderId(order.id);
    setCurrentOrder(order);
  };

  const handleSelectTakeoutDefault = async () => {
    setSelectedTableId(null);
    if (selectedTakeoutOrderId && currentOrder?.id === selectedTakeoutOrderId && currentOrder?.status === 'open') {
      return;
    }
    const order = await posService.getOrCreateOrderForTable(null);
    setSelectedTakeoutOrderId(order.id);
    setCurrentOrder(order);
  };

  const handleCreateNewTakeout = async () => {
    // Pokud už existuje otevřená objednávka s sebou, která je zcela prázdná, přepneme na ni
    const emptyTakeout = openTakeoutOrders.find((o) => {
      const items = allOrderItems.filter((i) => i.order_id === o.id && i.delivery_status !== 'cancelled');
      return items.length === 0;
    });

    if (emptyTakeout) {
      setSelectedTableId(null);
      setSelectedTakeoutOrderId(emptyTakeout.id);
      setCurrentOrder(emptyTakeout);
      return;
    }

    const newOrder = await posService.createNewTakeoutOrder();
    setSelectedTableId(null);
    setSelectedTakeoutOrderId(newOrder.id);
    setCurrentOrder(newOrder);
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!window.confirm('Opravdu chcete tuto objednávku zrušit?')) {
      return;
    }
    await posService.cancelOrder(orderId);
    if (currentOrder?.id === orderId) {
      if (selectedTableId) {
        const nextOrder = await posService.getOrCreateOrderForTable(selectedTableId);
        setCurrentOrder(nextOrder);
      } else {
        const remainingTakeouts = openTakeoutOrders.filter((o) => o.id !== orderId);
        if (remainingTakeouts.length > 0) {
          setSelectedTakeoutOrderId(remainingTakeouts[0].id);
          setCurrentOrder(remainingTakeouts[0]);
        } else {
          setSelectedTakeoutOrderId(null);
          const fresh = await posService.getOrCreateOrderForTable(null);
          setSelectedTakeoutOrderId(fresh.id);
          setCurrentOrder(fresh);
        }
      }
    }
  };

  const handleOpenNewOrderAfterPaid = async () => {
    if (selectedTableId) {
      const order = await posService.getOrCreateOrderForTable(selectedTableId);
      setCurrentOrder(order);
    } else {
      const newOrder = await posService.createNewTakeoutOrder();
      setSelectedTakeoutOrderId(newOrder.id);
      setCurrentOrder(newOrder);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-parchment-100">
      {/* 1. Horní lišta stolů a S sebou */}
      <div className="bg-parchment-200/90 border-b border-parchment-300 px-4 py-2 overflow-x-auto flex items-center space-x-2 shrink-0">
        {/* Dlaždice neuzavřených objednávek S sebou */}
        {openTakeoutOrders.length === 0 ? (
          <button
            type="button"
            onClick={handleSelectTakeoutDefault}
            className={`flex flex-col items-center justify-center px-4 py-1.5 rounded-xl text-xs font-semibold shrink-0 min-w-[110px] border transition-all ${
              selectedTableId === null
                ? 'bg-tea-700 text-white border-tea-800 shadow-sm'
                : 'bg-white text-ink-700 border-parchment-300 hover:bg-parchment-100'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Coffee className="w-3.5 h-3.5" />
              <span>S sebou</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full mt-0.5 bg-parchment-300 text-ink-600">
              Nový účet
            </span>
          </button>
        ) : (
          openTakeoutOrders.map((order) => {
            const status = getTakeoutStatus(order);
            const isSelected = selectedTableId === null && currentOrder?.id === order.id;

            let badgeColor = 'bg-parchment-300 text-ink-600';
            if (status.state === 'pending_delivery') badgeColor = 'bg-amberGold-500 text-white font-bold';
            if (status.state === 'has_balance') badgeColor = 'bg-tea-600 text-white font-bold';

            const num = order.order_number.includes('-')
              ? order.order_number.split('-')[1]
              : order.order_number.slice(-3);

            return (
              <button
                key={order.id}
                type="button"
                onClick={() => handleSelectTakeoutOrder(order)}
                className={`flex flex-col items-center justify-center px-4 py-1.5 rounded-xl text-xs font-semibold shrink-0 min-w-[120px] border transition-all ${
                  isSelected
                    ? 'bg-tea-700 text-white border-tea-800 shadow-md ring-2 ring-tea-600/40'
                    : 'bg-white text-ink-800 border-parchment-300 hover:bg-parchment-50'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate max-w-[115px]">
                  <Coffee className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-sm font-semibold truncate">S sebou #{num}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full mt-0.5 ${badgeColor}`}>
                  {status.label}
                </span>
              </button>
            );
          })
        )}

        {/* Tlačítko pro přidání další objednávky S sebou, pokud už nějaké existují */}
        {openTakeoutOrders.length > 0 && (
          <button
            type="button"
            onClick={handleCreateNewTakeout}
            className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl text-xs font-semibold shrink-0 border border-dashed border-tea-600/60 text-tea-700 bg-tea-50/50 hover:bg-tea-100/60 active:scale-95 transition-all"
            title="Založit novou objednávku S sebou"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>S sebou</span>
          </button>
        )}

        {/* Oddělovač */}
        <div className="h-7 w-px bg-parchment-300 shrink-0 mx-1" />

        {/* Dlaždice stolů */}
        {tables.map((table) => {
          const status = getTableStatus(table.id);
          const isSelected = selectedTableId === table.id;

          let badgeColor = 'bg-parchment-300 text-ink-600';
          if (status.state === 'pending_delivery') badgeColor = 'bg-amberGold-500 text-white font-bold';
          if (status.state === 'has_balance') badgeColor = 'bg-tea-600 text-white font-bold';

          return (
            <button
              key={table.id}
              type="button"
              onClick={() => handleSelectTable(table.id)}
              className={`flex flex-col items-center justify-center px-4 py-1.5 rounded-xl text-xs font-semibold shrink-0 min-w-[120px] border transition-all ${
                isSelected
                  ? 'bg-tea-700 text-white border-tea-800 shadow-md ring-2 ring-tea-600/40'
                  : 'bg-white text-ink-800 border-parchment-300 hover:bg-parchment-50'
              }`}
            >
              <span className="text-sm truncate w-full text-center">{table.name}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full mt-0.5 ${badgeColor}`}>
                {status.label}
              </span>
            </button>
          );
        })}

        {/* Oddělovač */}
        <div className="h-7 w-px bg-parchment-300 shrink-0 mx-1" />

        {/* Tlačítko Historie plateb za dnešek */}
        <button
          type="button"
          onClick={() => setIsHistoryOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold shrink-0 border border-parchment-300 bg-white text-ink-800 hover:bg-parchment-100 hover:border-tea-500 shadow-sm transition-all"
          title="Zobrazit dnešní platby a transakce v detailu s možností úpravy"
        >
          <Receipt className="w-4 h-4 text-tea-700" />
          <span>Platby dnes ({todayPaymentsCount})</span>
        </button>
      </div>

      {/* 2. Hlavní plocha: Nabídka (Vlevo) + Účet (Vpravo) */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEVÝ PANEL: Nabídka produktů */}
        <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4 min-h-0">
          {/* Oblíbené produkty (Rychlá mřížka) */}
          {favoriteProducts.length > 0 && (
            <div>
              <div className="flex items-center space-x-2 text-ink-700 text-xs font-bold uppercase tracking-wider mb-2">
                <Star className="w-4 h-4 text-amberGold-500 fill-amberGold-500" />
                <span>Oblíbené položky na 1 dotyk</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                {favoriteProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAddProduct(p)}
                    className="p-3.5 bg-white border border-parchment-300 rounded-xl shadow-sm hover:border-tea-500 hover:bg-tea-50/50 active:scale-[0.98] transition-all text-left flex flex-col justify-between min-h-[82px]"
                  >
                    <span className="font-semibold text-ink-900 text-sm line-clamp-2 leading-snug">
                      {p.name}
                    </span>
                    <span className="text-tea-700 font-bold text-sm mt-1">
                      {formatCents(p.price_cents)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Záložky kategorií */}
          <div>
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 mb-2">
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                  selectedCategoryId === 'all'
                    ? 'bg-tea-700 text-white shadow-sm'
                    : 'bg-parchment-200 text-ink-700 hover:bg-parchment-300'
                }`}
              >
                Všechny kategorie
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(c.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                    selectedCategoryId === c.id
                      ? 'bg-tea-700 text-white shadow-sm'
                      : 'bg-parchment-200 text-ink-700 hover:bg-parchment-300'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {/* Mřížka všech produktů ve vybrané kategorii */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleAddProduct(p)}
                  className="p-3.5 bg-white border border-parchment-300 rounded-xl shadow-sm hover:border-tea-500 hover:bg-tea-50/40 active:scale-[0.98] transition-all text-left flex flex-col justify-between min-h-[82px]"
                >
                  <div className="flex justify-between items-start gap-1">
                    <span className="font-semibold text-ink-900 text-sm line-clamp-2 leading-snug">
                      {p.name}
                    </span>
                    {p.is_favorite && (
                      <Star className="w-3.5 h-3.5 text-amberGold-500 fill-amberGold-500 shrink-0 mt-0.5" />
                    )}
                  </div>
                  <span className="text-tea-700 font-bold text-sm mt-1">
                    {formatCents(p.price_cents)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* PRAVÝ PANEL: Aktuální účet stolu */}
        <div className="w-[380px] lg:w-[420px] bg-white border-l border-parchment-300 flex flex-col shadow-lg shrink-0 min-h-0">
          {/* Hlavička účtu */}
          <div className="p-4 bg-parchment-100 border-b border-parchment-300 flex items-center justify-between shrink-0">
            <div>
              <h2 className="font-bold text-base text-ink-900 leading-tight">
                {tableNameDisplay}
              </h2>
              <span className="text-xs text-ink-500 font-mono">
                Účet #{currentOrder?.order_number || '---'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {currentOrder && currentOrder.status === 'open' && (
                <button
                  type="button"
                  onClick={() => handleCancelOrder(currentOrder.id)}
                  className="px-2 py-1 text-xs text-ink-500 hover:text-terracotta-600 hover:bg-red-50 rounded border border-transparent hover:border-terracotta-200 transition-colors flex items-center gap-1"
                  title="Stornovat nebo smazat tento účet"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Zrušit</span>
                </button>
              )}
              {currentOrder?.status === 'paid' && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-tea-600 text-white flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Zaplaceno
                </span>
              )}
            </div>
          </div>

          {/* Seznam položek účtu */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            {currentItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-ink-400 p-6 text-center">
                <Coffee className="w-12 h-12 text-parchment-400 mb-2" />
                <p className="text-sm font-medium">Účet je prázdný</p>
                <p className="text-xs text-ink-400 mt-1">
                  Klepnutím na položku v nabídce ji přidáte do účtu.
                </p>
                {currentOrder && (
                  <button
                    type="button"
                    onClick={() => handleCancelOrder(currentOrder.id)}
                    className="mt-4 px-3 py-1.5 text-xs text-terracotta-600 hover:text-terracotta-700 hover:bg-red-50 border border-terracotta-200 rounded-lg flex items-center gap-1.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Zrušit tento prázdný účet</span>
                  </button>
                )}
              </div>
            ) : (
              currentItems.map((item) => {
                const itemTotal = item.unit_price_cents_snapshot * item.quantity;
                const isPartiallyPaid = (item.paid_quantity || 0) > 0;

                return (
                  <div
                    key={item.id}
                    className="p-3 bg-parchment-50 rounded-xl border border-parchment-200/90 flex flex-col space-y-1.5"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <span className="font-semibold text-sm text-ink-900 leading-tight block">
                          {item.product_name_snapshot}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-ink-500 font-mono">
                          <span>{formatCents(item.unit_price_cents_snapshot)} / ks</span>
                          {isPartiallyPaid && (
                            <span className="text-tea-700 font-semibold bg-tea-100 px-1.5 py-0.2 rounded">
                              Uhrazeno {item.paid_quantity}/{item.quantity} ks
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="font-bold text-sm text-ink-900">
                        {formatCents(itemTotal)}
                      </span>
                    </div>

                    {/* Poznámka */}
                    {item.note && (
                      <div className="text-xs bg-amberGold-500/10 text-amberGold-600 px-2 py-0.5 rounded font-medium inline-block">
                        Poznámka: {item.note}
                      </div>
                    )}

                    {/* Ovladače množství a stav doručení */}
                    <div className="flex items-center justify-between pt-1 border-t border-parchment-200/60">
                      <div className="flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => posService.updateItemQuantity(item.id, item.quantity - 1)}
                          className="w-8 h-8 rounded-lg bg-white border border-parchment-300 text-ink-700 flex items-center justify-center hover:bg-parchment-200 active:scale-95 transition-all"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center font-bold text-sm text-ink-900">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => posService.updateItemQuantity(item.id, item.quantity + 1)}
                          className="w-8 h-8 rounded-lg bg-white border border-parchment-300 text-ink-700 flex items-center justify-center hover:bg-parchment-200 active:scale-95 transition-all"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingItemNote(item)}
                          className="w-8 h-8 rounded-lg bg-white border border-parchment-300 text-ink-600 flex items-center justify-center hover:bg-parchment-200 transition-colors ml-1"
                          title="Přidat poznámku k přípravě"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => posService.removeItem(item.id)}
                          className="w-8 h-8 rounded-lg bg-white border border-parchment-300 text-terracotta-500 flex items-center justify-center hover:bg-red-50 transition-colors ml-1"
                          title="Odstranit položku"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Štítek doručení */}
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                          item.delivery_status === 'delivered'
                            ? 'bg-tea-100 text-tea-700'
                            : 'bg-amberGold-500/15 text-amberGold-600'
                        }`}
                      >
                        {item.delivery_status === 'delivered' ? (
                          <>
                            <Check className="w-3 h-3" /> Doručeno
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3" /> Čeká
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Finanční rekapitulace a tlačítko k platbě */}
          <div className="p-4 bg-parchment-100 border-t border-parchment-300 space-y-3 shrink-0">
            <div className="space-y-1.5 text-xs text-ink-600">
              <div className="flex justify-between">
                <span>Hodnota položek:</span>
                <span className="font-semibold text-ink-800">{formatCents(calc.totalCents)}</span>
              </div>
              {calc.paidCents > 0 && (
                <div className="flex justify-between text-tea-700">
                  <span>Již uhrazeno za zboží:</span>
                  <span className="font-semibold">-{formatCents(calc.paidCents)}</span>
                </div>
              )}
              {calc.totalTipsCents > 0 && (
                <div className="flex justify-between text-amberGold-600">
                  <span className="flex items-center gap-1">
                    <Heart className="w-3 h-3" /> Spropitné k účtu:
                  </span>
                  <span className="font-semibold">+{formatCents(calc.totalTipsCents)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-ink-900 pt-1 border-t border-parchment-300">
                <span>Zbývá k úhradě za zboží:</span>
                <span className="text-base text-tea-800">{formatCents(calc.remainingCents)}</span>
              </div>
            </div>

            {/* Tlačítko Zaplatit */}
            {calc.remainingCents > 0 ? (
              <button
                type="button"
                onClick={() => setIsPaymentOpen(true)}
                className="w-full py-3.5 bg-tea-600 text-white rounded-xl font-bold text-base shadow-md hover:bg-tea-700 active:scale-[0.98] transition-all flex items-center justify-center space-x-2"
              >
                <CreditCard className="w-5 h-5" />
                <span>Zaplatit vybrané položky / dýško</span>
              </button>
            ) : calc.totalCents > 0 ? (
              <div className="space-y-2">
                {currentPayments.length > 0 && (
                  <div className="p-3 bg-tea-50/90 rounded-xl border border-tea-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-tea-900">
                      <span className="flex items-center gap-1.5 text-tea-700">
                        <CheckCircle className="w-4 h-4 text-tea-600" /> Účet uhrazen
                      </span>
                      <span className="font-mono text-ink-900">
                        {formatCents(calc.paidCents + calc.totalTipsCents)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-ink-600">
                      <span>
                        Metoda:{' '}
                        <strong>
                          {currentPayments[currentPayments.length - 1].payment_method === 'card'
                            ? 'Kartou'
                            : 'Hotově'}
                        </strong>
                        {calc.totalTipsCents > 0 && ` (dýško ${formatCents(calc.totalTipsCents)})`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedPaymentIdForDetail(
                            currentPayments[currentPayments.length - 1].id
                          )
                        }
                        className="text-tea-700 font-bold hover:underline flex items-center gap-1"
                      >
                        <Receipt className="w-3.5 h-3.5" /> Upravit platbu
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleOpenNewOrderAfterPaid}
                  className="w-full py-3 bg-tea-700 text-white rounded-xl font-bold text-sm shadow hover:bg-tea-800 transition-all flex items-center justify-center space-x-2"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>
                    {selectedTableId
                      ? 'Účet plně uhrazen • Založit nový pro stůl'
                      : 'Účet plně uhrazen • Založit nový S sebou'}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Platební dialog */}
      {currentOrder && (
        <PaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          orderNumber={currentOrder.order_number}
          tableName={tableNameDisplay}
          totalCents={calc.totalCents}
          paidCents={calc.paidCents}
          remainingCents={calc.remainingCents}
          unpaidItems={currentItems}
          onConfirmPayment={handleConfirmPayment}
        />
      )}

      {/* Dialog poznámky k přípravě */}
      {editingItemNote && (
        <ItemNoteModal
          isOpen={Boolean(editingItemNote)}
          productName={editingItemNote.product_name_snapshot}
          initialNote={editingItemNote.note || ''}
          onClose={() => setEditingItemNote(null)}
          onSave={async (newNote) => {
            await posService.updateItemNote(editingItemNote.id, newNote);
          }}
        />
      )}

      {/* Dnešní platby pokladny */}
      <TodayTransactionsModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onSelectPayment={(paymentId) => {
          setSelectedPaymentIdForDetail(paymentId);
        }}
      />

      {/* Detail a úprava transakce */}
      <TransactionDetailModal
        isOpen={Boolean(selectedPaymentIdForDetail)}
        onClose={() => setSelectedPaymentIdForDetail(null)}
        paymentId={selectedPaymentIdForDetail}
      />
    </div>
  );
};
