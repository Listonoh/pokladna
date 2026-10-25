import React, { useState, useEffect } from 'react';
import { PaymentMethod, OrderItem, PaymentItemDetail, DiscountPercent } from '../../domain/types';
import { calculateDiscountCents, formatCents, czkToCents, centsToCzk } from '../../domain/calculations';
import { Banknote, CreditCard, X, CheckCircle, AlertCircle, Heart, CheckSquare, Square } from 'lucide-react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderNumber: string;
  tableName: string;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  unpaidItems: OrderItem[];
  onConfirmPayment: (
    amountCents: number,
    method: PaymentMethod,
    options: { tipAmountCents: number; paidItems: PaymentItemDetail[]; discountPercent: DiscountPercent }
  ) => Promise<void>;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  orderNumber,
  tableName,
  totalCents,
  paidCents,
  remainingCents,
  unpaidItems,
  onConfirmPayment,
}) => {
  // Položky, které ještě zbývá uhradit
  const payableItems = unpaidItems.filter((i) => {
    const paidQty = i.paid_quantity || 0;
    return i.delivery_status !== 'cancelled' && i.quantity > paidQty;
  });

  // Mapa vybraných kusů k úhradě: itemId -> vybrané množství
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [discountPercent, setDiscountPercent] = useState<DiscountPercent>(0);
  const [totalEnteredCzk, setTotalEnteredCzk] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inicializace: ve výchozím stavu jsou vybrány VŠECHNY nezaplacené položky
  useEffect(() => {
    const initial: Record<string, number> = {};
    let initialTotalCents = 0;

    payableItems.forEach((i) => {
      const remainingQty = i.quantity - (i.paid_quantity || 0);
      initial[i.id] = remainingQty;
      initialTotalCents += remainingQty * i.unit_price_cents_snapshot;
    });

    setSelectedQuantities(initial);
    setDiscountPercent(0);
    setTotalEnteredCzk(String(centsToCzk(initialTotalCents)));
    setErrorMessage(null);
  }, [isOpen]);

  if (!isOpen) return null;

  // Spočítat cenu vybraných položek (normální cena)
  const selectedItemsCostCents = payableItems.reduce((sum, item) => {
    const qty = selectedQuantities[item.id] || 0;
    return sum + (qty * item.unit_price_cents_snapshot);
  }, 0);

  const discountCents = calculateDiscountCents(selectedItemsCostCents, discountPercent);
  const discountedItemsCostCents = selectedItemsCostCents - discountCents;
  const enteredTotalCents = czkToCents(Number(totalEnteredCzk) || 0);
  const tipAmountCents = Math.max(0, enteredTotalCents - discountedItemsCostCents);

  // Validace
  const isNoItemSelected = selectedItemsCostCents <= 0;
  const isUnderpaid = enteredTotalCents < discountedItemsCostCents;

  const handleToggleSelectAll = (select: boolean) => {
    const updated: Record<string, number> = {};
    let newCostCents = 0;

    if (select) {
      payableItems.forEach((i) => {
        const remainingQty = i.quantity - (i.paid_quantity || 0);
        updated[i.id] = remainingQty;
        newCostCents += remainingQty * i.unit_price_cents_snapshot;
      });
    }

    setSelectedQuantities(updated);
    const newNetCents = newCostCents - calculateDiscountCents(newCostCents, discountPercent);
    setTotalEnteredCzk(String(centsToCzk(newNetCents)));
    setErrorMessage(null);
  };

  const handleItemQtyChange = (itemId: string, newQty: number, maxQty: number) => {
    const clampedQty = Math.max(0, Math.min(maxQty, newQty));
    const updated = { ...selectedQuantities, [itemId]: clampedQty };
    setSelectedQuantities(updated);

    // Přepočítat cenu položek po slevě a zachovat případné dýško.
    const newCostCents = payableItems.reduce((sum, item) => {
      const q = updated[item.id] || 0;
      return sum + (q * item.unit_price_cents_snapshot);
    }, 0);

    const currentTipCents = Math.max(0, enteredTotalCents - discountedItemsCostCents);
    const newNetCents = newCostCents - calculateDiscountCents(newCostCents, discountPercent);
    setTotalEnteredCzk(String(centsToCzk(newNetCents + currentTipCents)));
    setErrorMessage(null);
  };

  const handleDiscountChange = (nextDiscount: DiscountPercent) => {
    const currentTipCents = Math.max(0, enteredTotalCents - discountedItemsCostCents);
    const nextDiscountCents = calculateDiscountCents(selectedItemsCostCents, nextDiscount);
    setDiscountPercent(nextDiscount);
    setTotalEnteredCzk(String(centsToCzk(selectedItemsCostCents - nextDiscountCents + currentTipCents)));
    setErrorMessage(null);
  };

  const handleApplyTipPreset = (additionalCzk: number) => {
    const baseCzk = centsToCzk(discountedItemsCostCents);
    const currentCzk = Number(totalEnteredCzk) || baseCzk;

    setTotalEnteredCzk(String(currentCzk + additionalCzk));
    setErrorMessage(null);
  };

  const handleRoundTo = (step: number) => {
    const baseCzk = centsToCzk(discountedItemsCostCents);
    const rounded = Math.ceil(baseCzk / step) * step;
    const finalAmount = rounded === baseCzk ? baseCzk + step : rounded;
    setTotalEnteredCzk(String(finalAmount));
    setErrorMessage(null);
  };

  const handleConfirm = async () => {
    if (isNoItemSelected) {
      setErrorMessage('Vyberte prosím alespoň jednu položku k úhradě.');
      return;
    }
    if (isUnderpaid) {
      setErrorMessage(`Zadaná částka (${formatCents(enteredTotalCents)}) nepokrývá cenu vybraných položek po slevě (${formatCents(discountedItemsCostCents)}).`);
      return;
    }

    // Sestavení detailu placených položek
    const paidItems: PaymentItemDetail[] = [];
    for (const item of payableItems) {
      const qty = selectedQuantities[item.id] || 0;
      if (qty > 0) {
        paidItems.push({
          order_item_id: item.id,
          product_name: item.product_name_snapshot,
          unit_price_cents: item.unit_price_cents_snapshot,
          quantity: qty,
          total_cents: qty * item.unit_price_cents_snapshot,
        });
      }
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      await onConfirmPayment(discountedItemsCostCents, paymentMethod, {
        tipAmountCents,
        paidItems,
        discountPercent,
      });

      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Chyba při ukládání platby.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-3 select-none">
      <div className="bg-parchment-100 rounded-2xl shadow-2xl border border-parchment-300 w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Hlavička */}
        <div className="bg-tea-800 text-parchment-50 px-6 py-3.5 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Vyúčtování objednávky s dýškem</h2>
            <p className="text-xs text-tea-200">
              {tableName} • Účet #{orderNumber} • Celkem: {formatCents(totalCents)} (zaplaceno: {formatCents(paidCents)}) • Zbývá: {formatCents(remainingCents)}
            </p>
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
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* 1. VÝBĚR POLOŽEK K ÚHRADĚ */}
          <div className="bg-white rounded-xl border border-parchment-300 p-3.5 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between border-b border-parchment-200 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-ink-700">
                1. Vyberte položky k zaplacení ({payableItems.length})
              </span>
              <div className="flex items-center space-x-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleToggleSelectAll(true)}
                  className="text-tea-700 font-semibold hover:underline flex items-center gap-1"
                >
                  <CheckSquare className="w-3.5 h-3.5" /> Vybrat vše
                </button>
                <span className="text-parchment-300">•</span>
                <button
                  type="button"
                  onClick={() => handleToggleSelectAll(false)}
                  className="text-ink-500 font-medium hover:underline flex items-center gap-1"
                >
                  <Square className="w-3.5 h-3.5" /> Zrušit výběr
                </button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-parchment-100 pr-1 space-y-1">
              {payableItems.map((item) => {
                const remainingQty = item.quantity - (item.paid_quantity || 0);
                const currentSelectedQty = selectedQuantities[item.id] || 0;
                const isSelected = currentSelectedQty > 0;

                return (
                  <div
                    key={item.id}
                    className={`py-2 px-2 rounded-lg flex items-center justify-between transition-colors ${isSelected ? 'bg-tea-50/60' : 'opacity-60 hover:bg-parchment-50'
                      }`}
                  >
                    <div className="flex items-center space-x-2.5 flex-1 mr-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          handleItemQtyChange(item.id, e.target.checked ? remainingQty : 0, remainingQty)
                        }
                        className="w-4 h-4 rounded text-tea-600 focus:ring-tea-500"
                      />
                      <div>
                        <span className="text-sm font-semibold text-ink-900 block leading-tight">
                          {item.product_name_snapshot}
                        </span>
                        <span className="text-xs text-ink-500 font-mono">
                          {formatCents(item.unit_price_cents_snapshot)} / ks
                          {item.paid_quantity > 0 && ` (již uhrazeno ${item.paid_quantity} ks)`}
                        </span>
                      </div>
                    </div>

                    {/* Volba počtu kusů k úhradě */}
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center border border-parchment-300 rounded-lg bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleItemQtyChange(item.id, currentSelectedQty - 1, remainingQty)}
                          className="px-2 py-1 text-ink-600 hover:bg-parchment-200 text-xs font-bold"
                        >
                          -
                        </button>
                        <span className="px-2 py-1 text-xs font-bold text-ink-800">
                          {currentSelectedQty} / {remainingQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleItemQtyChange(item.id, currentSelectedQty + 1, remainingQty)}
                          className="px-2 py-1 text-ink-600 hover:bg-parchment-200 text-xs font-bold"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs font-bold text-ink-900 w-16 text-right">
                        {formatCents(currentSelectedQty * item.unit_price_cents_snapshot)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-parchment-100 p-2.5 rounded-lg flex justify-between items-center text-xs font-bold text-ink-800">
              <span>Cena vybraných položek (běžný účet):</span>
              <span className="text-sm text-tea-800">{formatCents(selectedItemsCostCents)}</span>
            </div>
          </div>

          {/* 2. ZADÁNÍ ZAPLACENÉ ČÁSTKY A SPROPITNÉHO */}
          <div className="bg-white rounded-xl border border-parchment-300 p-3.5 shadow-sm space-y-3">
            <div>
              <label htmlFor="paymentDiscount" className="text-xs font-bold uppercase tracking-wider text-ink-700 block mb-1.5">
                Sleva na vybrané položky
              </label>
              <select
                id="paymentDiscount"
                value={discountPercent}
                onChange={(e) => handleDiscountChange(Number(e.target.value) as DiscountPercent)}
                className="w-full rounded-lg border border-parchment-300 bg-white px-3 py-2 text-sm font-semibold text-ink-800"
              >
                <option value={0}>Bez slevy (0 %)</option>
                <option value={25}>Sleva 25 %</option>
                <option value={75}>Sleva 75 %</option>
              </select>
            </div>

            <label htmlFor="totalAmountInput" className="text-xs font-bold uppercase tracking-wider text-ink-700 block">
              2. Zaplacená částka vč. dýška (Kč)
            </label>

            <div className="relative">
              <input
                id="totalAmountInput"
                type="number"
                step="0.01"
                min={centsToCzk(discountedItemsCostCents)}
                value={totalEnteredCzk}
                onChange={(e) => {
                  setTotalEnteredCzk(e.target.value);
                  setErrorMessage(null);
                }}
                className={`w-full text-2xl font-black py-2.5 px-4 rounded-xl border-2 text-right bg-white ${isUnderpaid
                  ? 'border-terracotta-500 text-terracotta-500 focus:ring-terracotta-500'
                  : 'border-tea-600 text-ink-900 focus:outline-none'
                  }`}
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink-400 font-bold">
                Celkem přijato (Kč):
              </span>
            </div>

            {/* Rychlá tlačítka pro spropitné a zaokrouhlení */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-ink-500 mr-1 flex items-center gap-1 font-semibold">
                <Heart className="w-3.5 h-3.5 text-amberGold-500" /> Dýško:
              </span>
              <button
                type="button"
                onClick={() => {
                setTotalEnteredCzk(String(centsToCzk(discountedItemsCostCents)));
                  setErrorMessage(null);
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-parchment-300 bg-parchment-50 hover:bg-parchment-200 text-ink-700"
              >
                +0 Kč
              </button>
              <button
                type="button"
                onClick={() => handleApplyTipPreset(1)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-parchment-300 bg-white hover:bg-parchment-200 text-ink-700"
              >
                +1 Kč
              </button>
              <button
                type="button"
                onClick={() => handleApplyTipPreset(5)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-parchment-300 bg-white hover:bg-parchment-200 text-ink-700"
              >
                +5 Kč
              </button>
              <button
                type="button"
                onClick={() => handleApplyTipPreset(10)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-parchment-300 bg-white hover:bg-parchment-200 text-ink-700"
              >
                +10 Kč
              </button>
              <button
                type="button"
                onClick={() => handleRoundTo(10)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-tea-300 bg-tea-50 text-tea-800 hover:bg-tea-100"
              >
                Zaokrouhlit na 10 Kč
              </button>
              <button
                type="button"
                onClick={() => handleRoundTo(50)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-tea-300 bg-tea-50 text-tea-800 hover:bg-tea-100"
              >
                Zaokrouhlit na 50 Kč
              </button>
              <button
                type="button"
                onClick={() => handleRoundTo(100)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-tea-300 bg-tea-50 text-tea-800 hover:bg-tea-100"
              >
                Zaokrouhlit na 100 Kč
              </button>
            </div>

            {/* Rozpad do databáze */}
            <div className="grid grid-cols-2 gap-2 bg-parchment-100 p-3 rounded-xl border border-parchment-300/80 text-xs">
              <div>
                <span className="text-ink-500 block">Zboží po slevě:</span>
                <span className="text-sm font-bold text-ink-900">
                  {formatCents(discountedItemsCostCents)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-ink-500 block">Spropitné (odděleno v DB):</span>
                <span className={`text-sm font-black ${tipAmountCents > 0 ? 'text-amberGold-600' : 'text-ink-600'}`}>
                  +{formatCents(tipAmountCents)}
                </span>
              </div>
              {discountCents > 0 && (
                <div className="col-span-2 flex justify-between border-t border-parchment-200 pt-2">
                  <span className="text-ink-500">Sleva {discountPercent} % z {formatCents(selectedItemsCostCents)}:</span>
                  <span className="font-bold text-tea-800">−{formatCents(discountCents)}</span>
                </div>
              )}
            </div>
          </div>

          {/* 3. VOLBA METODY */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-semibold border-2 transition-all ${paymentMethod === 'cash'
                ? 'border-tea-600 bg-tea-50 text-tea-800 shadow-sm'
                : 'border-parchment-300 bg-white text-ink-600 hover:bg-parchment-50'
                }`}
            >
              <Banknote className="w-5 h-5 text-tea-600" />
              <span>Hotově</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-semibold border-2 transition-all ${paymentMethod === 'card'
                ? 'border-tea-600 bg-tea-50 text-tea-800 shadow-sm'
                : 'border-parchment-300 bg-white text-ink-600 hover:bg-parchment-50'
                }`}
            >
              <CreditCard className="w-5 h-5 text-tea-600" />
              <span>Kartou</span>
            </button>
          </div>

          {/* Chybová zpráva */}
          {errorMessage && (
            <div className="flex items-center space-x-2 text-terracotta-500 bg-red-50 p-3 rounded-xl border border-red-200 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Tlačítka potvrzení */}
        <div className="bg-parchment-200/80 px-6 py-3.5 flex items-center justify-between border-t border-parchment-300 shrink-0">
          <div className="text-xs text-ink-600">
            <span>K úhradě celkem: </span>
            <strong className="text-sm font-black text-ink-900">
              {formatCents(enteredTotalCents)}
            </strong>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl font-medium text-xs text-ink-600 hover:bg-parchment-300/60 transition-colors"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || isNoItemSelected || isUnderpaid}
              className={`flex items-center space-x-1.5 px-5 py-2.5 rounded-xl font-bold text-xs text-white shadow-md transition-all ${isSubmitting || isNoItemSelected || isUnderpaid
                ? 'bg-ink-300 cursor-not-allowed'
                : 'bg-tea-600 hover:bg-tea-700 active:scale-[0.98]'
                }`}
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isSubmitting ? 'Ukládám...' : `Zaúčtovat platbu (${formatCents(enteredTotalCents)})`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
