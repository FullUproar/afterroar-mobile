/**
 * Server I/O. All calls authenticated via the device's API key.
 *
 * Fetch is intentionally bare — no SDK wrapper, just typed helpers.
 * R2 demo scope is small enough that a 100-line module is the right
 * amount of abstraction.
 */

import type { InventoryItem, Staff, ServerConfig, RegisterEvent, ConnectionMode } from "./types";

interface FetchOpts {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

async function api<T>(cfg: ServerConfig, path: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetch(`${cfg.apiBaseUrl}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "X-API-Key": cfg.apiKey,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path} — ${text.slice(0, 200)}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  State detection — A (online) / B (ops down) / C (offline)          */
/* ------------------------------------------------------------------ */

export async function detectMode(cfg: ServerConfig | null): Promise<ConnectionMode> {
  // No internet at all → state C
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  // No API key configured → can't tell, treat as offline
  if (!cfg) return "offline";

  // Probe Store Ops health endpoint with a short timeout
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${cfg.apiBaseUrl}/api/health`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.ok) return "online";
    // Got a response but unhealthy → ops is degraded but we can reach it
    if (res.status === 503) return "ops-down";
    return "ops-down";
  } catch {
    // Couldn't reach Store Ops at all. We have internet (navigator.onLine
    // was true) but the server is unreachable — state B.
    return "ops-down";
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ */
/*  Bootstrap fetch — used during initial "set up this register" flow   */
/* ------------------------------------------------------------------ */

interface BootstrapResponse {
  store: { id: string; name: string };
  inventory: InventoryItem[];
  staff: Staff[];
}

/** Pull inventory + staff snapshot from the server. */
export async function fetchBootstrap(cfg: ServerConfig): Promise<BootstrapResponse> {
  return api<BootstrapResponse>(cfg, "/api/register-bootstrap");
}

/* ------------------------------------------------------------------ */
/*  Sync — push pending events                                         */
/* ------------------------------------------------------------------ */

export interface SyncResult {
  id: string;
  status: "applied" | "conflict" | "duplicate" | "rejected";
  conflict?: unknown;
  error?: string;
}

export async function pushEvents(cfg: ServerConfig, events: RegisterEvent[]): Promise<SyncResult[]> {
  const body = {
    deviceId: cfg.deviceId,
    storeId: cfg.storeId,
    events: events.map((e) => ({
      id: e.id,
      lamport: e.lamport,
      wallTime: new Date(e.wallTime).toISOString(),
      type: e.type,
      payload: e.payload,
    })),
  };
  const res = await api<{ results: SyncResult[] }>(cfg, "/api/sync", { method: "POST", body });
  return res.results;
}
