import React, { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, clearTransactionsOnly, resetEntireDatabase } from '../../db/posDatabase';
import { createLocalBackup, parseLocalBackup, restoreLocalBackup } from '../../db/backup';
import { syncEngine } from '../../api/syncEngine';
import { generateUUID } from '../../domain/posService';
import { Product, Category, Table, ButtonColor } from '../../domain/types';
import { formatCents, czkToCents, centsToCzk } from '../../domain/calculations';
import { BUTTON_COLORS } from '../../domain/buttonColors';
import { Plus, Edit2, Star, Check, X, Eye, EyeOff, Trash2, Database, RotateCcw, AlertTriangle, Download, Upload } from 'lucide-react';

export const AdminView: React.FC = () => {
  const backupFileInput = useRef<HTMLInputElement>(null);
  const categories: Category[] = useLiveQuery(() => db.categories.orderBy('sort_order').toArray()) ?? [];
  const products: Product[] = useLiveQuery(() => db.products.orderBy('sort_order').toArray()) ?? [];
  const tables: Table[] = useLiveQuery(() => db.pos_tables.orderBy('sort_order').toArray()) ?? [];

  const handleExportBackup = async () => {
    try {
      const backup = await createLocalBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pokladna-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      alert(`Zálohu se nepodařilo vytvořit: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleImportBackup = async (file?: File) => {
    if (!file) return;
    if (syncEngine.isProcessing) {
      alert('Obnovu nelze spustit během synchronizace. Počkejte na její dokončení.');
      return;
    }

    try {
      const backup = parseLocalBackup(await file.text());
      const counts = Object.entries(backup.data)
        .map(([table, rows]) => `${table}: ${rows.length}`)
        .join('\n');
      if (!window.confirm(
        `Obnovit tuto zálohu do lokálního zařízení?\n\n${counts}\n\n` +
        'Tím se nahradí všechna současná lokální data včetně čekající fronty synchronizace. ' +
        'Obnova sama o sobě nic nezapisuje do cloudu, ale obnovené čekající změny se mohou synchronizovat později. Pokračovat?'
      )) return;

      await restoreLocalBackup(backup);
      await syncEngine.updatePendingCount();
      alert('Lokální data byla obnovena ze zálohy. Samotná obnova cloud nezměnila; čekající změny se mohou synchronizovat později.');
    } catch (error) {
      alert(`Zálohu se nepodařilo obnovit: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (backupFileInput.current) backupFileInput.current.value = '';
    }
  };

  // Editace / Vytvoření produktu modal
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [productPriceCzk, setProductPriceCzk] = useState<string>('');
  const [editingTable, setEditingTable] = useState<Partial<Table> | null>(null);

  const handleOpenNewProduct = () => {
    setEditingProduct({
      id: generateUUID(),
      name: '',
      category_id: categories[0]?.id || '',
      price_cents: 9500,
      is_favorite: false,
      sort_order: products.length + 1,
      is_active: true,
      button_color: 'default',
    });
    setProductPriceCzk('95');
  };

  const handleOpenEditProduct = (p: Product) => {
    setEditingProduct({ ...p });
    setProductPriceCzk(String(centsToCzk(p.price_cents)));
  };

  const handleSaveProduct = async () => {
    if (!editingProduct || !editingProduct.name || !editingProduct.category_id) return;

    const priceCents = czkToCents(Number(productPriceCzk) || 0);
    const now = new Date().toISOString();

    const productData: Product = {
      id: editingProduct.id || generateUUID(),
      name: editingProduct.name.trim(),
      category_id: editingProduct.category_id,
      price_cents: priceCents,
      is_favorite: Boolean(editingProduct.is_favorite),
      sort_order: editingProduct.sort_order || 0,
      is_active: editingProduct.is_active ?? true,
      button_color: editingProduct.button_color ?? 'default',
      created_at: editingProduct.created_at || now,
      updated_at: now,
    };

    await db.products.put(productData);
    await syncEngine.queueMutation('products', 'upsert', { ...productData }, productData.id);
    setEditingProduct(null);
  };

  const handleOpenNewTable = () => {
    setEditingTable({
      id: generateUUID(),
      name: '',
      sort_order: tables.length + 1,
      is_active: true,
      button_color: 'default',
    });
  };

  const handleSaveTable = async () => {
    if (!editingTable || !editingTable.name?.trim()) return;

    const tableData: Table = {
      id: editingTable.id || generateUUID(),
      name: editingTable.name.trim(),
      sort_order: editingTable.sort_order ?? tables.length + 1,
      is_active: editingTable.is_active ?? true,
      button_color: editingTable.button_color ?? 'default',
      created_at: editingTable.created_at || new Date().toISOString(),
    };

    await db.pos_tables.put(tableData);
    await syncEngine.queueMutation('tables', 'upsert', { ...tableData }, tableData.id);
    setEditingTable(null);
  };

  const handleToggleActive = async (p: Product) => {
    const updatedStatus = !p.is_active;
    const now = new Date().toISOString();
    await db.products.update(p.id, { is_active: updatedStatus, updated_at: now });
    const updated = (await db.products.get(p.id))!;
    await syncEngine.queueMutation('products', 'update', { ...updated }, p.id);
  };

  const handleToggleFavorite = async (p: Product) => {
    const updatedFav = !p.is_favorite;
    const now = new Date().toISOString();
    await db.products.update(p.id, { is_favorite: updatedFav, updated_at: now });
    const updated = (await db.products.get(p.id))!;
    await syncEngine.queueMutation('products', 'update', { ...updated }, p.id);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-parchment-100 p-4 sm:p-6 space-y-6 pb-16 select-none">
      {/* Hlavička */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm shrink-0">
        <div>
          <h2 className="text-xl font-bold text-ink-900 tracking-tight">Správa nabídky a číselníků</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Úprava produktů, cen, kategorií a oblíbených položek
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenNewProduct}
          className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-tea-600 text-white font-bold text-sm shadow hover:bg-tea-700 active:scale-95 transition-all shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Přidat nový produkt</span>
        </button>
      </div>

      {/* Tabulka produktů */}
      <div className="bg-white rounded-2xl border border-parchment-300 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-parchment-200 bg-parchment-50 flex items-center justify-between">
          <h3 className="font-bold text-sm text-ink-800">
            Seznam produktů ({products.length})
          </h3>
          <span className="text-xs text-ink-500 hidden sm:inline">
            Změna ceny neovlivňuje dřívější vytvořené a zaplacené účty.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm min-w-[600px]">
            <thead>
              <tr className="bg-parchment-100/60 border-b border-parchment-200 text-xs font-semibold text-ink-500 uppercase">
                <th className="py-3 px-4 w-12 text-center">Oblíbené</th>
                <th className="py-3 px-4">Název</th>
                <th className="py-3 px-4">Kategorie</th>
                <th className="py-3 px-4">Prodejní cena</th>
                <th className="py-3 px-4">Stav</th>
                <th className="py-3 px-4 text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-parchment-200">
              {products.map((p: Product) => {
                const category = categories.find((c: Category) => c.id === p.category_id);
                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-parchment-50 transition-colors ${
                      !p.is_active ? 'opacity-50 bg-parchment-100/40' : ''
                    }`}
                  >
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleFavorite(p)}
                        className="p-1 rounded hover:bg-parchment-200 transition-colors"
                        title={p.is_favorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}
                      >
                        <Star
                          className={`w-4 h-4 ${
                            p.is_favorite
                              ? 'text-amberGold-500 fill-amberGold-500'
                              : 'text-parchment-400'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-3 px-4 font-semibold text-ink-900">{p.name}</td>
                    <td className="py-3 px-4 text-xs text-ink-600">
                      {category?.name || 'Bez kategorie'}
                    </td>
                    <td className="py-3 px-4 font-bold text-tea-700">
                      {formatCents(p.price_cents)}
                    </td>
                    <td className="py-3 px-4">
                      {p.is_active ? (
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-tea-100 text-tea-800 font-semibold">
                          Aktivní
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-parchment-300 text-ink-500 font-semibold">
                          Deaktivovaný
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(p)}
                        className="p-1.5 rounded-lg border border-parchment-300 text-ink-600 hover:bg-parchment-200 transition-colors"
                        title={p.is_active ? 'Deaktivovat' : 'Aktivovat'}
                      >
                        {p.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEditProduct(p)}
                        className="p-1.5 rounded-lg border border-parchment-300 text-ink-600 hover:bg-parchment-200 transition-colors"
                        title="Upravit produkt"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-parchment-300 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-parchment-200 bg-parchment-50 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-sm text-ink-800">Stoly ({tables.length})</h3>
            <p className="text-xs text-ink-500 mt-0.5">Nastavte názvy a barvy tlačítek stolů na pokladní obrazovce.</p>
          </div>
          <button
            type="button"
            onClick={handleOpenNewTable}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-tea-600 text-white text-xs font-bold hover:bg-tea-700"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Přidat stůl</span>
          </button>
        </div>
        <div className="divide-y divide-parchment-200">
          {tables.map((table) => (
            <div key={table.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`w-6 h-6 rounded-md border shrink-0 ${BUTTON_COLORS.find((color) => color.value === (table.button_color ?? 'default'))?.swatchClass ?? BUTTON_COLORS[0].swatchClass}`}
                  aria-label={`Barva: ${BUTTON_COLORS.find((color) => color.value === (table.button_color ?? 'default'))?.label ?? BUTTON_COLORS[0].label}`}
                />
                <span className="text-sm font-semibold text-ink-900 truncate">{table.name}</span>
                {!table.is_active && <span className="text-xs text-ink-400">(neaktivní)</span>}
              </div>
              <button
                type="button"
                onClick={() => setEditingTable({ ...table })}
                className="p-2 rounded-lg border border-parchment-300 text-ink-600 hover:bg-parchment-100"
                title="Upravit stůl"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Správa lokální databáze & Vývoj / Testování */}
      <div className="bg-white rounded-2xl border border-parchment-300 shadow-sm p-5 space-y-4">
        <div className="flex items-center space-x-3 border-b border-parchment-200 pb-3">
          <div className="p-2 bg-amberGold-100 text-amberGold-700 rounded-xl">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-ink-900">Správa lokální databáze & Testování</h3>
            <p className="text-xs text-ink-500">
              Nástroje pro čištění testovacích dat a řešení konfliktů při změnách schématu
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
          {/* Záloha a obnova celé lokální databáze */}
          <div className="bg-blue-50/60 rounded-xl p-4 border border-blue-200 flex flex-col justify-between">
            <div className="space-y-1 mb-4">
              <h4 className="text-xs font-bold text-blue-900 uppercase">Záloha / obnova lokálních dat</h4>
              <p className="text-xs text-blue-800/80 leading-relaxed">
                Záloha obsahuje celý lokální katalog, transakce, audit i frontu synchronizace. Obnova nahradí místní data; čekající změny se mohou synchronizovat později.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-blue-200 text-ink-800 hover:bg-blue-100 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-blue-700" />
                <span>Stáhnout zálohu</span>
              </button>
              <button
                type="button"
                onClick={() => backupFileInput.current?.click()}
                disabled={syncEngine.isProcessing}
                className="flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-blue-200 text-ink-800 hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5 text-blue-700" />
                <span>Obnovit ze souboru</span>
              </button>
              <input
                ref={backupFileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void handleImportBackup(event.target.files?.[0])}
              />
            </div>
          </div>

          {/* 1. Smazat pouze transakce */}
          <div className="bg-parchment-50 rounded-xl p-4 border border-parchment-200 flex flex-col justify-between">
            <div className="space-y-1 mb-4">
              <h4 className="text-xs font-bold text-ink-900 uppercase">Smazat pouze transakce</h4>
              <p className="text-xs text-ink-600 leading-relaxed">
                Vymaže otevřené i zaplacené účty, položky na stolech, platby a frontu synchronizace. Katalog produktů a stolů zůstane zachován.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('Opravdu chcete vymazat všechny účty, položky a platby? Nabídka produktů a stoly zůstanou nedotčeny.')) {
                  await clearTransactionsOnly();
                  await syncEngine.updatePendingCount();
                  alert('Testovací transakce a fronta byly úspěšně vymazány.');
                }
              }}
              className="flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-parchment-300 text-ink-800 hover:bg-parchment-200 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-amberGold-600" />
              <span>Vymazat testovací transakce</span>
            </button>
          </div>

          {/* 2. Vyčistit frontu syncu */}
          <div className="bg-parchment-50 rounded-xl p-4 border border-parchment-200 flex flex-col justify-between">
            <div className="space-y-1 mb-4">
              <h4 className="text-xs font-bold text-ink-900 uppercase">Vyčistit pouze frontu syncu</h4>
              <p className="text-xs text-ink-600 leading-relaxed">
                Zahodí položky čekající na odeslání do Supabase. Užitečné, když se změnilo schéma databáze na serveru a staré testovací změny selhávají.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('Opravdu chcete vyprázdnit frontu synchronizace?')) {
                  await syncEngine.clearOutbox();
                  alert('Fronta synchronizace byla vyprázdněna.');
                }
              }}
              className="flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-parchment-300 text-ink-800 hover:bg-parchment-200 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
              <span>Vyprázdnit Outbox</span>
            </button>
          </div>

          {/* 3. Kompletní reset databáze */}
          <div className="bg-rose-50/50 rounded-xl p-4 border border-rose-200 flex flex-col justify-between">
            <div className="space-y-1 mb-4">
              <h4 className="text-xs font-bold text-rose-900 uppercase flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                <span>Kompletní reset databáze</span>
              </h4>
              <p className="text-xs text-rose-700/80 leading-relaxed">
                Vymaže úplně celou lokální IndexedDB a obnoví výchozí demo nabídku čajovny (všechny produkty i stoly).
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('POZOR: Tato akce smaže celou lokální databázi včetně případných nových produktů a obnoví výchozí stav. Pokračovat?')) {
                  await resetEntireDatabase();
                  await syncEngine.updatePendingCount();
                  alert('Databáze byla kompletně obnovena do výchozího stavu.');
                }
              }}
              className="flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Kompletní reset databáze</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dialog úpravy / vytvoření produktu */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-parchment-300 p-6 max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-parchment-200 pb-3">
              <h3 className="font-bold text-base text-ink-900">
                {editingProduct.id && products.some((p: Product) => p.id === editingProduct.id)
                  ? 'Upravit produkt'
                  : 'Nový produkt'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-1 text-ink-400 hover:text-ink-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="productNameInput" className="block text-xs font-bold text-ink-700 uppercase mb-1">
                  Název produktu
                </label>
                <input
                  id="productNameInput"
                  type="text"
                  value={editingProduct.name || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  placeholder="např. Sencha Fukamushi"
                  className="w-full p-2.5 border border-parchment-300 rounded-xl text-sm font-semibold focus:border-tea-600 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="categorySelect" className="block text-xs font-bold text-ink-700 uppercase mb-1">
                  Kategorie
                </label>
                <select
                  id="categorySelect"
                  value={editingProduct.category_id || ''}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, category_id: e.target.value })
                  }
                  className="w-full p-2.5 border border-parchment-300 rounded-xl text-sm font-semibold focus:border-tea-600 focus:outline-none bg-white"
                >
                  {categories.map((c: Category) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="productPriceInput" className="block text-xs font-bold text-ink-700 uppercase mb-1">
                  Prodejní cena v Kč (uloží se v haléřích)
                </label>
                <input
                  id="productPriceInput"
                  type="number"
                  step="1"
                  min="0"
                  value={productPriceCzk}
                  onChange={(e) => setProductPriceCzk(e.target.value)}
                  className="w-full p-2.5 border border-parchment-300 rounded-xl text-base font-bold text-right focus:border-tea-600 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="productColor" className="block text-xs font-bold text-ink-700 uppercase mb-1">
                  Barva tlačítka
                </label>
                <select
                  id="productColor"
                  value={editingProduct.button_color ?? 'default'}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, button_color: e.target.value as ButtonColor })
                  }
                  className="w-full p-2.5 border border-parchment-300 rounded-xl text-sm font-semibold focus:border-tea-600 focus:outline-none bg-white"
                >
                  {BUTTON_COLORS.map((color) => (
                    <option key={color.value} value={color.value}>{color.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="isFavorite"
                  checked={Boolean(editingProduct.is_favorite)}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, is_favorite: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-tea-600 focus:ring-tea-500"
                />
                <label htmlFor="isFavorite" className="text-sm font-semibold text-ink-800">
                  Zobrazit na hlavní obrazovce jako oblíbenou položku
                </label>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-parchment-200">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 text-sm rounded-xl border border-parchment-300 text-ink-600 hover:bg-parchment-100"
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={handleSaveProduct}
                className="flex items-center space-x-1.5 px-5 py-2 text-sm rounded-xl bg-tea-600 text-white font-bold hover:bg-tea-700 shadow"
              >
                <Check className="w-4 h-4" />
                <span>Uložit produkt</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTable && (
        <div className="fixed inset-0 z-50 bg-ink-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-parchment-300 p-6 max-w-md w-full space-y-4">
            <div className="flex justify-between items-center border-b border-parchment-200 pb-3">
              <h3 className="font-bold text-base text-ink-900">
                {tables.some((table) => table.id === editingTable.id) ? 'Upravit stůl' : 'Nový stůl'}
              </h3>
              <button type="button" onClick={() => setEditingTable(null)} className="p-1 text-ink-400 hover:text-ink-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="tableName" className="block text-xs font-bold text-ink-700 uppercase mb-1">Název stolu</label>
                <input
                  id="tableName"
                  type="text"
                  value={editingTable.name ?? ''}
                  onChange={(e) => setEditingTable({ ...editingTable, name: e.target.value })}
                  className="w-full p-2.5 border border-parchment-300 rounded-xl text-sm font-semibold focus:border-tea-600 focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="tableColor" className="block text-xs font-bold text-ink-700 uppercase mb-1">Barva tlačítka</label>
                <select
                  id="tableColor"
                  value={editingTable.button_color ?? 'default'}
                  onChange={(e) => setEditingTable({ ...editingTable, button_color: e.target.value as ButtonColor })}
                  className="w-full p-2.5 border border-parchment-300 rounded-xl text-sm font-semibold focus:border-tea-600 focus:outline-none bg-white"
                >
                  {BUTTON_COLORS.map((color) => (
                    <option key={color.value} value={color.value}>{color.label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                <input
                  type="checkbox"
                  checked={editingTable.is_active ?? true}
                  onChange={(e) => setEditingTable({ ...editingTable, is_active: e.target.checked })}
                  className="w-4 h-4 rounded text-tea-600 focus:ring-tea-500"
                />
                Zobrazit na pokladní obrazovce
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-parchment-200">
              <button type="button" onClick={() => setEditingTable(null)} className="px-4 py-2 text-sm rounded-xl border border-parchment-300 text-ink-600 hover:bg-parchment-100">
                Zrušit
              </button>
              <button type="button" onClick={handleSaveTable} disabled={!editingTable.name?.trim()} className="flex items-center gap-1.5 px-5 py-2 text-sm rounded-xl bg-tea-600 text-white font-bold hover:bg-tea-700 shadow disabled:opacity-50">
                <Check className="w-4 h-4" />
                <span>Uložit stůl</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
