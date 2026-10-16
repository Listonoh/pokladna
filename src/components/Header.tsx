import React, { useEffect, useState } from 'react';
import { Leaf, Wifi, WifiOff, RefreshCw, ShoppingCart, Truck, BarChart3, Settings, AlertCircle, X, Trash2 } from 'lucide-react';
import { syncEngine } from '../api/syncEngine';
import { db } from '../db/posDatabase';
import { useLiveQuery } from 'dexie-react-hooks';

export type ActiveTab = 'pos' | 'delivery' | 'reports' | 'admin';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange }) => {
  const [syncState, setSyncState] = useState({
    isOnline: syncEngine.isOnline,
    pendingCount: syncEngine.pendingCount,
    lastError: syncEngine.lastError,
    isProcessing: syncEngine.isProcessing,
  });
  const [showErrorModal, setShowErrorModal] = useState(false);

  const [currentTime, setCurrentTime] = useState('');

  // Sledování počtu čekajících položek k doručení
  const pendingDeliveryCount = useLiveQuery(async () => {
    return await db.order_items
      .where('delivery_status')
      .equals('pending')
      .count();
  }, []) ?? 0;

  useEffect(() => {
    const unsubscribe = syncEngine.subscribe(() => {
      setSyncState({
        isOnline: syncEngine.isOnline,
        pendingCount: syncEngine.pendingCount,
        lastError: syncEngine.lastError,
        isProcessing: syncEngine.isProcessing,
      });
    });

    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        new Intl.DateTimeFormat('cs-CZ', {
          timeZone: 'Europe/Prague',
          hour: '2-digit',
          minute: '2-digit',
          day: 'numeric',
          month: 'numeric',
        }).format(now)
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="bg-tea-800 text-parchment-50 px-4 py-2.5 flex items-center justify-between shadow-md select-none">
      {/* Logo a název */}
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-xl bg-tea-600/40 border border-tea-400/30 flex items-center justify-center text-tea-200 shadow-inner">
          <Leaf className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-semibold text-lg tracking-wide leading-tight flex items-center gap-2">
            Miska s Listím
            <span className="text-xs bg-tea-700/70 text-tea-200 px-2 py-0.5 rounded-full font-normal border border-tea-600">
              Pokladna
            </span>
          </h1>
          <p className="text-xs text-tea-200/80 font-mono">{currentTime}</p>
        </div>
      </div>

      {/* Hlavní navigace (4 sekce) */}
      <nav className="flex items-center space-x-1.5 bg-tea-900/40 p-1 rounded-xl border border-tea-700/50">
        <button
          type="button"
          onClick={() => onTabChange('pos')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'pos'
              ? 'bg-tea-600 text-white shadow-sm'
              : 'text-tea-100/80 hover:bg-tea-800 hover:text-white'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>Pokladna</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('delivery')}
          className={`relative flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'delivery'
              ? 'bg-tea-600 text-white shadow-sm'
              : 'text-tea-100/80 hover:bg-tea-800 hover:text-white'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>K doručení</span>
          {pendingDeliveryCount > 0 && (
            <span className="ml-1.5 px-2 py-0.5 text-xs font-bold rounded-full bg-amberGold-500 text-white animate-pulse">
              {pendingDeliveryCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onTabChange('reports')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'reports'
              ? 'bg-tea-600 text-white shadow-sm'
              : 'text-tea-100/80 hover:bg-tea-800 hover:text-white'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Přehled</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('admin')}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'admin'
              ? 'bg-tea-600 text-white shadow-sm'
              : 'text-tea-100/80 hover:bg-tea-800 hover:text-white'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Správa</span>
        </button>
      </nav>

      {/* Stav sítě a synchronizace */}
      <div className="flex items-center space-x-3">
        {syncState.isOnline ? (
          <div className="flex items-center space-x-1.5 text-xs bg-tea-700/50 px-2.5 py-1.5 rounded-lg border border-tea-600/50 text-tea-100">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span>Online</span>
          </div>
        ) : (
          <div className="flex items-center space-x-1.5 text-xs bg-amberGold-600/30 px-2.5 py-1.5 rounded-lg border border-amberGold-500 text-amber-200">
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            <span>Offline režim</span>
          </div>
        )}

        {syncState.pendingCount > 0 && (
          <button
            type="button"
            onClick={() => {
              if (syncState.lastError) {
                setShowErrorModal(true);
              } else {
                syncEngine.triggerSync();
              }
            }}
            title={
              syncState.lastError
                ? `Chyba synchronizace: ${syncState.lastError}. Klikněte pro zobrazení detailu.`
                : 'Kliknutím spustíte synchronizaci'
            }
            className={`flex items-center space-x-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
              syncState.lastError
                ? 'bg-rose-700/90 hover:bg-rose-600 text-white border border-rose-500/60 shadow-sm'
                : 'bg-tea-600 hover:bg-tea-500 text-parchment-50'
            }`}
          >
            {syncState.lastError ? (
              <AlertCircle className="w-3.5 h-3.5 text-rose-200" />
            ) : (
              <RefreshCw className={`w-3 h-3 ${syncState.isProcessing ? 'animate-spin' : ''}`} />
            )}
            <span>
              {syncState.lastError
                ? `Chyba syncu (${syncState.pendingCount})`
                : `Fronta: ${syncState.pendingCount}`}
            </span>
          </button>
        )}
      </div>

      {/* Dialog s detailem chyby synchronizace */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-parchment-50 text-tea-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-200">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-rose-950">
                    Chyba synchronizace se serverem
                  </h3>
                  <p className="text-xs text-stone-500">
                    Data zůstávají bezpečně uložena v lokální paměti pokladny.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowErrorModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 mb-4 text-xs font-mono text-rose-900 break-words whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
              {syncState.lastError || 'Neznámá chyba při komunikaci se serverem.'}
            </div>

            <p className="text-xs text-stone-600 mb-5 leading-relaxed">
              Pokladna funguje nepřetržitě i bez spojení se serverem. Po vyřešení příčiny (např. úprava RLS politik v Supabase SQL Editoru nebo připojení k síti) můžete zkusit data odeslat znovu.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <button
                type="button"
                onClick={async () => {
                  if (window.confirm('Opravdu chcete vyprázdnit frontu synchronizace? Položky, které dosud nebyly úspěšně odeslány do Supabase, budou z fronty odstraněny.')) {
                    await syncEngine.clearOutbox();
                    setShowErrorModal(false);
                  }
                }}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-100/60 transition-colors"
                title="Smaže neodeslané položky z fronty synchronizace (např. po změně schématu na serveru)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Zahodit frontu syncu</span>
              </button>

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowErrorModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-xl border border-stone-300 text-stone-700 hover:bg-stone-100 transition-colors"
                >
                  Zavřít
                </button>
                <button
                  type="button"
                  onClick={() => {
                    syncEngine.triggerSync();
                    setShowErrorModal(false);
                  }}
                  className="flex items-center space-x-1.5 px-4 py-2 text-xs rounded-xl bg-tea-700 text-white font-medium hover:bg-tea-800 transition-colors shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Zkusit odeslat znovu</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
