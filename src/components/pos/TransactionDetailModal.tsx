import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/posDatabase';
import { posService } from '../../domain/posService';
import { PaymentMethod } from '../../domain/types';
import { formatCents, czkToCents, centsToCzk } from '../../domain/calculations';
import {
  X,
  CreditCard,
  Banknote,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Receipt,
  Heart,
  Save,
} from 'lucide-react';

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentId: string | null;
  onPaymentUpdated?: () => void;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  isOpen,
  onClose,
  paymentId,
  onPaymentUpdated,
}) => {
  if (!isOpen || !paymentId) return null;

  const payment = useLiveQuery(
    async () => (paymentId ? await db.payments.get(paymentId) : undefined),
    [paymentId]
  );

  const order = useLiveQuery(
    async () => (payment?.order_id ? await db.orders.get(payment.order_id) : undefined),
    [payment?.order_id]
  );

  const table = useLiveQuery(
    async () => (order?.table_id ? await db.pos_tables.get(order.table_id) : undefined),
    [order?.table_id]
  );

  const orderItems = useLiveQuery(
    async () => (payment?.order_id ? await db.order_items.where({ order_id: payment.order_id }).toArray() : []),
    [payment?.order_id]
  ) ?? [];

  // Lokální stav editace
  const [editedMethod, setEditedMethod] = useState<PaymentMethod>('cash');
  const [editedTipCzk, setEditedTipCzk] = useState<string>('0');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('Chyba obsluhy / storno');

  // Inicializace stavu při načtení platby
  useEffect(() => {
    if (payment) {
      setEditedMethod(payment.payment_method);
      setEditedTipCzk(String(centsToCzk(payment.tip_amount_cents || 0)));
      setErrorMessage(null);
      setSuccessMessage(null);
      setShowCancelConfirm(false);
    }
  }, [payment]);

  if (!payment) {
    return (
      <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-3">
        <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full text-center">
          <p className="text-sm text-ink-600">Načítání údajů o platbě...</p>
        </div>
      </div>
    );
  }

  const isCancelled = payment.status === 'cancelled';
  const tableName = table ? table.name : order ? 'S sebou' : 'Neznámý účet';
  const orderNumber = order ? order.order_number : '—';

  // Naformátovaný čas
  const formattedTime = new Date(payment.created_at).toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Zjištění položek zahrnutých v této platbě
  const itemsToDisplay =
    payment.paid_items && payment.paid_items.length > 0
      ? payment.paid_items
      : orderItems.map((oi) => ({
          order_item_id: oi.id,
          product_name: oi.product_name_snapshot,
          unit_price_cents: oi.unit_price_cents_snapshot,
          quantity: oi.quantity,
          total_cents: oi.quantity * oi.unit_price_cents_snapshot,
        }));
  const grossItemsCents = itemsToDisplay.reduce((sum, item) => sum + item.total_cents, 0);

  // Změna formuláře
  const currentTipCents = czkToCents(Math.max(0, Number(editedTipCzk) || 0));
  const newTotalReceivedCents = payment.amount_cents + currentTipCents;
  const isDirty =
    editedMethod !== payment.payment_method ||
    currentTipCents !== (payment.tip_amount_cents || 0);

  const handleSaveChanges = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      await posService.updatePayment(payment.id, {
        paymentMethod: editedMethod,
        tipAmountCents: currentTipCents,
      });

      setSuccessMessage('Změny platby byly úspěšně uloženy.');
      if (onPaymentUpdated) {
        onPaymentUpdated();
      }
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Chyba při ukládání úprav platby.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPayment = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      await posService.cancelPayment(payment.id, cancelReason || 'Storno z detailu transakce');

      setSuccessMessage('Platba byla stornována a účet byl znovu otevřen.');
      setShowCancelConfirm(false);
      if (onPaymentUpdated) {
        onPaymentUpdated();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Chyba při stornování platby.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-3 select-none">
      <div className="bg-parchment-100 rounded-2xl shadow-2xl border border-parchment-300 w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Hlavička */}
        <div className="bg-tea-800 text-parchment-50 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-tea-700/80 border border-tea-500/40 flex items-center justify-center text-tea-200">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                Detail a úprava transakce
                {isCancelled && (
                  <span className="text-xs bg-rose-500/80 text-white px-2 py-0.5 rounded-full font-bold">
                    Stornováno
                  </span>
                )}
              </h2>
              <p className="text-xs text-tea-200">
                {tableName} • Účet #{orderNumber} • {formattedTime}
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

        {/* Scrollovatelný obsah */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Oznámení */}
          {successMessage && (
            <div className="flex items-center space-x-2 text-tea-800 bg-tea-50 p-3.5 rounded-xl border border-tea-300 text-xs font-semibold">
              <CheckCircle className="w-4 h-4 text-tea-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center space-x-2 text-terracotta-500 bg-red-50 p-3.5 rounded-xl border border-red-200 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isCancelled && (
            <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl text-xs text-rose-800 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                Tato platba byla stornována
              </p>
              <p>
                Důvod: <span className="font-medium">{payment.cancel_reason || 'Neuveden'}</span>
              </p>
              {payment.cancelled_at && (
                <p className="text-[11px] text-rose-600">
                  Čas storna: {new Date(payment.cancelled_at).toLocaleString('cs-CZ')}
                </p>
              )}
            </div>
          )}

          {/* 1. ROZPAD POLOŽEK NA ÚČTENCE */}
          <div className="bg-white rounded-xl border border-parchment-300 p-4 shadow-sm space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-700 border-b border-parchment-200 pb-2 flex items-center justify-between">
              <span>Položky na této transakci ({itemsToDisplay.length})</span>
              <span className="text-ink-500 font-normal normal-case">Cena za zboží</span>
            </h3>

            <div className="max-h-44 overflow-y-auto divide-y divide-parchment-100 pr-1 space-y-1">
              {itemsToDisplay.map((item, idx) => (
                <div key={idx} className="py-1.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-ink-900 block">{item.product_name}</span>
                    <span className="text-[11px] text-ink-500 font-mono">
                      {item.quantity} ks × {formatCents(item.unit_price_cents)}
                    </span>
                  </div>
                  <span className="font-bold text-ink-900">{formatCents(item.total_cents)}</span>
                </div>
              ))}
            </div>

            {/* Součet položek */}
            {(payment.discount_cents || 0) > 0 && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-ink-500">Zboží před slevou:</span>
                <span className="font-semibold">{formatCents(grossItemsCents)}</span>
              </div>
            )}
            <div className="bg-parchment-100 p-2.5 rounded-lg flex justify-between items-center text-xs font-bold text-ink-800">
              <span>Zboží po slevě:</span>
              <span className="text-sm text-tea-800">{formatCents(payment.amount_cents)}</span>
            </div>
            {(payment.discount_cents || 0) > 0 && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-ink-500">Sleva ({payment.discount_percent || 0}%):</span>
                <span className="font-semibold text-tea-800">−{formatCents(payment.discount_cents || 0)}</span>
              </div>
            )}
          </div>

          {/* 2. ÚPRAVA PLATEBNÍ METODY A DÝŠKA (POKUD NENÍ STORNOVÁNO) */}
          {!isCancelled ? (
            <div className="bg-white rounded-xl border border-parchment-300 p-4 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-700 border-b border-parchment-200 pb-2">
                Úprava platby (oprava chyby Hotovost / Karta)
              </h3>

              {/* Volba metody: Karta vs Hotovost */}
              <div>
                <label className="text-xs font-semibold text-ink-700 block mb-2">
                  Způsob úhrady:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEditedMethod('cash')}
                    className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-bold text-sm border-2 transition-all ${
                      editedMethod === 'cash'
                        ? 'border-tea-600 bg-tea-50 text-tea-800 shadow-sm'
                        : 'border-parchment-300 bg-white text-ink-600 hover:bg-parchment-50'
                    }`}
                  >
                    <Banknote className="w-5 h-5 text-tea-600" />
                    <span>Hotově</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditedMethod('card')}
                    className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-bold text-sm border-2 transition-all ${
                      editedMethod === 'card'
                        ? 'border-tea-600 bg-tea-50 text-tea-800 shadow-sm'
                        : 'border-parchment-300 bg-white text-ink-600 hover:bg-parchment-50'
                    }`}
                  >
                    <CreditCard className="w-5 h-5 text-tea-600" />
                    <span>Kartou</span>
                  </button>
                </div>
              </div>

              {/* Úprava spropitného */}
              <div>
                <label htmlFor="editTipInput" className="text-xs font-semibold text-ink-700 flex items-center gap-1 mb-1.5">
                  <Heart className="w-3.5 h-3.5 text-amberGold-500" />
                  Spropitné / dýško (Kč):
                </label>
                <div className="flex items-center space-x-2">
                  <div className="relative flex-1">
                    <input
                      id="editTipInput"
                      type="number"
                      step="1"
                      min="0"
                      value={editedTipCzk}
                      onChange={(e) => setEditedTipCzk(e.target.value)}
                      className="w-full text-base font-bold py-2 px-3 rounded-xl border border-parchment-300 bg-white text-right focus:border-tea-600 focus:outline-none"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-400 font-semibold">
                      Dýško:
                    </span>
                  </div>

                  {/* Rychlá tlačítka pro dýško */}
                  <button
                    type="button"
                    onClick={() => setEditedTipCzk('0')}
                    className="px-2.5 py-2 rounded-xl text-xs font-semibold border border-parchment-300 bg-parchment-50 hover:bg-parchment-200 text-ink-700"
                  >
                    0 Kč
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditedTipCzk('5')}
                    className="px-2.5 py-2 rounded-xl text-xs font-semibold border border-parchment-300 bg-white hover:bg-parchment-200 text-ink-700"
                  >
                    5 Kč
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditedTipCzk('10')}
                    className="px-2.5 py-2 rounded-xl text-xs font-semibold border border-parchment-300 bg-white hover:bg-parchment-200 text-ink-700"
                  >
                    10 Kč
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditedTipCzk('20')}
                    className="px-2.5 py-2 rounded-xl text-xs font-semibold border border-parchment-300 bg-white hover:bg-parchment-200 text-ink-700"
                  >
                    20 Kč
                  </button>
                </div>
              </div>

              {/* Rekapitulace po úpravě */}
              <div className="grid grid-cols-2 gap-2 bg-parchment-100 p-3 rounded-xl border border-parchment-300 text-xs">
                <div>
                  <span className="text-ink-500 block">Zboží:</span>
                  <span className="text-sm font-bold text-ink-900">{formatCents(payment.amount_cents)}</span>
                </div>
                <div className="text-right">
                  <span className="text-ink-500 block">Celkem přijato ({editedMethod === 'card' ? 'karta' : 'hotovost'}):</span>
                  <span className="text-sm font-black text-tea-800">
                    {formatCents(newTotalReceivedCents)}
                  </span>
                </div>
              </div>

              {/* Uložení změn */}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleSaveChanges}
                  disabled={isSubmitting || !isDirty}
                  className={`flex items-center space-x-1.5 px-4 py-2.5 rounded-xl font-bold text-xs transition-all ${
                    isDirty
                      ? 'bg-tea-600 hover:bg-tea-700 text-white shadow-md active:scale-[0.98]'
                      : 'bg-parchment-200 text-ink-400 cursor-not-allowed'
                  }`}
                >
                  <Save className="w-4 h-4" />
                  <span>{isSubmitting ? 'Ukládám...' : 'Uložit změny transakce'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-parchment-300 p-4 shadow-sm text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-ink-500">Původní způsob platby:</span>
                <span className="font-semibold">{payment.payment_method === 'card' ? 'Kartou' : 'Hotově'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Spropitné:</span>
                <span className="font-semibold">{formatCents(payment.tip_amount_cents || 0)}</span>
              </div>
              {(payment.discount_cents || 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-500">Sleva ({payment.discount_percent || 0}%):</span>
                  <span className="font-semibold">−{formatCents(payment.discount_cents || 0)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-parchment-200 pt-2 font-bold text-sm">
                <span>Celková částka:</span>
                <span>{formatCents(payment.amount_cents + (payment.tip_amount_cents || 0))}</span>
              </div>
            </div>
          )}

          {/* 3. STORNO PLATBY */}
          {!isCancelled && (
            <div className="bg-white rounded-xl border border-parchment-300 p-4 shadow-sm space-y-3">
              {!showCancelConfirm ? (
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-ink-800">Kompletní storno této platby</h4>
                    <p className="text-[11px] text-ink-500">
                      Vrátí platbu, znovu otevře účet a umožní novou úhradu či úpravu položek.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="px-3 py-1.5 text-xs font-semibold text-terracotta-600 hover:text-white hover:bg-terracotta-500 border border-terracotta-300 rounded-lg transition-colors flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Stornovat platbu</span>
                  </button>
                </div>
              ) : (
                <div className="bg-red-50 p-3.5 rounded-xl border border-red-200 space-y-3 text-xs">
                  <div className="flex items-center space-x-2 text-terracotta-600 font-bold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Opravdu chcete stornovat tuto platbu?</span>
                  </div>
                  <p className="text-ink-600 text-[11px]">
                    Částka {formatCents(payment.amount_cents + payment.tip_amount_cents)} bude odečtena z tržby.
                    Objednávka bude znovu označena jako otevřená.
                  </p>
                  <div>
                    <label className="text-[11px] font-semibold text-ink-700 block mb-1">
                      Důvod storna:
                    </label>
                    <input
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Např. Chybně namarkováno, reklamace..."
                      className="w-full text-xs p-2 rounded-lg border border-red-300 bg-white focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end space-x-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(false)}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-ink-600 hover:bg-parchment-200 transition-colors"
                    >
                      Zpět
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelPayment}
                      disabled={isSubmitting}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-terracotta-500 hover:bg-terracotta-600 shadow transition-colors flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{isSubmitting ? 'Stornuji...' : 'Potvrdit storno platby'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Spodní lišta */}
        <div className="bg-parchment-200/80 px-6 py-3.5 flex items-center justify-between border-t border-parchment-300 shrink-0">
          <div className="text-xs text-ink-600">
            <span>Stav: </span>
            <strong className={isCancelled ? 'text-rose-600' : 'text-tea-800'}>
              {isCancelled ? 'Stornováno' : 'Uhrazeno'}
            </strong>
          </div>

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
