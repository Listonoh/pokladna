import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/posDatabase';
import { syncEngine } from '../../api/syncEngine';
import { generateUUID } from '../../domain/posService';
import { Product, Category } from '../../domain/types';
import { formatCents, czkToCents, centsToCzk } from '../../domain/calculations';
import { Plus, Edit2, Star, Check, X, Eye, EyeOff } from 'lucide-react';

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
    <div className="flex-1 flex flex-col h-[calc(100vh-61px)] overflow-y-auto bg-parchment-100 p-6 select-none space-y-6">
      {/* Hlavička */}
      <div className="flex items-center justify-between bg-white p-5 rounded-2xl border border-parchment-300 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-ink-900 tracking-tight">Správa nabídky a číselníků</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Úprava produktů, cen, kategorií a oblíbených položek
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenNewProduct}
          className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-tea-600 text-white font-bold text-sm shadow hover:bg-tea-700 active:scale-95 transition-all"
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
          <span className="text-xs text-ink-500">
            Změna ceny neovlivňuje dřívější vytvořené a zaplacené účty.
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-parchment-100/60 border-b border-parchment-200 text-xs font-semibold text-ink-500 uppercase">
                <th className="py-3 px-4">Oblíbené</th>
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
                    <td className="py-3 px-4">
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
                <label className="block text-xs font-bold text-ink-700 uppercase mb-1">
                  Název produktu
                </label>
                <input
                  type="text"
                  value={editingProduct.name || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  placeholder="např. Sencha Fukamushi"
                  className="w-full p-2.5 border border-parchment-300 rounded-xl text-sm font-semibold focus:border-tea-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink-700 uppercase mb-1">
                  Kategorie
                </label>
                <select
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
                <label className="block text-xs font-bold text-ink-700 uppercase mb-1">
                  Prodejní cena v Kč (uloží se v haléřích)
                </label>
                <input
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
