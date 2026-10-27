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
  PaymentItemDetail,
  DiscountPercent,
} from './types';
import { calculateDiscountCents, calculateOrder, validatePaymentAmount } from './calculations';

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

export interface RecordPaymentOptions {
  tipAmountCents?: number;
  customIdempotencyId?: string;
  paidItems?: PaymentItemDetail[];
  discountPercent?: DiscountPercent;
}

export class PosService {
  /**
   * Získá existující otevřenou objednávku pro stůl, nebo vytvoří novou.
   * Pro stůl null (S sebou) vrátí existující neuzavřenou objednávku s sebou,
   * pokud existuje, aby se nevytvářely duplicity, dokud není předchozí uzavřena.
   */
  async getOrCreateOrderForTable(tableId: string | null): Promise<Order> {
    if (tableId) {
      const existing = await db.orders
        .where({ table_id: tableId, status: 'open' })
        .first();
      if (existing) {
        return existing;
      }
    } else {
      const openOrders = await db.orders.where('status').equals('open').toArray();
      const existingTakeout = openOrders
        .filter((o) => !o.table_id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (existingTakeout) {
        return existingTakeout;
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
   * Vytvoří novou objednávku S sebou (table_id: null).
   */
  async createNewTakeoutOrder(): Promise<Order> {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayOrdersCount = await db.orders
      .filter((o) => o.created_at.startsWith(todayStr))
      .count();

    const newOrder: Order = {
      id: generateUUID(),
      table_id: null,
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
      await syncEngine.queueMutation('order_item_events', 'insert', { ...event }, event.id);
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
      paid_quantity: 0,
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
    await syncEngine.queueMutation('order_item_events', 'insert', { ...event }, event.id);
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
    await syncEngine.queueMutation('order_item_events', 'insert', { ...event }, event.id);
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

    await db.order_items.update(orderItemId, {
      delivery_status: 'cancelled',
      delivered_at: null,
      updated_at: now,
    });
    const updated = (await db.order_items.get(orderItemId))!;
    await syncEngine.queueMutation('order_items', 'update', { ...updated }, orderItemId);
    await syncEngine.queueMutation('order_item_events', 'insert', { ...event }, event.id);
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
    await syncEngine.queueMutation('order_item_events', 'insert', { ...event }, event.id);
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
    await syncEngine.queueMutation('order_item_events', 'insert', { ...event }, event.id);
  }

  /**
   * Zaevidování platby s podporou výběru konkrétních položek a evidence spropitného (tips).
   * V databázi striktně odděluje běžnou cenu položek (amount_cents) od spropitného (tip_amount_cents).
   */
  async recordPayment(
    orderId: string,
    amountCents: number,
    paymentMethod: PaymentMethod,
    optionsOrIdempotency?: string | RecordPaymentOptions
  ): Promise<Payment> {
    let options: RecordPaymentOptions = {};
    if (typeof optionsOrIdempotency === 'string') {
      options = { customIdempotencyId: optionsOrIdempotency };
    } else if (optionsOrIdempotency) {
      options = optionsOrIdempotency;
    }

    const tipAmountCents = options.tipAmountCents || 0;
    const discountPercent = options.discountPercent || 0;
    const grossAmountCents = options.paidItems?.reduce((sum, item) => sum + item.total_cents, 0)
      ?? amountCents;
    const discountCents = calculateDiscountCents(grossAmountCents, discountPercent);
    const paymentId = options.customIdempotencyId || generateUUID();

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
    const validation = validatePaymentAmount(
      calc.remainingCents,
      amountCents + discountCents,
      tipAmountCents
    );
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    if (amountCents !== grossAmountCents - discountCents) {
      throw new Error('Částka platby neodpovídá ceně položek po slevě.');
    }

    const now = new Date().toISOString();

    // 3. Aktualizace zaplaceného množství (paid_quantity) na položkách
    if (options.paidItems && options.paidItems.length > 0) {
      for (const pItem of options.paidItems) {
        const item = await db.order_items.get(pItem.order_item_id);
        if (item) {
          const currentPaid = item.paid_quantity || 0;
          await db.order_items.update(item.id, {
            paid_quantity: Math.min(item.quantity, currentPaid + pItem.quantity),
            updated_at: now,
          });
        }
      }
    } else {
      // Pokud nebyly předány konkrétní položky, automaticky alokujeme úhradu postupně k dosud nezaplaceným
      let remainingToAllocate = amountCents;
      for (const item of items) {
        if (remainingToAllocate <= 0) break;
        if (item.delivery_status === 'cancelled') continue;
        const currentPaid = item.paid_quantity || 0;
        const unpaidQty = item.quantity - currentPaid;
        if (unpaidQty <= 0) continue;

        const maxCanPayQty = Math.floor(remainingToAllocate / item.unit_price_cents_snapshot);
        const qtyToPay = Math.min(unpaidQty, maxCanPayQty);
        if (qtyToPay > 0) {
          await db.order_items.update(item.id, {
            paid_quantity: currentPaid + qtyToPay,
            updated_at: now,
          });
          remainingToAllocate -= qtyToPay * item.unit_price_cents_snapshot;
        }
      }
    }

    const newPayment: Payment = {
      id: paymentId,
      order_id: orderId,
      amount_cents: amountCents,
      discount_percent: discountPercent,
      discount_cents: discountCents,
      tip_amount_cents: tipAmountCents,
      payment_method: paymentMethod,
      status: 'completed',
      paid_items: options.paidItems,
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
      metadata: {
        amountCents,
        discountPercent,
        discountCents,
        tipAmountCents,
        totalPaidCents: amountCents + tipAmountCents,
        method: paymentMethod,
        paidItems: options.paidItems,
      },
      created_at: now,
    };
    await db.payment_events.add(event);

    // Aktualizace objednávky, pokud je plně zaplacena
    const newPaidCents = calc.paidCents + amountCents + discountCents;
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
   * Úprava existující platby (např. změna způsobu úhrady hotovost <-> karta, úprava spropitného).
   */
  async updatePayment(
    paymentId: string,
    updates: {
      paymentMethod?: PaymentMethod;
      tipAmountCents?: number;
    }
  ): Promise<Payment> {
    const payment = await db.payments.get(paymentId);
    if (!payment) {
      throw new Error('Platba nebyla nalezena.');
    }
    if (payment.status === 'cancelled') {
      throw new Error('Nelze upravovat stornovanou platbu.');
    }

    const newMethod = updates.paymentMethod ?? payment.payment_method;
    const newTipCents =
      updates.tipAmountCents !== undefined
        ? Math.max(0, updates.tipAmountCents)
        : payment.tip_amount_cents;

    await db.payments.update(paymentId, {
      payment_method: newMethod,
      tip_amount_cents: newTipCents,
    });

    const event: PaymentEvent = {
      id: generateUUID(),
      payment_id: paymentId,
      event_type: 'updated',
      metadata: {
        previousMethod: payment.payment_method,
        newMethod,
        previousTipCents: payment.tip_amount_cents,
        newTipCents,
      },
      created_at: new Date().toISOString(),
    };
    await db.payment_events.add(event);

    const updatedPayment = (await db.payments.get(paymentId))!;
    await syncEngine.queueMutation('payments', 'update', { ...updatedPayment }, paymentId);
    await syncEngine.queueMutation('payment_events', 'insert', { ...event }, event.id);
    return updatedPayment;
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

    // Vrácení paid_quantity na položkách, pokud byly specifikovány
    if (payment.paid_items && payment.paid_items.length > 0) {
      for (const pItem of payment.paid_items) {
        const item = await db.order_items.get(pItem.order_item_id);
        if (item) {
          const currentPaid = item.paid_quantity || 0;
          await db.order_items.update(item.id, {
            paid_quantity: Math.max(0, currentPaid - pItem.quantity),
            updated_at: now,
          });
        }
      }
    }

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

  /**
   * Zrušení / stornování celé objednávky.
   * Pokud je objednávka zcela prázdná (bez položek i plateb), je rovnou smazána,
   * aby nezanechávala prázdné duchy v databázi.
   */
  async cancelOrder(orderId: string, reason = 'Zrušeno obsluhou'): Promise<void> {
    const order = await db.orders.get(orderId);
    if (!order) return;

    const itemsCount = await db.order_items.where({ order_id: orderId }).count();
    const paymentsCount = await db.payments.where({ order_id: orderId }).count();

    if (itemsCount === 0 && paymentsCount === 0) {
      await db.orders.delete(orderId);
      await syncEngine.queueMutation('orders', 'delete', { id: orderId }, orderId);
      return;
    }

    const now = new Date().toISOString();
    await db.orders.update(orderId, {
      status: 'cancelled',
      note: order.note ? `${order.note} [Storno: ${reason}]` : `[Storno: ${reason}]`,
      closed_at: now,
    });
    const updated = (await db.orders.get(orderId))!;
    await syncEngine.queueMutation('orders', 'update', { ...updated }, orderId);
  }
}

export const posService = new PosService();
