/**
 * Server I/O. All calls authenticated via the device's API key.
 *
 * Fetch is intentionally bare — no SDK wrapper, just typed helpers.
 * R2 demo scope is small enough that a 100-line module is the right
 * amount of abstraction.
 */

import type { InventoryItem, Staff, ServerConfig, RegisterEvent, ConnectionMode, Customer } from "./types";

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

export interface BootstrapResponse {
  store: {
    id: string;
    name: string;
    taxRatePercent: number;
    taxIncludedInPrice: boolean;
    stripePublishableKey: string | null;
    /** Stripe account approved for Tap-to-Pay — when false, the register
     *  goes straight to typed-card entry without attempting NFC discovery. */
    tapToPayApproved: boolean;
  };
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

/* ------------------------------------------------------------------ */
/*  Customer search + create                                           */
/* ------------------------------------------------------------------ */

interface CustomerWire {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  credit_balance_cents: number;
  loyalty_points: number;
}

function customerFromWire(c: CustomerWire): Customer {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    creditBalanceCents: c.credit_balance_cents,
    loyaltyPoints: c.loyalty_points,
  };
}

export async function searchCustomers(cfg: ServerConfig, q: string): Promise<Customer[]> {
  const path = `/api/register/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const res = await api<{ customers: CustomerWire[] }>(cfg, path);
  return res.customers.map(customerFromWire);
}

export async function createCustomer(
  cfg: ServerConfig,
  input: { name: string; email?: string; phone?: string },
): Promise<Customer> {
  const res = await api<{ customer: CustomerWire }>(cfg, "/api/register/customers", {
    method: "POST",
    body: input,
  });
  return customerFromWire(res.customer);
}

/* ------------------------------------------------------------------ */
/*  Card sale — Stripe PaymentIntent                                    */
/* ------------------------------------------------------------------ */

export interface PaymentIntentResponse {
  paymentIntentId: string;
  status: string; // 'succeeded' | 'requires_action' | 'requires_confirmation' | ...
  clientSecret: string | null;
  testMode: boolean;
}

export async function createPaymentIntent(
  cfg: ServerConfig,
  input: { amountCents: number; clientTxId: string; customerId?: string | null },
): Promise<PaymentIntentResponse> {
  return api<PaymentIntentResponse>(cfg, "/api/register/payment-intent", {
    method: "POST",
    body: input,
  });
}

/* ------------------------------------------------------------------ */
/*  Device pairing (no auth — the code IS the auth)                    */
/* ------------------------------------------------------------------ */

export interface PairResponse {
  token: string;       // ardv_... — stored locally as the X-API-Key
  device_id: string;   // server-side RegisterDevice.id (informational)
  store: { id: string; name: string };
}

/** Exchange a 6-digit pairing code for a long-lived device token. */
export async function pairDevice(
  apiBaseUrl: string,
  input: { code: string; deviceId: string; displayName?: string },
): Promise<PairResponse> {
  const res = await fetch(`${apiBaseUrl}/api/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Pair failed (${res.status})`);
  }
  return res.json();
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
