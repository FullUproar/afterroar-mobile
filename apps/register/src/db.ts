/**
 * Local SQLite layer. Stores three things:
 *   - inventory_cache: snapshot of pos_inventory_items pulled at sync time.
 *     Used for the product picker. Read-only at the cashier — write-side
 *     decrements happen via events that sync to the server, NOT here.
 *   - staff_cache: snapshot of pos_staff (id, name, role, pin_hash).
 *     Used for offline PIN auth.
 *   - events: append-only event log. Each row is a register event;
 *     `status` reflects sync outcome. Pending events get pushed by the
 *     sync loop.
 *
 * On web (vite dev), Capacitor SQLite isn't available. Uses an in-memory
 * stub that mimics the same API. Native Android uses the real plugin.
 */

import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import type { InventoryItem, Staff, RegisterEvent, CashSalePayload, EventStatus } from "./types";

const DB_NAME = "register";
const DB_VERSION = 1;

let dbReady: Promise<SQLiteDBConnection | null> | null = null;
const memDb = {
  inventory: new Map<string, InventoryItem>(),
  staff: new Map<string, Staff>(),
  events: [] as RegisterEvent[],
  meta: new Map<string, string>(),
};

function isNative() {
  return Capacitor.isNativePlatform();
}

async function openNative(): Promise<SQLiteDBConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const consistent = (await sqlite.checkConnectionsConsistency()).result ?? false;
  const isConn = (await sqlite.isConnection(DB_NAME, false)).result ?? false;
  let db: SQLiteDBConnection;
  if (consistent && isConn) {
    db = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    db = await sqlite.createConnection(DB_NAME, false, "no-encryption", DB_VERSION, false);
  }
  await db.open();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS inventory_cache (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      sku TEXT,
      category TEXT,
      synced_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_cache (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin_hash TEXT,
      synced_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      lamport INTEGER NOT NULL,
      wall_time INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      conflict_data TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_pending ON events(status, lamport);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

async function ensureDb(): Promise<SQLiteDBConnection | null> {
  if (!isNative()) return null;
  if (!dbReady) dbReady = openNative();
  return dbReady;
}

/* ------------------------------------------------------------------ */
/*  Meta KV (deviceId, lamport counter, last-sync timestamp)           */
/* ------------------------------------------------------------------ */

export async function metaGet(key: string): Promise<string | null> {
  const db = await ensureDb();
  if (!db) return memDb.meta.get(key) ?? null;
  const r = await db.query(`SELECT value FROM meta WHERE key = ?`, [key]);
  return (r.values?.[0] as { value?: string } | undefined)?.value ?? null;
}

export async function metaSet(key: string, value: string): Promise<void> {
  const db = await ensureDb();
  if (!db) {
    memDb.meta.set(key, value);
    return;
  }
  await db.run(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
}

/* ------------------------------------------------------------------ */
/*  Inventory cache                                                     */
/* ------------------------------------------------------------------ */

export async function replaceInventory(items: InventoryItem[]): Promise<void> {
  const now = Date.now();
  const db = await ensureDb();
  if (!db) {
    memDb.inventory.clear();
    items.forEach((i) => memDb.inventory.set(i.id, i));
    return;
  }
  await db.execute(`DELETE FROM inventory_cache`);
  for (const i of items) {
    await db.run(
      `INSERT INTO inventory_cache (id, name, price_cents, quantity, sku, category, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [i.id, i.name, i.priceCents, i.quantity, i.sku ?? null, i.category ?? null, now],
    );
  }
}

export async function listInventory(): Promise<InventoryItem[]> {
  const db = await ensureDb();
  if (!db) return Array.from(memDb.inventory.values()).sort((a, b) => a.name.localeCompare(b.name));
  const r = await db.query(`SELECT id, name, price_cents AS priceCents, quantity, sku, category FROM inventory_cache ORDER BY name ASC`);
  return (r.values ?? []) as InventoryItem[];
}

/* ------------------------------------------------------------------ */
/*  Staff cache                                                         */
/* ------------------------------------------------------------------ */

export async function replaceStaff(staff: Staff[]): Promise<void> {
  const now = Date.now();
  const db = await ensureDb();
  if (!db) {
    memDb.staff.clear();
    staff.forEach((s) => memDb.staff.set(s.id, s));
    return;
  }
  await db.execute(`DELETE FROM staff_cache`);
  for (const s of staff) {
    await db.run(
      `INSERT INTO staff_cache (id, name, role, pin_hash, synced_at) VALUES (?, ?, ?, ?, ?)`,
      [s.id, s.name, s.role, s.pinHash, now],
    );
  }
}

export async function listStaff(): Promise<Staff[]> {
  const db = await ensureDb();
  if (!db) return Array.from(memDb.staff.values());
  const r = await db.query(`SELECT id, name, role, pin_hash AS pinHash FROM staff_cache`);
  return (r.values ?? []) as Staff[];
}

/* ------------------------------------------------------------------ */
/*  Event log                                                           */
/* ------------------------------------------------------------------ */

export async function appendEvent(evt: Omit<RegisterEvent, "status"> & { status?: EventStatus }): Promise<void> {
  const status: EventStatus = evt.status ?? "pending";
  const db = await ensureDb();
  if (!db) {
    memDb.events.push({ ...evt, status });
    return;
  }
  await db.run(
    `INSERT INTO events (id, lamport, wall_time, type, payload, status, conflict_data, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evt.id,
      evt.lamport,
      evt.wallTime,
      evt.type,
      JSON.stringify(evt.payload),
      status,
      evt.conflictData ? JSON.stringify(evt.conflictData) : null,
      evt.errorMessage ?? null,
      Date.now(),
    ],
  );
}

export async function listPendingEvents(): Promise<RegisterEvent[]> {
  const db = await ensureDb();
  if (!db) return memDb.events.filter((e) => e.status === "pending");
  const r = await db.query(`SELECT * FROM events WHERE status = 'pending' ORDER BY lamport ASC`);
  return (r.values ?? []).map(rowToEvent);
}

export async function listAllEvents(limit = 50): Promise<RegisterEvent[]> {
  const db = await ensureDb();
  if (!db) {
    return [...memDb.events].sort((a, b) => b.lamport - a.lamport).slice(0, limit);
  }
  const r = await db.query(`SELECT * FROM events ORDER BY lamport DESC LIMIT ?`, [limit]);
  return (r.values ?? []).map(rowToEvent);
}

export async function updateEventStatus(
  id: string,
  status: EventStatus,
  extras?: { conflictData?: unknown; errorMessage?: string },
): Promise<void> {
  const db = await ensureDb();
  if (!db) {
    const evt = memDb.events.find((e) => e.id === id);
    if (evt) {
      evt.status = status;
      if (extras?.conflictData !== undefined) evt.conflictData = extras.conflictData;
      if (extras?.errorMessage !== undefined) evt.errorMessage = extras.errorMessage;
    }
    return;
  }
  await db.run(
    `UPDATE events SET status = ?, conflict_data = ?, error_message = ? WHERE id = ?`,
    [
      status,
      extras?.conflictData ? JSON.stringify(extras.conflictData) : null,
      extras?.errorMessage ?? null,
      id,
    ],
  );
}

interface EventRow {
  id: string;
  lamport: number;
  wall_time: number;
  type: string;
  payload: string;
  status: string;
  conflict_data: string | null;
  error_message: string | null;
}

function rowToEvent(row: unknown): RegisterEvent {
  const r = row as EventRow;
  return {
    id: r.id,
    lamport: r.lamport,
    wallTime: r.wall_time,
    type: r.type as "cash_sale",
    payload: JSON.parse(r.payload) as CashSalePayload,
    status: r.status as EventStatus,
    conflictData: r.conflict_data ? JSON.parse(r.conflict_data) : undefined,
    errorMessage: r.error_message ?? undefined,
  };
}
