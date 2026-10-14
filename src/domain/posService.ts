import { db } from '../db/posDatabase';
import { syncEngine } from '../api/syncEngine';
import {
  Order,
  OrderItem,
  OrderItemEvent,
  Payment,
  PaymentEvent,
  Product,
  PaymentMethod,
} from './types';
import { calculateOrder, validatePaymentAmount } from './calculations';

/**
 * Generuje unikátní UUID v4 (kompatibilní v prohlížeči i Node).
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generuje čitelné číslo objednávky pro daný den.
 */
export function generateOrderNumber(existingCountToday: number): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(existingCountToday + 1).padStart(3, '0');
  return `${today}-${seq}`;
}

export class PosService {
  /**
   * Získá existující otevřenou objednávku pro stůl, nebo vytvoří novou.
   * Pro stůl null (S sebou) vytvoří vždy novou objednávku.
   */
  async getOrCreateOrderForTable(tableId: string | null): Promise<Order> {
    if (tableId) {
      const existing = await db.orders
        .where({ table_id: tableId, status: 'open' })
        .first();
      if (existing) {
        return existing;
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayOrdersCount = await db.orders
      .filter((o) => o.created_at.startsWith(todayStr))
      .count();

    const newOrder: Order = {
      id: generateUUID(),
      table_id: tableId,
      order_number: generateOrderNumber(todayOrdersCount),
      status: 'open',
      created_at: new Date().toISOString(),
      closed_at: null,
    };

    await db.orders.add(newOrder);
    await syncEngine.queueMutation('orders', 'insert', { ...newOrder }, newOrder.id);
    return newOrder;
  }

  /**
   * Přidá produkt do objednávky s vytvořením cenového a názvového snapshotu.
   */
  async addItemToOrder(
    orderId: string,
    product: Product,
    quantity = 1,
    note?: string
  ): Promise<OrderItem> {
    const normalizedNote = note?.trim() || undefined;

    // Pokud už existuje stejný produkt se stejnou poznámkou a čeká na doručení, zvýšíme množství
    const existing = await db.order_items
      .where({ order_id: orderId, product_id: product.id })
      .filter((i) => i.delivery_status === 'pending' && (i.note || undefined) === normalizedNote)
      .first();

    const now = new Date().toISOString();

    if (existing) {
      const updatedQuantity = existing.quantity + quantity;
      await db.order_items.update(existing.id, {
        quantity: updatedQuantity,
        updated_at: now,
      });

      // Audit událost
      const event: OrderItemEvent = {
        id: generateUUID(),
        order_item_id: existing.id,
        event_type: 'quantity_changed',
        payload: { previousQuantity: existing.quantity, newQuantity: updatedQuantity },
        created_at: now,
      };
      await db.order_item_events.add(event);

      const updatedItem = (await db.order_items.get(existing.id))!;
      await syncEngine.queueMutation('order_items', 'update', { ...updatedItem }, updatedItem.id);
      return updatedItem;
    }

    // Vytvoření nové položky se snapshotem ceny a názvu
    const newItem: OrderItem = {
      id: generateUUID(),
      order_id: orderId,
      product_id: product.id,
      product_name_snapshot: product.name,
      unit_price_cents_snapshot: product.price_cents,
      quantity,
      note: normalizedNote,
      delivery_status: 'pending',
      delivered_at: null,
      created_at: now,
      updated_at: now,
    };

    await db.order_items.add(newItem);

    const event: OrderItemEvent = {
      id: generateUUID(),
      order_item_id: newItem.id,
      event_type: 'created',
      payload: { quantity, priceCents: product.price_cents },
      created_at: now,
    };
    await db.order_item_events.add(event);

    await syncEngine.queueMutation('order_items', 'insert', { ...newItem }, newItem.id);
    return newItem;
  }

  /**
   * Změna množství na existující položce.
   */
  async updateItemQuantity(orderItemId: string, newQuantity: number): Promise<void> {
    const item = await db.order_items.get(orderItemId);
    if (!item) return;

    if (newQuantity <= 0) {
      await this.removeItem(orderItemId);
      return;
    }

    const now = new Date().toISOString();
    await db.order_items.update(orderItemId, {
      quantity: newQuantity,
      updated_at: now,
    });

    const event: OrderItemEvent = {
      id: generateUUID(),
      order_item_id: orderItemId,
      event_type: 'quantity_changed',
      payload: { previousQuantity: item.quantity, newQuantity },
      created_at: now,
    };
    await db.order_item_events.add(event);

    const updated = (await db.order_items.get(orderItemId))!;
    await syncEngine.queueMutation('order_items', 'update', { ...updated }, orderItemId);
  }

  /**
   * Aktualizace poznámky položky.
   */
  async updateItemNote(orderItemId: string, note: string): Promise<void> {
    const now = new Date().toISOString();
    await db.order_items.update(orderItemId, {
      note: note.trim() || undefined,
      updated_at: now,
    });
    const updated = (await db.order_items.get(orderItemId))!;
    await syncEngine.queueMutation('order_items', 'update', { ...updated }, orderItemId);
  }

  /**
   * Odstranění položky z účtu.
   */
  async removeItem(orderItemId: string): Promise<void> {
    const item = await db.order_items.get(orderItemId);
    if (!item) return;

    const now = new Date().toISOString();
    const event: OrderItemEvent = {
      id: generateUUID(),
      order_item_id: orderItemId,
      event_type: 'cancelled',
      payload: { deletedItem: item },
      created_at: now,
    };
    await db.order_item_events.add(event);

    await db.order_items.delete(orderItemId);
    await syncEngine.queueMutation('order_items', 'delete', { id: orderItemId }, orderItemId);
  }

  /**
   * Označení položky jako doručené.
   */
  async markItemDelivered(orderItemId: string): Promise<void> {
    const item = await db.order_items.get(orderItemId);
    if (!item) return;

    const now = new Date().toISOString();
    await db.order_items.update(orderItemId, {
      delivery_status: 'delivered',
      delivered_at: now,
      updated_at: now,
    });

    const event: OrderItemEvent = {
      id: generateUUID(),
      order_item_id: orderItemId,
      event_type: 'delivered',
      created_at: now,
    };
    await db.order_item_events.add(event);

    const updated = (await db.order_items.get(orderItemId))!;
    await syncEngine.queueMutation('order_items', 'update', { ...updated }, orderItemId);
  }

  /**
   * Hromadné doručení všech čekajících položek pro daný stůl.
   */
  async markAllItemsDeliveredForOrder(orderId: string): Promise<void> {
    const pendingItems = await db.order_items
      .where({ order_id: orderId, delivery_status: 'pending' })
      .toArray();

    for (const item of pendingItems) {
      await this.markItemDelivered(item.id);
    }
  }

  /**
   * Vrácení doručené položky zpět do čekajících (Undo).
   */
  async revertItemDelivery(orderItemId: string): Promise<void> {
    const item = await db.order_items.get(orderItemId);
    if (!item) return;

    const now = new Date().toISOString();
    await db.order_items.update(orderItemId, {
      delivery_status: 'pending',
      delivered_at: null,
      updated_at: now,
    });

    const event: OrderItemEvent = {
      id: generateUUID(),
      order_item_id: orderItemId,
      event_type: 'reverted_to_pending',
      created_at: now,
    };
    await db.order_item_events.add(event);

    const updated = (await db.order_items.get(orderItemId))!;
    await syncEngine.queueMutation('order_items', 'update', { ...updated }, orderItemId);
  }

  /**
   * Zaevidování platby s kontrolou idempotence a ochranou proti přeplatku.
   */
  async recordPayment(
    orderId: string,
    amountCents: number,
    paymentMethod: PaymentMethod,
    customIdempotencyId?: string
  ): Promise<Payment> {
    const paymentId = customIdempotencyId || generateUUID();

    // 1. Idempotence: pokud platba již existuje, vrátíme ji
    const existingPayment = await db.payments.get(paymentId);
    if (existingPayment) {
      return existingPayment;
    }

    // 2. Načtení položek a plateb pro ověření přeplatku
    const order = await db.orders.get(orderId);
    if (!order) {
      throw new Error('Objednávka nebyla nalezena.');
    }
    if (order.status === 'cancelled') {
      throw new Error('Nelze platit stornovanou objednávku.');
    }

    const items = await db.order_items.where({ order_id: orderId }).toArray();
    const payments = await db.payments.where({ order_id: orderId }).toArray();

    const calc = calculateOrder(items, payments);
    const validation = validatePaymentAmount(calc.remainingCents, amountCents);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const newPayment: Payment = {
      id: paymentId,
      order_id: orderId,
      amount_cents: amountCents,
      payment_method: paymentMethod,
      status: 'completed',
      cancel_reason: null,
      created_at: now,
      cancelled_at: null,
    };

    await db.payments.add(newPayment);

    // Audit událost
    const event: PaymentEvent = {
      id: generateUUID(),
      payment_id: paymentId,
      event_type: 'created',
      metadata: { amountCents, method: paymentMethod },
      created_at: now,
    };
    await db.payment_events.add(event);

    // Aktualizace objednávky, pokud je plně zaplacena
    const newPaidCents = calc.paidCents + amountCents;
    if (newPaidCents >= calc.totalCents && calc.totalCents > 0) {
      await db.orders.update(orderId, {
        status: 'paid',
        closed_at: now,
      });
      const updatedOrder = (await db.orders.get(orderId))!;
      await syncEngine.queueMutation('orders', 'update', { ...updatedOrder }, orderId);
    }

    await syncEngine.queueMutation('payments', 'insert', { ...newPayment }, paymentId);
    return newPayment;
  }

  /**
   * Bezpečné storno platby.
   */
  async cancelPayment(paymentId: string, reason: string): Promise<void> {
    const payment = await db.payments.get(paymentId);
    if (!payment) {
      throw new Error('Platba nebyla nalezena.');
    }
    if (payment.status === 'cancelled') {
      return;
    }

    const now = new Date().toISOString();
    await db.payments.update(paymentId, {
      status: 'cancelled',
      cancel_reason: reason,
      cancelled_at: now,
    });

    const event: PaymentEvent = {
      id: generateUUID(),
      payment_id: paymentId,
      event_type: 'cancelled',
      metadata: { reason },
      created_at: now,
    };
    await db.payment_events.add(event);

    // Pokud byla objednávka uzavřena ('paid'), znovu ji otevřeme
    const order = await db.orders.get(payment.order_id);
    if (order && order.status === 'paid') {
      await db.orders.update(payment.order_id, {
        status: 'open',
        closed_at: null,
      });
      const updatedOrder = (await db.orders.get(payment.order_id))!;
      await syncEngine.queueMutation('orders', 'update', { ...updatedOrder }, payment.order_id);
    }

    const updatedPayment = (await db.payments.get(paymentId))!;
    await syncEngine.queueMutation('payments', 'update', { ...updatedPayment }, paymentId);
  }
}

export const posService = new PosService();
