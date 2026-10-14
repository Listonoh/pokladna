export type PaymentMethod = 'cash' | 'card';
export type PaymentStatus = 'completed' | 'cancelled';
export type OrderStatus = 'open' | 'paid' | 'cancelled';
export type DeliveryStatus = 'pending' | 'delivered' | 'cancelled';

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  category_id: string;
  name: string;
  price_cents: number; // Uloženo v haléřích (např. 8500 = 85 Kč)
  is_favorite: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Table {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  table_id: string | null; // null pro "Bez stolu / S sebou"
  order_number: string;
  status: OrderStatus;
  note?: string;
  created_at: string;
  closed_at?: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_cents_snapshot: number;
  quantity: number;
  paid_quantity: number; // Kolik kusů již bylo zaplaceno
  note?: string;
  delivery_status: DeliveryStatus;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type OrderItemEventType =
  | 'created'
  | 'quantity_changed'
  | 'delivered'
  | 'reverted_to_pending'
  | 'cancelled';

export interface OrderItemEvent {
  id: string;
  order_item_id: string;
  event_type: OrderItemEventType;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface PaymentItemDetail {
  order_item_id: string;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
}

export interface Payment {
  id: string; // Idempotentní UUID v4 generované klientem
  order_id: string;
  amount_cents: number; // Cena zaplacených položek bez spropitného
  tip_amount_cents: number; // Spropitné / dýško
  payment_method: PaymentMethod;
  status: PaymentStatus;
  paid_items?: PaymentItemDetail[];
  cancel_reason?: string | null;
  created_at: string;
  cancelled_at?: string | null;
}

export type PaymentEventType = 'created' | 'cancelled';

export interface PaymentEvent {
  id: string;
  payment_id: string;
  event_type: PaymentEventType;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncOutboxItem {
  id: string; // Idempotentní klíč operace
  entity: 'categories' | 'products' | 'tables' | 'orders' | 'order_items' | 'payments' | 'order_item_events' | 'payment_events';
  action: 'insert' | 'update' | 'upsert' | 'delete';
  payload: Record<string, unknown>;
  status: SyncStatus;
  retry_count: number;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

// Pohledové struktury pro UI
export interface OrderCalculation {
  totalCents: number; // Celková hodnota položek
  paidCents: number; // Zaplaceno za položky (bez spropitného)
  totalTipsCents: number; // Celkové spropitné
  remainingCents: number; // Zbývá doplatit za položky
  totalCashCents: number; // Hotovost (pouze položky)
  totalCardCents: number; // Karta (pouze položky)
  totalCashTipsCents: number; // Hotovost (spropitné)
  totalCardTipsCents: number; // Karta (spropitné)
  totalReceivedCashCents: number; // Celkem hotovost (položky + spropitné)
  totalReceivedCardCents: number; // Celkem karta (položky + spropitné)
  pendingDeliveryCount: number;
  deliveredCount: number;
  isFullyPaid: boolean;
}

export type TableOccupancyStatus = 'free' | 'open' | 'pending_delivery' | 'has_balance';
