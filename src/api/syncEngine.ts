import { db } from '../db/posDatabase';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { SyncOutboxItem } from '../domain/types';

export class SyncEngine {
  private isProcessing = false;
  private listeners: Array<() => void> = [];

  public isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  public pendingCount = 0;
  public lastSyncTime: Date | null = null;
  public lastError: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.notify();
        this.triggerSync();
      });
      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.notify();
      });
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  /**
   * Zařadí transakční operaci do Outbox fronty a okamžitě zkusí synchronizovat.
   */
  public async queueMutation(
    entity: SyncOutboxItem['entity'],
    action: SyncOutboxItem['action'],
    payload: Record<string, unknown>,
    id: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const item: SyncOutboxItem = {
      id,
      entity,
      action,
      payload,
      status: 'pending',
      retry_count: 0,
      created_at: now,
      updated_at: now,
    };

    await db.sync_outbox.put(item);
    await this.updatePendingCount();
    this.notify();

    // Pokus o okamžitou synchronizaci, pokud jsme online
    if (this.isOnline) {
      this.triggerSync();
    }
  }

  public async updatePendingCount() {
    this.pendingCount = await db.sync_outbox
      .where('status')
      .anyOf(['pending', 'failed'])
      .count();
    this.notify();
  }

  /**
   * Spustí postupné zpracování fronty (FIFO).
   */
  public async triggerSync(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.isOnline) return;

    if (!isSupabaseConfigured || !supabase) {
      // Supabase není nakonfigurován, data zůstávají spolehlivě v lokální IndexedDB
      return;
    }

    this.isProcessing = true;
    this.notify();

    try {
      const itemsToSync = await db.sync_outbox
        .where('status')
        .anyOf(['pending', 'failed'])
        .sortBy('created_at');

      for (const item of itemsToSync) {
        try {
          await db.sync_outbox.update(item.id, { status: 'syncing' });

          // Specifické volání pro platby (RPC s transakční kontrolou)
          if (item.entity === 'payments' && item.action === 'insert') {
            const p = item.payload;
            const { error } = await supabase.rpc('process_payment', {
              p_payment_id: item.id,
              p_order_id: p.order_id,
              p_amount_cents: p.amount_cents,
              p_tip_amount_cents: p.tip_amount_cents || 0,
              p_payment_method: p.payment_method,
              p_paid_items: p.paid_items || [],
            });
            if (error) throw error;
          } else {
            // Standardní upsert s idempotentním id
            const { error } = await supabase
              .from(item.entity)
              .upsert(item.payload, { onConflict: 'id' });

            if (error) throw error;
          }

          // Úspěch - označíme jako synchronizováno
          await db.sync_outbox.update(item.id, {
            status: 'synced',
            error_message: null,
            updated_at: new Date().toISOString(),
          });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[SyncEngine] Chyba synchronizace položky ${item.id}:`, errorMsg);
          this.lastError = errorMsg;

          await db.sync_outbox.update(item.id, {
            status: 'failed',
            retry_count: item.retry_count + 1,
            error_message: errorMsg,
            updated_at: new Date().toISOString(),
          });
        }
      }

      this.lastSyncTime = new Date();
    } finally {
      this.isProcessing = false;
      await this.updatePendingCount();
      this.notify();
    }
  }
}

export const syncEngine = new SyncEngine();
