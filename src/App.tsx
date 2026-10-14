import React, { useState, useEffect } from 'react';
import { Header, ActiveTab } from './components/Header';
import { PosView } from './components/pos/PosView';
import { DeliveryView } from './components/delivery/DeliveryView';
import { ReportsView } from './components/reports/ReportsView';
import { AdminView } from './components/admin/AdminView';
import { seedInitialDataIfEmpty } from './db/posDatabase';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('pos');
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    async function init() {
      await seedInitialDataIfEmpty();
      setIsInitialized(true);
    }
    init();
  }, []);

  if (!isInitialized) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-parchment-100 text-ink-700">
        <div className="w-12 h-12 border-4 border-tea-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-semibold text-sm">Načítání pokladního systému čajovny...</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-parchment-100">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'pos' && <PosView />}
        {activeTab === 'delivery' && <DeliveryView />}
        {activeTab === 'reports' && <ReportsView />}
        {activeTab === 'admin' && <AdminView />}
      </main>
    </div>
  );
};

export default App;
