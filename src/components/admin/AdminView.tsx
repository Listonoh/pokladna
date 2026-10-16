import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, clearTransactionsOnly, resetEntireDatabase } from '../../db/posDatabase';
import { syncEngine } from '../../api/syncEngine';
import { generateUUID } from '../../domain/posService';
import { Product, Category } from '../../domain/types';
import { formatCents, czkToCents, centsToCzk } from '../../domain/calculations';
import { Plus, Edit2, Star, Check, X, Eye, EyeOff, Trash2, Database, RotateCcw, AlertTriangle } from 'lucide-react';

export const AdminView: React.FC = () => {
  const categories: Category[] = useLiveQuery(() => db.categories.orderBy('sort_order').toArray()) ?? [];
  const products: Product[] = useLiveQuery(() => db.products.orderBy('sort_order').toArray()) ?? [];

  // Editace / Vytvoření produktu modal
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [productPriceCzk, setProductPriceCzk] = useState<string>('');

  const handleOpenNewProduct = () => {
    setEditingProduct({
      id: generateUUID(),
      name: '',
      category_id: categories[0]?.id || '',
      price_cents: 9500,
      is_favorite: false,
      sort_order: products.length + 1,
      is_active: true,
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
      created_at: editingProduct.created_at || now,
      updated_at: now,
    };

    await db.products.put(productData);
    await syncEngine.queueMutation('products', 'upsert', { ...productData }, productData.id);
    setEditingProduct(null);
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
    </div>
  );
};
