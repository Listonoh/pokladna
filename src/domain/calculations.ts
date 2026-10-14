import { OrderItem, Payment, OrderCalculation, Order } from './types';

/**
 * Převede částku v korunách na celočíselné haléře (např. 85.50 -> 8550).
 */
export function czkToCents(czk: number): number {
  return Math.round(czk * 100);
}

/**
 * Převede haléře na koruny.
 */
export function centsToCzk(cents: number): number {
  return cents / 100;
}

/**
 * Formátuje částku v haléřích pro české uživatelské rozhraní.
 * Např. 8500 -> "85 Kč", 8550 -> "85,50 Kč"
 */
export function formatCents(cents: number): string {
  const czk = centsToCzk(cents);
  const formatted = new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(czk);
  return `${formatted} Kč`;
}

/**
 * Vypočítá finanční bilanci objednávky, spropitné a stavy doručení.
 */
export function calculateOrder(items: OrderItem[], payments: Payment[]): OrderCalculation {
  // Aktivní položky (nepočítáme stornované)
  const activeItems = items.filter((item) => item.delivery_status !== 'cancelled');

  const totalCents = activeItems.reduce((acc, item) => {
    return acc + (item.unit_price_cents_snapshot * item.quantity);
  }, 0);

  // Platné platby (nepočítáme stornované)
  const activePayments = payments.filter((p) => p.status === 'completed');

  // Částka za zboží
  const totalCashCents = activePayments
    .filter((p) => p.payment_method === 'cash')
    .reduce((acc, p) => acc + p.amount_cents, 0);

  const totalCardCents = activePayments
    .filter((p) => p.payment_method === 'card')
    .reduce((acc, p) => acc + p.amount_cents, 0);

  // Spropitné / dýška
  const totalCashTipsCents = activePayments
    .filter((p) => p.payment_method === 'cash')
    .reduce((acc, p) => acc + (p.tip_amount_cents || 0), 0);

  const totalCardTipsCents = activePayments
    .filter((p) => p.payment_method === 'card')
    .reduce((acc, p) => acc + (p.tip_amount_cents || 0), 0);

  const totalTipsCents = totalCashTipsCents + totalCardTipsCents;
  const paidCents = totalCashCents + totalCardCents;
  const remainingCents = Math.max(0, totalCents - paidCents);

  const totalReceivedCashCents = totalCashCents + totalCashTipsCents;
  const totalReceivedCardCents = totalCardCents + totalCardTipsCents;

  const pendingDeliveryCount = activeItems.filter((i) => i.delivery_status === 'pending')
    .reduce((acc, i) => acc + i.quantity, 0);

  const deliveredCount = activeItems.filter((i) => i.delivery_status === 'delivered')
    .reduce((acc, i) => acc + i.quantity, 0);

  const isFullyPaid = totalCents > 0 && remainingCents === 0;

  return {
    totalCents,
    paidCents,
    totalTipsCents,
    remainingCents,
    totalCashCents,
    totalCardCents,
    totalCashTipsCents,
    totalCardTipsCents,
    totalReceivedCashCents,
    totalReceivedCardCents,
    pendingDeliveryCount,
    deliveredCount,
    isFullyPaid,
  };
}

/**
 * Validace přijetí platby - striktně odmítne platbu vyšší než zbývající dluh
 * nebo neplatnou částku (<= 0) pro cenu položek.
 */
export function validatePaymentAmount(
  remainingCents: number,
  baseItemAmountCents: number,
  tipAmountCents = 0
): { valid: boolean; error?: string } {
  if (baseItemAmountCents <= 0) {
    return { valid: false, error: 'Částka za položky musí být větší než 0 Kč.' };
  }
  if (baseItemAmountCents > remainingCents) {
    return {
      valid: false,
      error: `Nelze uhradit více než zbývající dluh (${formatCents(remainingCents)}). Požadováno: ${formatCents(baseItemAmountCents)}.`,
    };
  }
  if (tipAmountCents < 0) {
    return { valid: false, error: 'Spropitné nemůže být záporné.' };
  }
  return { valid: true };
}

export interface DailyReportSummary {
  date: string; // YYYY-MM-DD
  totalPaymentsCents: number; // Celkem přijaté peníze (položky + spropitné)
  normalSalesCents: number; // Čisté tržby za prodané zboží
  totalTipsCents: number; // Spropitné celkem
  cashTipsCents: number; // Spropitné v hotovosti
  cardTipsCents: number; // Spropitné kartou
  cashPaymentsCents: number; // Celková hotovost (zboží + spropitné)
  cardPaymentsCents: number; // Celková karta (zboží + spropitné)
  completedOrdersCount: number;
  openOrdersCount: number;
  unpaidReceivablesCents: number;
  soldItemsValueCents: number;
  categoryBreakdown: Record<string, { categoryName: string; totalCents: number; itemsCount: number }>;
  productBreakdown: Record<string, { productName: string; totalCents: number; itemsCount: number }>;
}

