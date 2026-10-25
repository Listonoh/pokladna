# Copilot instructions for pokladna

## Project overview

This repo is a Vite + React + TypeScript PWA for a tea shop POS ("Pokladní systém čajovny Miska s Listím"). The app is designed around an offline-first local database and a Supabase sync layer, not a classic client/server app.

Major architectural pieces:

- `src/App.tsx` selects the active tab (`pos`, `delivery`, `reports`, `admin`) and initializes local seed data on first load.
- `src/db/posDatabase.ts` defines the Dexie schema for categories, products, tables, orders, order items, payments, and `sync_outbox`.
- `src/domain/posService.ts` is the business logic layer for creating orders, adding items, payments, delivery state changes, and idempotent payment handling.
- `src/domain/calculations.ts` contains all monetary logic: prices are stored in haléřs (`price_cents`), reports are timezone-aware (`Europe/Prague`), and balances are derived from order items + payments.
- `src/api/syncEngine.ts` is the offline-first Sync Outbox. Mutations are queued locally and pushed to Supabase when online; when offline, they remain in IndexedDB.
- `src/components/*` are mostly view/state orchestration; business logic should generally live in `src/domain/*` and the database access layer.

## Build, test, and validation commands

Use the project scripts from the repo root:

```bash
npm install
npm run dev
npm run build
npm test
```

There is no separate lint script in `package.json`.

For a single test case, target the Vitest spec by name:

```bash
npx vitest run src/test/pos.spec.ts -t "4. Plná platba v hotovosti správně uzavře účet na 0 Kč dluh"
```

You can also run a single file:

```bash
npx vitest run src/test/pos.spec.ts
```

## Important repo conventions

- Money is stored in cents, never floating point. Use `*_cents` fields (`price_cents`, `amount_cents`, `tip_amount_cents`) throughout the codebase.
- Historical order data must remain immutable: when an order item is created, it stores a snapshot of the product name and unit price. Later product edits do not retroactively change already-created orders.
- Payment logic is intentionally strict: do not allow overpayment, and always check remaining balance before accepting a payment. Validation code lives in `src/domain/calculations.ts`.
- Order items are not deleted for normal cancellations; they are marked with statuses such as `cancelled` / `delivery_status` values instead of being physically removed where the business rules require an audit trail.
- Orders, payments, and order-item mutations are queued into the local `sync_outbox` before an online sync attempt. Treat the outbox as the source of truth for eventual consistency.
- The app expects Czech locale and timezone handling, especially for reporting at midnight and for UI labels that use `cs-CZ` formatting.
- Seed data is initialized if the local database is empty (`seedInitialDataIfEmpty` in `src/db/posDatabase.ts`), so tests and local development start with known categories, tables, and products.
- The database schema is Dexie/IndexedDB-first; Supabase is optional and should be treated as an integration layer, not the only storage system.

## When changing code

- Prefer updating domain logic in `src/domain/` rather than embedding business rules in components.
- Keep repository/test expectations aligned with the existing 19 scenario suite in `src/test/pos.spec.ts`.
- When adding or changing money-related logic, verify both the totals and the audit/immutability assumptions.
- If a change affects offline sync or payment flows, include an explicit test scenario so the outbox and payment invariants remain covered.

## Relevant project notes from README

- The POS includes tabs for `pos`, `delivery`, `reports`, and `admin`.
- It supports PWA/offline-first workflows, local export (CSV/JSON), and Supabase-backed sync.
- All order and payment data is designed to remain consistent around midnight in `Europe/Prague` and to support idempotent payment handling.
