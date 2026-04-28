/**
 * Capability gating for register features.
 *
 * The register's three connection modes (online / ops-down / offline) each
 * close different doors. This module is the single place that maps each
 * feature to "is it available right now, and if not, why?". UI components
 * call `capability(mode, name)` and either render normally, or render the
 * button muted with the returned `reason` as a tooltip.
 *
 * Buckets:
 *   - always:        works in A, B, C (purely local — cash sale, view cart)
 *   - phone_internet: works in A, B (phone reaches Stripe / Passport directly)
 *   - ops_reachable:  works in A only (writes to Store Ops; reads need fresh)
 *   - online_at_risk: works in C only when store has opted into capture-at-risk
 *                     (R3 — Stripe Terminal hardware required)
 */
import type { ConnectionMode } from "./types";

export type CapabilityName =
  | "cash_sale"
  | "card_sale"
  | "customer_lookup"
  | "passport_scan"
  | "receipt_email"
  | "receipt_sms"
  | "inventory_adjust"
  | "price_refresh"
  | "barcode_scan"
  | "discount"
  | "manager_override";

type Bucket = "always" | "phone_internet" | "ops_reachable" | "online_at_risk";

const CAPABILITY_BUCKET: Record<CapabilityName, Bucket> = {
  cash_sale: "always",
  discount: "always",
  manager_override: "always", // PIN check is local; the action it gates may not be
  barcode_scan: "always", // ML Kit runs offline once bundled
  card_sale: "phone_internet",
  customer_lookup: "phone_internet",
  passport_scan: "phone_internet", // NFC happens locally, but Passport API verifies
  receipt_email: "phone_internet",
  receipt_sms: "phone_internet",
  inventory_adjust: "ops_reachable",
  price_refresh: "ops_reachable",
};

export interface CapabilityResult {
  available: boolean;
  reason?: string; // user-facing explanation when unavailable
}

export function capability(mode: ConnectionMode, name: CapabilityName): CapabilityResult {
  const bucket = CAPABILITY_BUCKET[name];
  switch (bucket) {
    case "always":
      return { available: true };
    case "phone_internet":
      if (mode === "offline") {
        return { available: false, reason: phoneInternetReason(name) };
      }
      return { available: true };
    case "ops_reachable":
      if (mode !== "online") {
        return { available: false, reason: opsReachableReason(name, mode) };
      }
      return { available: true };
    case "online_at_risk":
      // Reserved for future Stripe Terminal offline mode (R3+)
      return { available: false, reason: "Not available in this version." };
  }
}

function phoneInternetReason(name: CapabilityName): string {
  switch (name) {
    case "card_sale":
      return "Card sales need internet — phone is offline. Cash works.";
    case "customer_lookup":
    case "passport_scan":
      return "Customer lookup needs internet — phone is offline. Ring it as Guest, or reconnect.";
    case "receipt_email":
    case "receipt_sms":
      return "Receipt sending needs internet. Sale will complete; receipts queue and send when reconnected.";
    default:
      return "Needs internet — phone is offline.";
  }
}

function opsReachableReason(name: CapabilityName, mode: ConnectionMode): string {
  const why = mode === "offline" ? "phone is offline" : "Store Ops is unreachable";
  switch (name) {
    case "inventory_adjust":
      return `Inventory edits need Store Ops — ${why}. Will retry when reconnected.`;
    case "price_refresh":
      return `Pricing refresh needs Store Ops — ${why}. Using last cached prices.`;
    default:
      return `Needs Store Ops — ${why}.`;
  }
}
