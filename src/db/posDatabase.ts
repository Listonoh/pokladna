import Dexie, { Table as DexieTable } from 'dexie';
import {
  Category,
  Product,
  Table,
  Order,
  OrderItem,
  OrderItemEvent,
  Payment,
  PaymentEvent,
  SyncOutboxItem,
} from '../domain/types';

export class PosDatabase extends Dexie {
  categories!: DexieTable<Category, string>;
  products!: DexieTable<Product, string>;
  pos_tables!: DexieTable<Table, string>;
  orders!: DexieTable<Order, string>;
  order_items!: DexieTable<OrderItem, string>;
  order_item_events!: DexieTable<OrderItemEvent, string>;
  payments!: DexieTable<Payment, string>;
  payment_events!: DexieTable<PaymentEvent, string>;
  sync_outbox!: DexieTable<SyncOutboxItem, string>;

  constructor(dbName = 'MiskaSPokladnaDB') {
    super(dbName);

    this.version(1).stores({
      categories: 'id, sort_order, is_active',
      products: 'id, category_id, is_favorite, sort_order, is_active',
      pos_tables: 'id, sort_order, is_active',
      orders: 'id, table_id, status, [table_id+status], created_at',
      order_items: 'id, order_id, product_id, [order_id+product_id], delivery_status, [order_id+delivery_status], created_at',
      order_item_events: 'id, order_item_id, event_type, created_at',
      payments: 'id, order_id, payment_method, status, created_at',
      payment_events: 'id, payment_id, created_at',
      sync_outbox: 'id, entity, action, status, created_at',
    });
  }
}

export const db = new PosDatabase();

/**
 * Inicializace výchozích dat čajovny, pokud je lokální databáze prázdná.
 */
export async function seedInitialDataIfEmpty(database: PosDatabase = db) {
  const categoriesCount = await database.categories.count();
  if (categoriesCount > 0) {
    return; // Data již existují
  }

  const now = new Date().toISOString();

  // 1. Výchozí kategorie
  const catTeas: Category = {
    id: 'cat-teas',
    name: 'Čaje',
    sort_order: 1,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  const catDrinks: Category = {
    id: 'cat-drinks',
    name: 'Ostatní nápoje',
    sort_order: 2,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  const catFood: Category = {
    id: 'cat-food',
    name: 'Drobné jídlo',
    sort_order: 3,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  const catPackaged: Category = {
    id: 'cat-packaged',
    name: 'Balené čaje',
    sort_order: 4,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  const catOther: Category = {
    id: 'cat-other',
    name: 'Ostatní',
    sort_order: 5,
    is_active: true,
    created_at: now,
    updated_at: now,
  };

  await database.categories.bulkAdd([catTeas, catDrinks, catFood, catPackaged, catOther]);

  // 2. Výchozí stoly
  const initialTables: Table[] = [
    { id: 'tbl-1', name: 'Stůl 1 (Okna)', sort_order: 1, is_active: true, created_at: now },
    { id: 'tbl-2', name: 'Stůl 2 (Knihovna)', sort_order: 2, is_active: true, created_at: now },
    { id: 'tbl-3', name: 'Stůl 3 (Bambus)', sort_order: 3, is_active: true, created_at: now },
    { id: 'tbl-4', name: 'Stůl 4 (Střed)', sort_order: 4, is_active: true, created_at: now },
    { id: 'tbl-tatami', name: 'Čajové pódium (Tatami)', sort_order: 5, is_active: true, created_at: now },
  ];
  await database.pos_tables.bulkAdd(initialTables);

  // 3. Výchozí produkty s cenou v haléřích
  const initialProducts: Product[] = [
    {
      id: 'prod-gyokuro',
      category_id: 'cat-teas',
      name: 'Gyokuro Asahina',
      price_cents: 14500, // 145 Kč
      is_favorite: true,
      sort_order: 1,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'prod-sencha',
      category_id: 'cat-teas',
      name: 'Sencha Fukamushi',
      price_cents: 9500, // 95 Kč
      is_favorite: true,
      sort_order: 2,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'prod-longjing',
      category_id: 'cat-teas',
      name: 'Long Jing Dračí studna',
      price_cents: 12000, // 120 Kč
      is_favorite: true,
      sort_order: 3,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'prod-da-hong-pao',
      category_id: 'cat-teas',
      name: 'Da Hong Pao Oolong',
      price_cents: 13500, // 135 Kč
      is_favorite: true,
      sort_order: 4,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'prod-matcha-latte',
      category_id: 'cat-drinks',
      name: 'Matcha Latte z ovesného mléka',
      price_cents: 9800, // 98 Kč
      is_favorite: true,
      sort_order: 1,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'prod-mochi',
      category_id: 'cat-food',
      name: 'Mochi koláček se sezamem',
      price_cents: 5500, // 55 Kč
      is_favorite: true,
      sort_order: 1,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'prod-cookies',
      category_id: 'cat-food',
      name: 'Domácí čajové sušenky',
      price_cents: 4500, // 45 Kč
      is_favorite: false,
      sort_order: 2,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'prod-lemonade',
      category_id: 'cat-drinks',
      name: 'Jasmínová limonáda',
      price_cents: 7500, // 75 Kč
      is_favorite: false,
      sort_order: 2,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
  ];
  await database.products.bulkAdd(initialProducts);
}
