import { db, PosDatabase } from './posDatabase';
import {
  Category,
  Order,
  OrderItem,
  OrderItemEvent,
  Payment,
  PaymentEvent,
  Product,
  SyncOutboxItem,
  Table,
} from '../domain/types';

const BACKUP_FORMAT = 'pokladna-local-backup';
const BACKUP_VERSION = 1;

export interface LocalBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exported_at: string;
  data: {
    categories: Category[];
    products: Product[];
    tables: Table[];
    orders: Order[];
    order_items: OrderItem[];
    order_item_events: OrderItemEvent[];
    payments: Payment[];
    payment_events: PaymentEvent[];
    sync_outbox: SyncOutboxItem[];
  };
}

export async function createLocalBackup(database: PosDatabase = db): Promise<LocalBackup> {
  const [categories, products, tables, orders, order_items, order_item_events, payments, payment_events, sync_outbox] =
    await database.transaction(
      'r',
      [
        database.categories,
        database.products,
        database.pos_tables,
        database.orders,
        database.order_items,
        database.order_item_events,
        database.payments,
        database.payment_events,
        database.sync_outbox,
      ],
      () =>
        Promise.all([
          database.categories.toArray(),
          database.products.toArray(),
          database.pos_tables.toArray(),
          database.orders.toArray(),
          database.order_items.toArray(),
          database.order_item_events.toArray(),
          database.payments.toArray(),
          database.payment_events.toArray(),
          database.sync_outbox.toArray(),
        ])
    );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    data: {
      categories,
      products,
      tables,
      orders,
      order_items,
      order_item_events,
      payments,
      payment_events,
      sync_outbox,
    },
  };
}

export function parseLocalBackup(contents: string): LocalBackup {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error('Soubor neobsahuje platný JSON.');
  }

  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !isRecord(value.data)) {
    throw new Error('Soubor není podporovaná záloha pokladny.');
  }

  const tableNames = [
    'categories',
    'products',
    'tables',
    'orders',
    'order_items',
    'order_item_events',
    'payments',
    'payment_events',
    'sync_outbox',
  ] as const;

  const requiredStrings: Record<(typeof tableNames)[number], string[]> = {
    categories: ['id', 'name', 'created_at', 'updated_at'],
    products: ['id', 'category_id', 'name', 'created_at', 'updated_at'],
    tables: ['id', 'name', 'created_at'],
    orders: ['id', 'order_number', 'status', 'created_at'],
    order_items: [
      'id',
      'order_id',
      'product_id',
      'product_name_snapshot',
      'delivery_status',
      'created_at',
      'updated_at',
    ],
    order_item_events: ['id', 'order_item_id', 'event_type', 'created_at'],
    payments: ['id', 'order_id', 'payment_method', 'status', 'created_at'],
    payment_events: ['id', 'payment_id', 'event_type', 'created_at'],
    sync_outbox: ['id', 'entity', 'action', 'status', 'created_at', 'updated_at'],
  };
  const requiredNumbers: Partial<Record<(typeof tableNames)[number], string[]>> = {
    categories: ['sort_order'],
    products: ['price_cents', 'sort_order'],
    tables: ['sort_order'],
    order_items: ['unit_price_cents_snapshot', 'quantity', 'paid_quantity'],
    payments: ['amount_cents', 'tip_amount_cents'],
    sync_outbox: ['retry_count'],
  };
  const requiredBooleans: Partial<Record<(typeof tableNames)[number], string[]>> = {
    categories: ['is_active'],
    products: ['is_favorite', 'is_active'],
    tables: ['is_active'],
  };
  const allowedValues: Partial<Record<(typeof tableNames)[number], Record<string, string[]>>> = {
    orders: { status: ['open', 'paid', 'cancelled'] },
    order_items: { delivery_status: ['pending', 'delivered', 'cancelled'] },
    payments: {
      payment_method: ['cash', 'card'],
      status: ['completed', 'cancelled'],
    },
  };
  const allowedButtonColors = ['default', 'gray', 'red', 'green', 'yellow', 'orange', 'blue', 'brown'];

  for (const tableName of tableNames) {
    const rows = value.data[tableName];
    if (
      !Array.isArray(rows) ||
      !rows.every(
        (row) =>
          isRecord(row) &&
          requiredStrings[tableName].every((field) => typeof row[field] === 'string') &&
          (requiredNumbers[tableName] ?? []).every(
            (field) => typeof row[field] === 'number' && Number.isFinite(row[field])
          ) &&
          (requiredBooleans[tableName] ?? []).every((field) => typeof row[field] === 'boolean') &&
          (row.button_color === undefined || allowedButtonColors.includes(String(row.button_color))) &&
          Object.entries(allowedValues[tableName] ?? {}).every(([field, values]) =>
            values.includes(String(row[field]))
          )
      )
    ) {
      throw new Error(`Záloha obsahuje neplatná data v tabulce ${tableName}.`);
    }
  }

  const outboxRows = value.data.sync_outbox;
  if (
    !Array.isArray(outboxRows) ||
    !outboxRows.every(
      (row) =>
        isRecord(row) &&
        ['categories', 'products', 'tables', 'orders', 'order_items', 'payments', 'order_item_events', 'payment_events'].includes(String(row.entity)) &&
        ['insert', 'update', 'upsert', 'delete'].includes(String(row.action)) &&
        ['pending', 'syncing', 'failed', 'synced'].includes(String(row.status)) &&
        isRecord(row.payload)
    )
  ) {
    throw new Error('Záloha obsahuje neplatný stav synchronizační fronty.');
  }

  const exportedAt = value.exported_at;
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) {
    throw new Error('Záloha nemá platné datum vytvoření.');
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: exportedAt,
    data: {
      categories: value.data.categories as Category[],
      products: value.data.products as Product[],
      tables: value.data.tables as Table[],
      orders: value.data.orders as Order[],
      order_items: value.data.order_items as OrderItem[],
      order_item_events: value.data.order_item_events as OrderItemEvent[],
      payments: value.data.payments as Payment[],
      payment_events: value.data.payment_events as PaymentEvent[],
      sync_outbox: outboxRows as SyncOutboxItem[],
    },
  };
}

export async function restoreLocalBackup(backup: LocalBackup, database: PosDatabase = db): Promise<void> {
  const outbox = backup.data.sync_outbox.map((item) =>
    item.status === 'syncing' ? { ...item, status: 'pending' as const } : item
  );
  await database.transaction(
    'rw',
    [
      database.categories,
      database.products,
      database.pos_tables,
      database.orders,
      database.order_items,
      database.order_item_events,
      database.payments,
      database.payment_events,
      database.sync_outbox,
    ],
    async () => {
      await Promise.all([
        database.categories.clear(),
        database.products.clear(),
        database.pos_tables.clear(),
        database.orders.clear(),
        database.order_items.clear(),
        database.order_item_events.clear(),
        database.payments.clear(),
        database.payment_events.clear(),
        database.sync_outbox.clear(),
      ]);

      await Promise.all([
        database.categories.bulkPut(backup.data.categories),
        database.products.bulkPut(backup.data.products),
        database.pos_tables.bulkPut(backup.data.tables),
        database.orders.bulkPut(backup.data.orders),
        database.order_items.bulkPut(backup.data.order_items),
        database.order_item_events.bulkPut(backup.data.order_item_events),
        database.payments.bulkPut(backup.data.payments),
        database.payment_events.bulkPut(backup.data.payment_events),
        database.sync_outbox.bulkPut(outbox),
      ]);
    }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
