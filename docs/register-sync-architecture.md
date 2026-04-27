# Register sync architecture — event-sourced, Lamport-ordered, human-reviewable

## The paranoid scenario

Multiple registers running. Some at the store, some at a convention. Convention WiFi is down. Store internet hiccups. Vercel deploy is broken. Your phone has 1 bar of LTE. **Pre-launch is exactly when to architect for this**, before there's legacy data to migrate around.

Goal: when everything reconnects, the system **self-heals to a consistent state**, with clearly-flagged review for anything ambiguous, and a permanent audit trail of every reconciliation decision.

## Five principles, in priority order

### 1. Event-sourced sync, not state sync

Registers don't push "here's my current view of inventory" — they push **the events that happened**. "Sold one Catan to customer X at 3:42 PM, idempotency key abc123."

Server applies events in causal order. State is reconstructed from events; events are immutable.

This makes worst-case merging tractable. Multiple registers all pushing event streams just produce a longer, ordered event log on the server. State sync would require complex three-way diffs; event sync just requires append + ordering.

### 2. Lamport clocks, not wall clocks

Every event carries `(deviceId, lamportCount, wallTime)`.

- `wallTime` is for humans (display, audit, "when did this happen").
- `lamportCount` is for ordering (causality across devices).
- `deviceId` is the tie-break when two events have the same Lamport count.

Cashier's tablet clock is wrong by 4 minutes? Doesn't matter. The relative order of events on each device is preserved. Cross-device tie-breaks are deterministic via deviceId. This is how you avoid "register A's clock was slightly behind register B's, so events appear to happen in the wrong order."

### 3. Per-event idempotency keys, generated client-side

Every transaction, every credit application, every loyalty redemption gets a UUID minted on the device when the event is created.

Server stores `(deviceId, idempotencyKey)` as a unique constraint. Sync that fails halfway and retries cannot double-apply anything — the second attempt is a no-op for already-seen events.

This is the single biggest source of correctness in distributed sync. Get it right and most "the data is wrong" classes of bug disappear.

### 4. Conflict policies are per-table, not global

Different data has different semantics. One blanket policy doesn't work.

| Domain | Policy | Why |
|---|---|---|
| **Inventory** | Additive math. `qty -= 1` per sale, `qty += 1` per return. Events commute. | Two registers each selling 1 of 1 Catan = `qty -= 2`, ending state `-1`. The math is right; the **business outcome** ("we oversold") is a separate concern surfaced via reconciliation. |
| **Sales / receipts / ledger entries** | Append-only, never conflict. Each row unique by idempotency key. | Append semantics by definition. |
| **Customer credit balance** | Earn/redeem events applied in Lamport order. | Order matters: earn-then-redeem succeeds; redeem-then-earn might fail authorization. |
| **Loyalty points** | Same as credit balance. | Same reasoning. |
| **Price changes / settings** | Last-write-wins by `(wallTime, deviceId)`, with last-3 history kept for audit. | Settings rarely conflict; when they do, recency is the right tiebreak. |
| **Deferred-capture results (state C)** | Not a conflict — a separate "after-the-fact" event posting decline-or-success. | Card auth result is itself an event in the timeline. |
| **Customer record updates** | Field-level merge: latest wallTime wins per field. | Prevents "register A updates phone, register B updates email, sync drops one." |

### 5. Reconciliation queue surfaces ambiguity to humans

Stuff that resolves automatically just resolves. Stuff that's **genuinely ambiguous** lands in `/dashboard/reconciliation` with full context.

Examples that should always queue for review:
- Oversold last unit (inventory went negative)
- Customer credit balance went negative after sync
- Deferred capture (state C) declined
- Two registers issued the same special-edition / numbered-edition product
- Same customer's record updated to conflicting values on the same field within the same sync window

Each queued item shows:
- What happened (events that caused the conflict)
- Where (which device, store, time)
- Suggested resolution
- Override controls (accept, reject, modify)
- Customer contact info if applicable (so owner can call about a deferred decline)

Owner clicks accept/reject/modify; every decision is logged forever in `reconciliation_decisions` with operator, timestamp, before/after state. **Never lose history.**

## The wire protocol

### Local event log on device

SQLite table `events`:

```
CREATE TABLE events (
  id TEXT PRIMARY KEY,                  -- client-generated UUID
  device_id TEXT NOT NULL,
  lamport INTEGER NOT NULL,
  wall_time INTEGER NOT NULL,           -- ms since epoch
  type TEXT NOT NULL,                   -- 'sale', 'return', 'credit_apply', etc.
  payload BLOB NOT NULL,                -- JSON
  synced_at INTEGER,                    -- null = pending, set = server acked
  sync_status TEXT,                     -- 'applied' | 'conflict' | 'duplicate' | null
  conflict_data BLOB                    -- JSON, set when sync_status='conflict'
);

CREATE INDEX events_pending ON events (synced_at) WHERE synced_at IS NULL;
```

Plus `local_state` tables — denormalized cache for fast register reads (inventory, customers, prices). Local state is **rebuilt** by replaying local events; never directly mutated by user code.

