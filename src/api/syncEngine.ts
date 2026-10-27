import { db } from '../db/posDatabase';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { SyncOutboxItem } from '../domain/types';

/**
 * Převede libovolnou chybu z PostgREST / Supabase / sítě na srozumitelnou zprávu.
 */
export function formatSyncError(err: unknown, entity?: string, action?: string): string {
  if (!err) return 'Neznámá chyba při synchronizaci.';

  if (typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const code = anyErr.code ? String(anyErr.code) : '';
    const message = anyErr.message
      ? String(anyErr.message)
      : err instanceof Error
      ? err.message
      : '';
    const details = anyErr.details ? String(anyErr.details) : '';
    const hint = anyErr.hint ? String(anyErr.hint) : '';

    // PostgreSQL 42501 - Row Level Security policy violation
    if (code === '42501' || message.includes('row-level security') || message.includes('violates row-level security policy')) {
      const targetTable = entity ? `do tabulky "${entity}"` : 'do databáze';
      return `Chyba oprávnění (RLS 42501) při zápisu ${targetTable}: Supabase zamítl požadavek, protože RLS politika nepovoluje zápis pro roli 'anon' (veřejný klíč). V SQL Editoru na Supabase upravte politiky např.: ALTER POLICY "..." ON public.${entity || 'tabulka'} TO anon, authenticated; (Detail: ${message})`;
    }

    // PostgreSQL 22P02 - Neplatná syntaxe typu (např. UUID vs textové ID "tbl-4")
    if (code === '22P02' || message.includes('invalid input syntax')) {
      return `Chyba datového typu (22P02) u "${entity || ''}": Databáze na serveru má sloupec typu UUID, ale aplikace posílá textové ID (např. "${message.match(/"([^"]+)"/)?.[1] || 'tbl-4'}"). V Supabase SQL Editoru spusťte aktualizovanou migraci s typem TEXT. (Detail: ${message})`;
    }

    // PostgreSQL 23503 - Foreign key violation
    if (code === '23503') {
      return `Chyba integrity dat (23503 cizí klíč) u "${entity || ''}": Záznam odkazuje na položku, která v databázi ještě neexistuje. (Detail: ${message})`;
    }

    // PostgreSQL 23505 - Unique constraint violation
    if (code === '23505') {
      return `Konflikt duplicity (23505) u tabulky "${entity || ''}": Záznam již v databázi existuje. (Detail: ${message})`;
    }

    // Chyba sítě (offline / DNS / firewall)
    if (
      message === 'Failed to fetch' ||
      message.includes('NetworkError') ||
      message.includes('Failed to load resource') ||
      message.includes('net::ERR_')
    ) {
      return 'Chyba sítě (Failed to fetch): Nepodařilo se navázat spojení se serverem Supabase. Zkontrolujte připojení k internetu nebo URL adresu v .env.';
    }

    // Obecná chyba z PostgREST
    if (code || message) {
      const parts: string[] = [];
      if (code) parts.push(`[Kód ${code}]`);
      if (entity) parts.push(`[${entity}${action ? `:${action}` : ''}]`);
      if (message) parts.push(message);
      if (details && details !== 'null') parts.push(`Detail: ${details}`);
      if (hint && hint !== 'null') parts.push(`Nápověda: ${hint}`);
      return parts.join(' ');
    }

    if (err instanceof Error) {
      return err.message;
    }

    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  return String(err);
}

export class SyncEngine {
  public isProcessing = false;
  public isAuthenticated = false;
  private listeners: Array<() => void> = [];

  public isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  public pendingCount = 0;
  public lastSyncTime: Date | null = null;
  public lastError: string | null = null;

  constructor() {
    if (supabase) {
      supabase.auth.onAuthStateChange((_event, session) => {
        this.isAuthenticated = Boolean(session);
        this.notify();
        if (session) {
          setTimeout(() => {
            void this.triggerSync();
          }, 0);
        }
      });
    }

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
      this.updatePendingCount();
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

    // Pokud existují selhané položky a nemáme nastavenou aktuální chybu, načteme poslední chybu z fronty
    if (this.pendingCount > 0 && !this.lastError) {
      const failedItems = await db.sync_outbox
        .where('status')
        .equals('failed')
        .reverse()
        .sortBy('updated_at');

      if (failedItems.length > 0 && failedItems[0].error_message) {
        this.lastError = failedItems[0].error_message;
      }
    } else if (this.pendingCount === 0) {
      this.lastError = null;
    }

    this.notify();
  }

  /**
   * Vyprázdní outbox frontu a resetuje chybový stav (např. při změně schématu nebo zahazování testovacích dat).
   */
  public async clearOutbox(): Promise<void> {
    await db.sync_outbox.clear();
    this.lastError = null;
    await this.updatePendingCount();
    this.notify();
  }

  /**
   * Spustí postupné zpracování fronty (FIFO).
   */
  public async triggerSync(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.isOnline) return;

    if (!isSupabaseConfigured || !supabase) {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      let reason = 'chybí konfigurace v .env';

      if (!url && !key) {
        reason = 'chybí VITE_SUPABASE_URL i VITE_SUPABASE_PUBLISHABLE_KEY v .env';
      } else if (!url) {
        reason = 'chybí VITE_SUPABASE_URL v .env';
      } else if (!key) {
        reason = 'chybí VITE_SUPABASE_PUBLISHABLE_KEY v .env';
      } else if (url === 'https://your-project.supabase.co' || key === 'your-publishable-key-here') {
        reason = 'v .env jsou zadány pouze výchozí vzorové hodnoty';
      }

      this.lastError = `Supabase není nakonfigurován (${reason}). Data zůstávají bezpečně uložena v lokální IndexedDB pokladny.`;
      console.warn(`[SyncEngine] ${this.lastError}`);
      this.notify();
      return;
    }

    if (!this.isAuthenticated) return;

    this.isProcessing = true;
    this.notify();

    let hasFailures = false;

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
              p_discount_cents: p.discount_cents || 0,
              p_discount_percent: p.discount_percent || 0,
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
          hasFailures = true;
          const errorMsg = formatSyncError(err, item.entity, item.action);
          console.error(`[SyncEngine] Chyba synchronizace položky (${item.entity}/${item.action} ID: ${item.id}):`, errorMsg, err);
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
      if (!hasFailures) {
        this.lastError = null;
      }
    } catch (globalErr: unknown) {
      const globalErrorMsg = formatSyncError(globalErr);
      console.error('[SyncEngine] Kritická chyba běhu synchronizace:', globalErrorMsg, globalErr);
      this.lastError = globalErrorMsg;
    } finally {
      this.isProcessing = false;
      await this.updatePendingCount();
      this.notify();
    }
  }
}

export const syncEngine = new SyncEngine();