/**
 * Získá datum ve formátu YYYY-MM-DD pro zadané ISO datum v daném časovém pásmu (default Europe/Prague).
 */
export function getLocalDateString(isoDateStr: string, timeZone = 'Europe/Prague'): string {
  const d = new Date(isoDateStr);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

/**
 * Sestaví denní report s oddělením tržeb za zboží, spropitného a platebních metod.
 */
export function generateDailyReport(
  targetDate: string, // YYYY-MM-DD
  allOrders: Order[],
  allItems: OrderItem[],
  allPayments: Payment[],
  categoriesMap: Map<string, string>, // categoryId -> categoryName
  productsCategoryMap: Map<string, string>, // productId -> categoryId
  timeZone = 'Europe/Prague'
): DailyReportSummary {
  // 1. Platby přijaté v daný den (dle data vytvoření platby)
  const dayPayments = allPayments.filter((p) => {
    return p.status === 'completed' && getLocalDateString(p.created_at, timeZone) === targetDate;
  });

  const normalSalesCashCents = dayPayments
    .filter((p) => p.payment_method === 'cash')
    .reduce((sum, p) => sum + p.amount_cents, 0);

  const normalSalesCardCents = dayPayments
    .filter((p) => p.payment_method === 'card')
    .reduce((sum, p) => sum + p.amount_cents, 0);

  const normalSalesCents = normalSalesCashCents + normalSalesCardCents;

  const cashTipsCents = dayPayments
    .filter((p) => p.payment_method === 'cash')
    .reduce((sum, p) => sum + (p.tip_amount_cents || 0), 0);

  const cardTipsCents = dayPayments
    .filter((p) => p.payment_method === 'card')
    .reduce((sum, p) => sum + (p.tip_amount_cents || 0), 0);

  const totalTipsCents = cashTipsCents + cardTipsCents;

  const cashPaymentsCents = normalSalesCashCents + cashTipsCents;
  const cardPaymentsCents = normalSalesCardCents + cardTipsCents;
  const totalPaymentsCents = cashPaymentsCents + cardPaymentsCents;

  // 2. Položky prodané v daný den (dle vytvoření položky)
  const dayItems = allItems.filter((item) => {
    return item.delivery_status !== 'cancelled' && getLocalDateString(item.created_at, timeZone) === targetDate;
  });

  const soldItemsValueCents = dayItems.reduce(
    (sum, i) => sum + (i.unit_price_cents_snapshot * i.quantity),
    0
  );

  // 3. Počty objednávek
  const dayOrders = allOrders.filter(
    (o) => getLocalDateString(o.created_at, timeZone) === targetDate
  );

  const completedOrdersCount = dayOrders.filter((o) => o.status === 'paid').length;
  const openOrdersCount = dayOrders.filter((o) => o.status === 'open').length;

  // 4. Neuhrazené zůstatky pro objednávky daného dne
  let unpaidReceivablesCents = 0;
  for (const order of dayOrders) {
    if (order.status === 'cancelled') continue;
    const orderItems = allItems.filter((i) => i.order_id === order.id);
    const orderPayments = allPayments.filter((p) => p.order_id === order.id);
    const calc = calculateOrder(orderItems, orderPayments);
    unpaidReceivablesCents += calc.remainingCents;
  }

  // 5. Rozpad podle produktů a kategorií
  const productBreakdown: Record<string, { productName: string; totalCents: number; itemsCount: number }> = {};
  const categoryBreakdown: Record<string, { categoryName: string; totalCents: number; itemsCount: number }> = {};

  for (const item of dayItems) {
    const itemTotalCents = item.unit_price_cents_snapshot * item.quantity;

    // Produkt
    if (!productBreakdown[item.product_name_snapshot]) {
      productBreakdown[item.product_name_snapshot] = {
        productName: item.product_name_snapshot,
        totalCents: 0,
        itemsCount: 0,
      };
    }
    productBreakdown[item.product_name_snapshot].totalCents += itemTotalCents;
    productBreakdown[item.product_name_snapshot].itemsCount += item.quantity;

    // Kategorie
    const catId = productsCategoryMap.get(item.product_id) || 'unknown';
    const catName = categoriesMap.get(catId) || 'Ostatní';

    if (!categoryBreakdown[catName]) {
      categoryBreakdown[catName] = {
        categoryName: catName,
        totalCents: 0,
        itemsCount: 0,
      };
    }
    categoryBreakdown[catName].totalCents += itemTotalCents;
    categoryBreakdown[catName].itemsCount += item.quantity;
  }

  return {
    date: targetDate,
    totalPaymentsCents,
    normalSalesCents,
    totalTipsCents,
    cashTipsCents,
    cardTipsCents,
    cashPaymentsCents,
    cardPaymentsCents,
    completedOrdersCount,
    openOrdersCount,
    unpaidReceivablesCents,
    soldItemsValueCents,
    categoryBreakdown,
    productBreakdown,
  };
}