### Sync request

`POST /api/sync` from device to Store Ops:

```json
{
  "deviceId": "tablet-store123-front-counter",
  "lastSyncedLamport": 9824,
  "events": [
    { "id": "evt-uuid-1", "lamport": 9825, "wallTime": 1700000000000, "type": "sale", "payload": {...} },
    { "id": "evt-uuid-2", "lamport": 9826, "wallTime": 1700000005000, "type": "credit_apply", "payload": {...} }
  ]
}
```

### Sync response

```json
{
  "results": [
    { "id": "evt-uuid-1", "status": "applied" },
    { "id": "evt-uuid-2", "status": "conflict", "conflict": { "reason": "balance_negative", "...": "..." } }
  ],
  "newServerEvents": [
    /* events that happened on other devices since the device's last sync, so this device's local state can incorporate them */
  ],
  "serverLamport": 10042
}
```

### Server-side event log

New Prisma model in the `afterroar` monorepo:

```prisma
model RegisterEvent {
  id              String   @id                    // client-generated UUID
  storeId         String
  deviceId        String
  lamport         Int
  wallTime        DateTime
  type            String
  payload         Json
  status          String   @default("applied")    // applied | conflict | duplicate
  conflictData    Json?
  receivedAt      DateTime @default(now())

  @@unique([deviceId, id])                         // idempotency
  @@index([storeId, wallTime(sort: Desc)])
  @@index([storeId, status])
  @@index([storeId, deviceId, lamport])
}
```

## Recovery flow — the rock-solid self-heal

When a register reconnects after any duration of disconnection:

1. **Push local pending events** to `/api/sync`. Server applies in Lamport order, returns per-event status.
2. **Pull server-since-last-sync events** in same response. Device applies them locally, rebuilds local denormalized state.
3. **If any events came back as `conflict`**: device shows a sit-rep banner ("3 sales from this morning need owner review") with link to admin reconciliation page. **The cashier is never blocked from continuing to ring up new sales.** Reconciliation is owner work, not cashier work.
4. **Owner reviews reconciliation queue at convenience**, makes decisions, queue clears. Audit trail of every decision permanent.

## What this protects against

- **Single register offline for hours** — pushes its log when reconnected, mostly auto-applies.
- **Multiple registers offline simultaneously** — independent event logs, server orders by Lamport, conflicts surface for the genuinely ambiguous cases.
- **Connection flapping during sync** — idempotency keys mean retries are safe, no double-applies.
- **Server outage during sync** — device retries with exponential backoff, never loses data.
- **Catastrophic server data loss** — every device's event log is a partial backup. Register events can be replayed from device logs to reconstruct server state.
- **Cross-store conflicts at conventions** — multiple stores' events sync independently to their own ledgers; no cross-store mutation possible (each store's events affect only that store's data).

## Anti-patterns explicitly rejected

- ❌ "Last write wins" globally — too much data loss for fields like credit balance.
- ❌ "Server is source of truth, devices read-only" — defeats the offline goal entirely.
- ❌ "Lock the inventory item before sale" — only works online; useless for the use case.
- ❌ "Just sync the diff" (state-based) — can't handle multi-way merges, complexity grows quadratically with device count.
- ❌ "Auto-resolve everything; owners shouldn't be bothered" — silent corruption is worse than visible conflict. Surface, don't bury.

## When to consider PowerSync or similar

Hand-rolled sync is fine for v1 because:
- We control both ends (device + server)
- Domain is small enough (~20 event types)
- Conflict rules are domain-specific (PowerSync's generic rules wouldn't cover them better)

If we hit complexity walls — primarily: managing local-state rebuild logic at scale — **PowerSync** (https://powersync.com) is built for SQLite ↔ Postgres bidirectional replication with rule-based conflict resolution. Good escape hatch.

But: don't adopt it preemptively. The first register fleet is going to teach us things our v1 sync can absorb iteratively.

## Audit + observability

- Every `reconciliation_decision` row is permanent. Never deleted, only marked-superseded.
- `/admin/reconciliation` page shows queue + history (filter: pending, last 7d, last 30d).
- Sync metrics emit to Sentry: events-per-sync (volume), conflict-rate (%), avg latency (ms), oldest-pending-event (s).
- Per-device dashboard: when did device X last sync, how many events pending, conflict rate. Detect a stuck device before the owner does.

## Open questions for R2 implementation

- **Stripe Terminal SDK + idempotency keys**: does Stripe's SDK accept our client-generated transaction ID, or does it generate its own? We need our ID flow through so the deferred-capture result (state C) can be correlated.
- **Local SQLite encryption**: card data shouldn't sit in cleartext SQLite, even briefly. Stripe Terminal's offline-payments feature handles its own encryption — verify what touches our SQLite vs theirs.
- **Cross-device sync via WebSocket vs polling**: poll (every 30s when online) is simpler and sufficient for v1. WebSocket-based real-time push to other registers in the same store is a v2 enhancement.
- **Schema migration of events during long offline periods**: if we add a new event type while a register has been offline for 2 weeks, server must handle "unknown event type" gracefully (defer, log, alert).
