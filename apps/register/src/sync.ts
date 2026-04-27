/**
 * Sync loop. Pushes pending events to /api/sync when connectivity allows.
 * Updates each event's local status based on server response.
 *
 * Triggered by:
 *   - App foreground / startup
 *   - Network 'online' event
 *   - Periodic timer (every SYNC_INTERVAL_MS)
 *   - Manual button
 *
 * Rules:
 *   - Only push when in 'online' or 'ops-down' mode (not 'offline').
 *     'ops-down' means we have internet but Store Ops is unreachable;
 *     fetch will fail fast, no harm trying.
 *   - Push pending events in batches (sorted by lamport).
 *   - Update status per event based on response.
 *   - On network failure, leave events as 'pending' for next attempt.
 */

import { listPendingEvents, updateEventStatus } from "./db";
import { detectMode, pushEvents } from "./api";
import type { ServerConfig } from "./types";

const SYNC_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;

let intervalId: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export type SyncListener = (snapshot: SyncSnapshot) => void;

export interface SyncSnapshot {
  pendingCount: number;
  lastSyncAt: number | null;
  lastSyncResult: "ok" | "partial" | "fail" | null;
  lastError: string | null;
}

const listeners = new Set<SyncListener>();
const snapshot: SyncSnapshot = {
  pendingCount: 0,
  lastSyncAt: null,
  lastSyncResult: null,
  lastError: null,
};

export function onSyncChange(fn: SyncListener): () => void {
  listeners.add(fn);
  fn(snapshot);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn({ ...snapshot });
}

export async function refreshPendingCount() {
  const pending = await listPendingEvents();
  snapshot.pendingCount = pending.length;
  emit();
}

/**
 * Try once. Returns false if nothing to do or skipped (offline). Returns
 * true if at least one event was sent (regardless of outcome).
 */
export async function syncOnce(cfg: ServerConfig | null): Promise<boolean> {
  if (!cfg || inFlight) return false;
  inFlight = true;
  try {
    const pending = await listPendingEvents();
    snapshot.pendingCount = pending.length;
    if (pending.length === 0) return false;

    const mode = await detectMode(cfg);
    if (mode === "offline") return false;

    const batch = pending.slice(0, BATCH_SIZE);
    let allOk = true;
    let lastErr: string | null = null;

    try {
      const results = await pushEvents(cfg, batch);
      for (const r of results) {
        if (r.status === "applied" || r.status === "duplicate") {
          await updateEventStatus(r.id, "applied");
        } else if (r.status === "conflict") {
          await updateEventStatus(r.id, "conflict", { conflictData: r.conflict });
          allOk = false;
        } else if (r.status === "rejected") {
          await updateEventStatus(r.id, "rejected", { errorMessage: r.error });
          allOk = false;
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "sync failed";
      allOk = false;
      // Leave events as pending — they'll be retried on the next loop tick.
    }

    snapshot.lastSyncAt = Date.now();
    snapshot.lastSyncResult = lastErr ? "fail" : allOk ? "ok" : "partial";
    snapshot.lastError = lastErr;
    await refreshPendingCount();
    return true;
  } finally {
    inFlight = false;
  }
}

export function startSyncLoop(getCfg: () => ServerConfig | null) {
  if (intervalId) return;
  void syncOnce(getCfg());
  intervalId = setInterval(() => void syncOnce(getCfg()), SYNC_INTERVAL_MS);

  // Sync immediately when the network comes back.
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void syncOnce(getCfg()));
  }
}

export function stopSyncLoop() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}
