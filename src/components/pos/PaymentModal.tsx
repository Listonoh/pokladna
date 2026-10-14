import React, { useState } from 'react';
import { PaymentMethod } from '../../domain/types';
import { formatCents, czkToCents, centsToCzk } from '../../domain/calculations';
import { Banknote, CreditCard, X, CheckCircle, AlertCircle } from 'lucide-react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderNumber: string;
  tableName: string;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  onConfirmPayment: (amountCents: number, method: PaymentMethod) => Promise<void>;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  orderNumber,
  tableName,
  totalCents,
  paidCents,
  remainingCents,
  onConfirmPayment,
}) => {
  if (!isOpen) return null;

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountInputCzk, setAmountInputCzk] = useState<string>(
    String(centsToCzk(remainingCents))
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const enteredCents = czkToCents(Number(amountInputCzk) || 0);
  const remainingAfterPayment = Math.max(0, remainingCents - enteredCents);
  const isOverpayment = enteredCents > remainingCents;
  const isInvalidAmount = enteredCents <= 0 || isNaN(enteredCents);

  const handleSetQuickAmount = (czk: number) => {
    setAmountInputCzk(String(czk));
    setErrorMessage(null);
  };

  const handleFullAmount = () => {
    setAmountInputCzk(String(centsToCzk(remainingCents)));
    setErrorMessage(null);
  };

  const handleConfirm = async () => {
    if (isInvalidAmount) {
      setErrorMessage('Zadejte prosím platnou částku k úhradě.');
      return;
    }
    if (isOverpayment) {
      setErrorMessage(`Nelze zaplatit více než zbývající dluh (${formatCents(remainingCents)}).`);
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      await onConfirmPayment(enteredCents, paymentMethod);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Chyba při ukládání platby.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-parchment-100 rounded-2xl shadow-2xl border border-parchment-300 w-full max-w-lg overflow-hidden flex flex-col">
        {/* Hlavička */}
        <div className="bg-tea-800 text-parchment-50 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Vyúčtování objednávky</h2>
            <p className="text-sm text-tea-200">
              {tableName} • Účet #{orderNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-tea-200 hover:text-white rounded-lg hover:bg-tea-700/60 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Přehled částek */}
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-3 gap-3 bg-parchment-200/80 p-4 rounded-xl border border-parchment-300/60 text-center">
            <div>
              <span className="text-xs text-ink-500 block uppercase font-medium">Celkem účet</span>
              <span className="text-lg font-bold text-ink-800">{formatCents(totalCents)}</span>
            </div>
            <div>
              <span className="text-xs text-ink-500 block uppercase font-medium">Zaplaceno</span>
              <span className="text-lg font-semibold text-tea-600">{formatCents(paidCents)}</span>
            </div>
            <div>
              <span className="text-xs text-ink-500 block uppercase font-medium">Zbývá doplatit</span>
              <span className="text-xl font-black text-amberGold-600">
                {formatCents(remainingCents)}
              </span>
            </div>
          </div>

          {/* Volba platební metody */}
          <div>
            <label className="block text-sm font-semibold text-ink-700 mb-2">
              Platební metoda
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`flex items-center justify-center space-x-3 py-3.5 px-4 rounded-xl font-semibold border-2 transition-all ${
                  paymentMethod === 'cash'
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
                className={`flex items-center justify-center space-x-3 py-3.5 px-4 rounded-xl font-semibold border-2 transition-all ${
                  paymentMethod === 'card'
                    ? 'border-tea-600 bg-tea-50 text-tea-800 shadow-sm'
                    : 'border-parchment-300 bg-white text-ink-600 hover:bg-parchment-50'
                }`}
              >
                <CreditCard className="w-5 h-5 text-tea-600" />
                <span>Kartou</span>
              </button>
            </div>
          </div>

          {/* Zadaná částka */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label htmlFor="amountInput" className="text-sm font-semibold text-ink-700">Částka k úhradě (Kč)</label>
              <button
                type="button"
                onClick={handleFullAmount}
                className="text-xs font-semibold text-tea-600 hover:text-tea-800 hover:underline"
              >
                Celý zbývající dluh ({formatCents(remainingCents)})
              </button>
            </div>

            <div className="relative">
              <input
                id="amountInput"
                type="number"
                step="1"
                min="1"
                max={centsToCzk(remainingCents)}
                value={amountInputCzk}
                onChange={(e) => {
                  setAmountInputCzk(e.target.value);
                  setErrorMessage(null);
                }}
                className={`w-full text-2xl font-bold py-3 px-4 rounded-xl border-2 text-right bg-white ${
                  isOverpayment
                    ? 'border-terracotta-500 text-terracotta-500 focus:ring-terracotta-500'
                    : 'border-parchment-300 text-ink-800 focus:border-tea-600 focus:outline-none'
                }`}
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg text-ink-400 font-semibold">
                Kč
              </span>
            </div>

            {/* Rychlá tlačítka pro částečné platby */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              {[50, 100, 200, 500].map((preset) => {
                const disabled = preset > centsToCzk(remainingCents);
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSetQuickAmount(preset)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      disabled
                        ? 'opacity-40 border-parchment-200 bg-parchment-100 text-ink-400 cursor-not-allowed'
                        : 'border-parchment-300 bg-white text-ink-700 hover:bg-parchment-200'
                    }`}
                  >
                    +{preset} Kč
                  </button>
                );
              })}
            </div>
          </div>

          {/* Informace po této platbě */}
          <div className="bg-parchment-50 p-3 rounded-lg border border-parchment-300/80 text-xs flex justify-between items-center text-ink-600">
            <span>Po této platbě zbude doplatit:</span>
            <span className="font-bold text-sm text-ink-800">
              {formatCents(remainingAfterPayment)}
            </span>
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
        <div className="bg-parchment-200/60 px-6 py-4 flex items-center justify-end space-x-3 border-t border-parchment-300">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-5 py-3 rounded-xl font-medium text-ink-600 hover:bg-parchment-300/60 transition-colors"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || isInvalidAmount || isOverpayment}
            className={`flex items-center space-x-2 px-6 py-3 rounded-xl font-bold text-white shadow-md transition-all ${
              isSubmitting || isInvalidAmount || isOverpayment
                ? 'bg-ink-300 cursor-not-allowed'
                : 'bg-tea-600 hover:bg-tea-700 active:scale-[0.98]'
            }`}
          >
            <CheckCircle className="w-5 h-5" />
            <span>{isSubmitting ? 'Ukládám...' : `Potvrdit platbu (${formatCents(enteredCents)})`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
