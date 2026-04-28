/**
 * Device-level state: deviceId (stable per tablet), Lamport counter,
 * server config (API key, store ID, base URL).
 *
 * Stored in two places:
 *   - SQLite `meta` (durable across reinstalls IF SQLite survives — it
 *     does on Android unless user clears app data)
 *   - Capacitor Preferences (additional safety net)
 *
 * deviceId is generated once and never changes. Wiping the device wipes
 * its identity; that's the desired model — a fresh tablet is a new
 * device with a fresh sync state.
 */

import { Preferences } from "@capacitor/preferences";
import { metaGet, metaSet } from "./db";
import type { ServerConfig } from "./types";

const PREFS_DEVICE_ID = "device_id";
const META_DEVICE_ID = "device_id";
const META_LAMPORT = "lamport_counter";
const META_API_KEY = "api_key";
const META_STORE_ID = "store_id";
const META_API_BASE = "api_base_url";
const META_TAX_RATE_PERCENT = "tax_rate_percent";
const META_TAX_INCLUDED = "tax_included_in_price";
const META_STRIPE_PK = "stripe_publishable_key";
const META_TTP_APPROVED = "tap_to_pay_approved";

const DEFAULT_API_BASE = "https://www.afterroar.store";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for old WebViews
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  // Prefer SQLite source-of-truth if present
  const fromMeta = await metaGet(META_DEVICE_ID);
  if (fromMeta) {
    await Preferences.set({ key: PREFS_DEVICE_ID, value: fromMeta });
    return fromMeta;
  }
  // Fallback: read from Preferences (in case SQLite was wiped but Prefs survived)
  const fromPrefs = await Preferences.get({ key: PREFS_DEVICE_ID });
  if (fromPrefs.value) {
    await metaSet(META_DEVICE_ID, fromPrefs.value);
    return fromPrefs.value;
  }
  // First boot — generate and store
  const fresh = generateUuid();
  await metaSet(META_DEVICE_ID, fresh);
  await Preferences.set({ key: PREFS_DEVICE_ID, value: fresh });
  return fresh;
}

/** Atomically increment + return next Lamport count. */
export async function nextLamport(): Promise<number> {
  const current = parseInt((await metaGet(META_LAMPORT)) ?? "0", 10);
  const next = current + 1;
  await metaSet(META_LAMPORT, String(next));
  return next;
}

/** Used when receiving server events that have higher Lamport counts —
 *  bump our counter forward to keep causality. (Not used in Stage 5
 *  one-way push, but ready for future bidirectional sync.) */
export async function maybeBumpLamport(remote: number): Promise<void> {
  const current = parseInt((await metaGet(META_LAMPORT)) ?? "0", 10);
  if (remote > current) await metaSet(META_LAMPORT, String(remote));
}

/* ------------------------------------------------------------------ */
/*  Server config (API key + store ID + base URL)                       */
/* ------------------------------------------------------------------ */

export async function getServerConfig(): Promise<ServerConfig | null> {
  const [apiKey, storeId, apiBaseUrl, deviceId] = await Promise.all([
    metaGet(META_API_KEY),
    metaGet(META_STORE_ID),
    metaGet(META_API_BASE),
    getDeviceId(),
  ]);
  if (!apiKey || !storeId) return null;
  return {
    apiKey,
    storeId,
    apiBaseUrl: apiBaseUrl ?? DEFAULT_API_BASE,
    deviceId,
  };
}

export async function setServerConfig(cfg: { apiKey: string; storeId: string; apiBaseUrl?: string }): Promise<void> {
  await metaSet(META_API_KEY, cfg.apiKey);
  await metaSet(META_STORE_ID, cfg.storeId);
  await metaSet(META_API_BASE, cfg.apiBaseUrl ?? DEFAULT_API_BASE);
}

export async function clearServerConfig(): Promise<void> {
  await metaSet(META_API_KEY, "");
  await metaSet(META_STORE_ID, "");
}

/** Override or restore the API base URL. Used by the "Simulate ops down" demo
 *  toggle: passing the SIM_OPS_DOWN_URL forces health probes to fail without
 *  taking the phone off the network, which is what state B looks like. */
export const SIM_OPS_DOWN_URL = "https://ops-down.example.invalid";

export async function setApiBaseUrl(url: string): Promise<void> {
  await metaSet(META_API_BASE, url);
}

export async function getApiBaseUrl(): Promise<string> {
  return (await metaGet(META_API_BASE)) ?? DEFAULT_API_BASE;
}

export { DEFAULT_API_BASE };

/* ------------------------------------------------------------------ */
/*  Store tax settings (refreshed on each bootstrap)                    */
/* ------------------------------------------------------------------ */

export interface TaxSettings {
  ratePercent: number;       // e.g. 8.25 for 8.25%
  includedInPrice: boolean;  // when true, no separate tax line
}

export async function setTaxSettings(s: TaxSettings): Promise<void> {
  await metaSet(META_TAX_RATE_PERCENT, String(s.ratePercent));
  await metaSet(META_TAX_INCLUDED, s.includedInPrice ? "1" : "0");
}

export async function getTaxSettings(): Promise<TaxSettings> {
  const [rateStr, incStr] = await Promise.all([
    metaGet(META_TAX_RATE_PERCENT),
    metaGet(META_TAX_INCLUDED),
  ]);
  return {
    ratePercent: rateStr ? parseFloat(rateStr) || 0 : 0,
    includedInPrice: incStr === "1",
  };
}

export async function setStripePublishableKey(key: string | null): Promise<void> {
  await metaSet(META_STRIPE_PK, key ?? "");
}

export async function getStripePublishableKey(): Promise<string | null> {
  const v = await metaGet(META_STRIPE_PK);
  return v ? v : null;
}

export async function setTapToPayApproved(approved: boolean): Promise<void> {
  await metaSet(META_TTP_APPROVED, approved ? "1" : "0");
}

export async function getTapToPayApproved(): Promise<boolean> {
  return (await metaGet(META_TTP_APPROVED)) === "1";
}
