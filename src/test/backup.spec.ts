import { afterEach, describe, expect, it } from 'vitest';
import { createLocalBackup, parseLocalBackup, restoreLocalBackup } from '../db/backup';
import { PosDatabase } from '../db/posDatabase';

const databases: PosDatabase[] = [];

function createTestDatabase(): PosDatabase {
  const database = new PosDatabase(`backup-test-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('local database backup', () => {
  it('exports and restores all data including queued changes', async () => {
    const source = createTestDatabase();
    const target = createTestDatabase();
    const category = {
      id: 'category-1',
      name: 'Tea',
      sort_order: 1,
      is_active: true,
      created_at: '2026-11-16T20:00:00.000Z',
      updated_at: '2026-11-16T20:00:00.000Z',
    };
    const queued = {
      id: 'order-1',
      entity: 'orders' as const,
      action: 'insert' as const,
      payload: { id: 'order-1' },
      status: 'syncing' as const,
      retry_count: 0,
      created_at: '2026-11-16T20:00:00.000Z',
      updated_at: '2026-11-16T20:00:00.000Z',
    };
    await source.categories.put(category);
    await source.sync_outbox.put(queued);
    await target.categories.put({ ...category, id: 'stale-category' });

    const backup = parseLocalBackup(JSON.stringify(await createLocalBackup(source)));
    await restoreLocalBackup(backup, target);

    expect(await target.categories.toArray()).toEqual([category]);
    expect(await target.sync_outbox.get(queued.id)).toEqual({ ...queued, status: 'pending' });
  });

  it('rejects invalid and unsupported backup files', () => {
    expect(() => parseLocalBackup('{')).toThrow('platný JSON');
    expect(() => parseLocalBackup(JSON.stringify({ format: 'other', version: 1, data: {} }))).toThrow(
      'podporovaná záloha'
    );
    expect(() =>
      parseLocalBackup(JSON.stringify({
        format: 'pokladna-local-backup',
        version: 1,
        exported_at: '2026-11-17T00:00:00.000Z',
        data: { categories: [{ name: 'missing id' }] },
      }))
    ).toThrow('neplatná data');
  });
});
