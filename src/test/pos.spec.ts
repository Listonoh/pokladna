import { describe, it, expect, beforeEach } from 'vitest';
import { db, seedInitialDataIfEmpty } from '../db/posDatabase';
import { posService } from '../domain/posService';
import { Product } from '../domain/types';
import {
  calculateOrder,
  generateDailyReport,
  formatCents,
  getLocalDateString,
} from '../domain/calculations';
import { syncEngine } from '../api/syncEngine';

describe('Pokladní systém - 19 kritických scénářů obchodní logiky', () => {
  let sampleProduct1: Product;
  let sampleProduct2: Product;

  beforeEach(async () => {
    // Vyčistíme a zinicializujeme testovací databázi
    await db.orders.clear();
    await db.order_items.clear();
    await db.order_item_events.clear();
    await db.payments.clear();
    await db.payment_events.clear();
    await db.sync_outbox.clear();
    await db.products.clear();
    await db.categories.clear();
    await db.pos_tables.clear();

    await seedInitialDataIfEmpty();

    sampleProduct1 = (await db.products.get('prod-sencha'))!;
    sampleProduct2 = (await db.products.get('prod-mochi'))!;
  });

  // 1. Přidání produktu k novému účtu
  it('1. Přidání produktu k novému účtu vytvoří snapshot ceny a názvu', async () => {
    const table = (await db.pos_tables.toArray())[0];
    const order = await posService.getOrCreateOrderForTable(table.id);

    const item = await posService.addItemToOrder(order.id, sampleProduct1, 1);

    expect(item.order_id).toBe(order.id);
    expect(item.product_id).toBe(sampleProduct1.id);
    expect(item.product_name_snapshot).toBe(sampleProduct1.name);
    expect(item.unit_price_cents_snapshot).toBe(sampleProduct1.price_cents);
    expect(item.quantity).toBe(1);
    expect(item.delivery_status).toBe('pending');

    // Ověření auditní události
    const events = await db.order_item_events.where({ order_item_id: item.id }).toArray();
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('created');
  });

  // 2. Opakované přidání produktu
  it('2. Opakované přidání stejného produktu zvýší množství bez duplikace řádku', async () => {
    const order = await posService.getOrCreateOrderForTable(null);

    await posService.addItemToOrder(order.id, sampleProduct1, 1);
    const updatedItem = await posService.addItemToOrder(order.id, sampleProduct1, 2);

    expect(updatedItem.quantity).toBe(3);

    const allItems = await db.order_items.where({ order_id: order.id }).toArray();
    expect(allItems.length).toBe(1);

    const events = await db.order_item_events.where({ order_item_id: updatedItem.id }).toArray();
    expect(events.length).toBe(2);
    expect(events.some((e) => e.event_type === 'quantity_changed')).toBe(true);
  });

  // 3. Změna ceny produktu bez změny historických objednávek
  it('3. Změna ceny v číselníku produktů neovlivní existující objednávky', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    const originalPrice = sampleProduct1.price_cents; // 9500 (95 Kč)
    await posService.addItemToOrder(order.id, sampleProduct1, 1);

    // Změníme cenu v číselníku na 150 Kč
    await db.products.update(sampleProduct1.id, { price_cents: 15000 });

    const orderItems = await db.order_items.where({ order_id: order.id }).toArray();
    const payments = await db.payments.where({ order_id: order.id }).toArray();
    const calc = calculateOrder(orderItems, payments);

    expect(orderItems[0].unit_price_cents_snapshot).toBe(originalPrice);
    expect(calc.totalCents).toBe(originalPrice); // stále 95 Kč
  });

  // 4. Plná platba hotově
  it('4. Plná platba v hotovosti správně uzavře účet na 0 Kč dluh', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 2); // 2 × 95 = 190 Kč (19000 hal)

    const payment = await posService.recordPayment(order.id, 19000, 'cash');
    expect(payment.amount_cents).toBe(19000);
    expect(payment.payment_method).toBe('cash');
    expect(payment.status).toBe('completed');

    const items = await db.order_items.where({ order_id: order.id }).toArray();
    const payments = await db.payments.where({ order_id: order.id }).toArray();
    const calc = calculateOrder(items, payments);

    expect(calc.remainingCents).toBe(0);
    expect(calc.totalCashCents).toBe(19000);
    expect(calc.isFullyPaid).toBe(true);

    const updatedOrder = await db.orders.get(order.id);
    expect(updatedOrder?.status).toBe('paid');
  });

  // 5. Plná platba kartou
  it('5. Plná platba kartou eviduje správnou platební metodu', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct2, 1); // 5500 hal

    await posService.recordPayment(order.id, 5500, 'card');

    const items = await db.order_items.where({ order_id: order.id }).toArray();
    const payments = await db.payments.where({ order_id: order.id }).toArray();
    const calc = calculateOrder(items, payments);

    expect(calc.remainingCents).toBe(0);
    expect(calc.totalCardCents).toBe(5500);
    expect(calc.totalCashCents).toBe(0);
    expect(calc.isFullyPaid).toBe(true);
  });

  // 6. Kombinovaná platba hotově a kartou
  it('6. Kombinovaná platba (hotově + kartou) správně eviduje obě části', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    // Vytvoříme účet za 500 Kč (50000 haléřů)
    const mockProduct: Product = {
      id: 'mock-p500',
      category_id: 'cat-teas',
      name: 'Exkluzivní archivní čaj',
      price_cents: 50000,
      is_favorite: false,
      sort_order: 99,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await posService.addItemToOrder(order.id, mockProduct, 1);

    // První platba: 200 Kč hotově
    await posService.recordPayment(order.id, 20000, 'cash');

    // Druhá platba: 300 Kč kartou
    await posService.recordPayment(order.id, 30000, 'card');

    const items = await db.order_items.where({ order_id: order.id }).toArray();
    const payments = await db.payments.where({ order_id: order.id }).toArray();
    const calc = calculateOrder(items, payments);

    expect(calc.totalCents).toBe(50000);
    expect(calc.totalCashCents).toBe(20000);
    expect(calc.totalCardCents).toBe(30000);
    expect(calc.paidCents).toBe(50000);
    expect(calc.remainingCents).toBe(0);
    expect(calc.isFullyPaid).toBe(true);
  });

  // 7. Částečná úhrada s nenulovým dluhem
  it('7. Částečná úhrada ponechá přesný zbývající dluh a účet otevřený', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 2); // 190 Kč

    await posService.recordPayment(order.id, 10000, 'cash'); // 100 Kč

    const items = await db.order_items.where({ order_id: order.id }).toArray();
    const payments = await db.payments.where({ order_id: order.id }).toArray();
    const calc = calculateOrder(items, payments);

    expect(calc.paidCents).toBe(10000);
    expect(calc.remainingCents).toBe(9000); // 90 Kč zbývá
    expect(calc.isFullyPaid).toBe(false);

    const updatedOrder = await db.orders.get(order.id);
    expect(updatedOrder?.status).toBe('open');
  });

  // 8. Odmítnutí platby vyšší než zbývající dluh
  it('8. Odmítnutí platby vyšší než zbývající dluh (ochrana proti přeplatku)', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 1); // 95 Kč (9500 hal)

    // Pokus zaplatit 100 Kč (10000 hal)
    await expect(posService.recordPayment(order.id, 10000, 'cash')).rejects.toThrow(
      /Nelze uhradit více než zbývající dluh/i
    );

    const payments = await db.payments.where({ order_id: order.id }).toArray();
    expect(payments.length).toBe(0); // Žádná platba se neuložila
  });

  // 9. Ochrana proti duplicitní platbě
  it('9. Ochrana proti duplicitní platbě s idempotentním klíčem', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 2); // 190 Kč

    const idempotencyKey = 'payment-uuid-12345';
    const p1 = await posService.recordPayment(order.id, 10000, 'cash', idempotencyKey);
    const p2 = await posService.recordPayment(order.id, 10000, 'cash', idempotencyKey);

    expect(p1.id).toBe(p2.id);

    const payments = await db.payments.where({ order_id: order.id }).toArray();
    expect(payments.length).toBe(1); // Pouze 1 platba v DB
  });

  // 10. Storno platby a správné přepočítání přehledů
  it('10. Storno platby obnoví zbývající dluh a zaznamená audit', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 1); // 95 Kč

    const payment = await posService.recordPayment(order.id, 9500, 'cash');
    expect((await db.orders.get(order.id))?.status).toBe('paid');

    // Storno platby
    await posService.cancelPayment(payment.id, 'Omyl obsluhy - host chtěl platit kartou');

    const items = await db.order_items.where({ order_id: order.id }).toArray();
    const payments = await db.payments.where({ order_id: order.id }).toArray();
    const calc = calculateOrder(items, payments);

    expect(calc.remainingCents).toBe(9500); // dluh se obnovil
    expect(calc.paidCents).toBe(0);
    expect(calc.isFullyPaid).toBe(false);

    // Objednávka se znovu otevřela
    const reopenedOrder = await db.orders.get(order.id);
    expect(reopenedOrder?.status).toBe('open');

    // Platba zůstává v DB jako stornovaná (nemaze se fyzicky)
    const cancelledPayment = await db.payments.get(payment.id);
    expect(cancelledPayment?.status).toBe('cancelled');
    expect(cancelledPayment?.cancel_reason).toContain('Omyl obsluhy');
  });

  // 11. Přidání položky k účtu s doručenými položkami
  it('11. Přidání nové položky k účtu neovlivní již dříve doručené položky', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    const item1 = await posService.addItemToOrder(order.id, sampleProduct1, 1);

    // Označíme první položku jako doručenou
    await posService.markItemDelivered(item1.id);

    // Přidáme druhou položku
    const item2 = await posService.addItemToOrder(order.id, sampleProduct2, 1);

    const freshItem1 = (await db.order_items.get(item1.id))!;
    const freshItem2 = (await db.order_items.get(item2.id))!;

    expect(freshItem1.delivery_status).toBe('delivered');
    expect(freshItem2.delivery_status).toBe('pending');
  });

  // 12. Doručení jedné položky
  it('12. Doručení jedné položky změní stav na delivered a vytvoří událost', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    const item = await posService.addItemToOrder(order.id, sampleProduct1, 1);

    await posService.markItemDelivered(item.id);

    const updated = (await db.order_items.get(item.id))!;
    expect(updated.delivery_status).toBe('delivered');
    expect(updated.delivered_at).toBeTruthy();

    const events = await db.order_item_events.where({ order_item_id: item.id }).toArray();
    expect(events.some((e) => e.event_type === 'delivered')).toBe(true);
  });

  // 13. Hromadné doručení všech čekajících položek na stole
  it('13. Doručení všech čekajících položek objednávky jedním dotykem', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 1);
    await posService.addItemToOrder(order.id, sampleProduct2, 2);

    await posService.markAllItemsDeliveredForOrder(order.id);

    const items = await db.order_items.where({ order_id: order.id }).toArray();
    expect(items.every((i) => i.delivery_status === 'delivered')).toBe(true);
  });

  // 14. Vrácení položky do čekajícího stavu (Undo)
  it('14. Vrácení doručené položky zpět do čekajících', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    const item = await posService.addItemToOrder(order.id, sampleProduct1, 1);

    await posService.markItemDelivered(item.id);
    expect((await db.order_items.get(item.id))?.delivery_status).toBe('delivered');

    await posService.revertItemDelivery(item.id);
    const reverted = (await db.order_items.get(item.id))!;
    expect(reverted.delivery_status).toBe('pending');
    expect(reverted.delivered_at).toBeNull();

    const events = await db.order_item_events.where({ order_item_id: item.id }).toArray();
    expect(events.some((e) => e.event_type === 'reverted_to_pending')).toBe(true);
  });

  // 15. Správné vykázání plateb kolem půlnoci v Europe/Prague
  it('15. Správné vykázání plateb kolem půlnočního předělu v časovém pásmu Europe/Prague', async () => {
    // 23:55 v Praze (zimní čas UTC+1 -> 22:55Z)
    const lateEveningPrague = '2026-10-14T21:55:00.000Z'; // v Praze 23:55
    const earlyMorningPrague = '2026-10-14T22:05:00.000Z'; // v Praze 00:05 další den (2026-10-15)

    expect(getLocalDateString(lateEveningPrague, 'Europe/Prague')).toBe('2026-10-14');
    expect(getLocalDateString(earlyMorningPrague, 'Europe/Prague')).toBe('2026-10-15');

    // Vytvoříme objednávku pozdě večer a zaplatíme ji po půlnoci
    const order = {
      id: 'order-midnight',
      table_id: null,
      order_number: '20261014-099',
      status: 'paid' as const,
      created_at: lateEveningPrague,
      closed_at: earlyMorningPrague,
    };
    const item = {
      id: 'item-midnight',
      order_id: order.id,
      product_id: sampleProduct1.id,
      product_name_snapshot: sampleProduct1.name,
      unit_price_cents_snapshot: 9500,
      quantity: 1,
      delivery_status: 'delivered' as const,
      created_at: lateEveningPrague,
      updated_at: lateEveningPrague,
    };
    const payment = {
      id: 'payment-midnight',
      order_id: order.id,
      amount_cents: 9500,
      payment_method: 'card' as const,
      status: 'completed' as const,
      created_at: earlyMorningPrague,
    };

    const categoriesMap = new Map([['cat-teas', 'Čaje']]);
    const prodCatMap = new Map([[sampleProduct1.id, 'cat-teas']]);

    // Report pro 14.10.: Položka byla prodána, ale platba ještě nepřišla
    const report14 = generateDailyReport(
      '2026-10-14',
      [order],
      [item],
      [payment],
      categoriesMap,
      prodCatMap
    );
    expect(report14.soldItemsValueCents).toBe(9500);
    expect(report14.totalPaymentsCents).toBe(0); // platba proběhla až zítra

    // Report pro 15.10.: Platba přišla v 00:05
    const report15 = generateDailyReport(
      '2026-10-15',
      [order],
      [item],
      [payment],
      categoriesMap,
      prodCatMap
    );
    expect(report15.totalPaymentsCents).toBe(9500);
    expect(report15.cardPaymentsCents).toBe(9500);
    expect(report15.soldItemsValueCents).toBe(0); // položka byla zařazena včera
  });

  // 16. Obnova dat po obnovení stránky
  it('16. Obnova dat po obnovení stránky z IndexedDB', async () => {
    const table = (await db.pos_tables.toArray())[0];
    const order = await posService.getOrCreateOrderForTable(table.id);
    await posService.addItemToOrder(order.id, sampleProduct1, 2);

    // Simulace obnovy stránky: dotaz na existující objednávku stolu
    const restoredOrder = await posService.getOrCreateOrderForTable(table.id);
    expect(restoredOrder.id).toBe(order.id);

    const restoredItems = await db.order_items.where({ order_id: restoredOrder.id }).toArray();
    expect(restoredItems.length).toBe(1);
    expect(restoredItems[0].quantity).toBe(2);
  });

  // 17. Synchronizace po obnovení internetu (Outbox fronta)
  it('17. Zařazení mutací do Outbox synchronizační fronty', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 1);
    await posService.recordPayment(order.id, sampleProduct1.price_cents, 'cash');

    const outboxItems = await db.sync_outbox.toArray();
    expect(outboxItems.length).toBeGreaterThanOrEqual(3); // order + item + payment
    expect(outboxItems.some((i) => i.entity === 'payments')).toBe(true);
    expect(outboxItems.every((i) => ['pending', 'synced', 'failed'].includes(i.status))).toBe(true);
  });

  // 18. Opakování synchronizace bez vytváření duplicit
  it('18. Opakování synchronizace je bezpečné díky klientskému idempotentnímu ID', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    // Přidáme produkt, aby objednávka měla dluh k úhradě
    await posService.addItemToOrder(order.id, sampleProduct1, 1); // 95 Kč (9500 hal)

    const fixedId = 'test-fixed-payment-uuid';
    await posService.recordPayment(order.id, 5000, 'cash', fixedId);

    // Zkontrolujeme položku v outboxu
    const outboxItem = await db.sync_outbox.get(fixedId);
    expect(outboxItem).toBeTruthy();
    expect(outboxItem?.id).toBe(fixedId);

    // Simulace opakovaného zařazení do outboxu se stejným ID
    await syncEngine.queueMutation('payments', 'insert', { id: fixedId }, fixedId);

    const allPaymentsInDb = await db.payments.where({ id: fixedId }).toArray();
    expect(allPaymentsInDb.length).toBe(1);
  });

  // 19. Export dat a ověření konzistence součtů
  it('19. Export dat a kontrola finanční konzistence', async () => {
    const order = await posService.getOrCreateOrderForTable(null);
    await posService.addItemToOrder(order.id, sampleProduct1, 1); // 95 Kč
    await posService.addItemToOrder(order.id, sampleProduct2, 1); // 55 Kč
    // Celkem 150 Kč

    await posService.recordPayment(order.id, 10000, 'cash');
    await posService.recordPayment(order.id, 5000, 'card');

    const orders = await db.orders.toArray();
    const items = await db.order_items.toArray();
    const payments = await db.payments.toArray();

    const today = getLocalDateString(new Date().toISOString());
    const report = generateDailyReport(
      today,
      orders,
      items,
      payments,
      new Map(),
      new Map()
    );

    // Kontrola matematických invariantů
    expect(report.totalPaymentsCents).toBe(report.cashPaymentsCents + report.cardPaymentsCents);
    expect(report.totalPaymentsCents).toBe(15000);
    expect(report.soldItemsValueCents).toBe(15000);
    expect(report.unpaidReceivablesCents).toBe(0);
    expect(formatCents(report.totalPaymentsCents)).toBe('150 Kč');
  });
});
