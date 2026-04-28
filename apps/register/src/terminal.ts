/**
 * Stripe Terminal SDK wrapper for Tap-to-Pay-on-Android.
 *
 * The plugin's surface is event-heavy — it fires `requestConnectionToken`
 * whenever the SDK needs a fresh token, plus reader/payment-status events
 * during the flow. We hide that complexity behind three calls:
 *
 *   ensureTerminal(cfg)    — initialize once, idempotent. Returns whether
 *                            Tap-to-Pay actually works on this device.
 *   collectViaTapToPay(pi) — opens the system NFC overlay, waits for tap,
 *                            confirms the PaymentIntent.
 *   resetTerminal()        — disconnects (e.g. on sign-out).
 *
 * Failure modes:
 *   - Plugin not available (e.g. running on web/dev) → ensureTerminal returns
 *     { available: false, reason: 'unsupported' }. UI falls back to Elements.
 *   - Stripe account not approved for TTPA → discoverReaders returns 0
 *     readers → { available: false, reason: 'not_approved' }.
 *   - Device doesn't support TTPA (older Android, missing NFC, no GPS)
 *     → discoverReaders raises → { available: false, reason: 'unsupported' }.
 *
 * For all of these, the register seamlessly falls back to typed-card entry
 * via Stripe Elements. The cashier never sees a hard error.
 */

import { Capacitor } from "@capacitor/core";
import {
  StripeTerminal,
  TerminalConnectTypes,
  TerminalEventsEnum,
} from "@capacitor-community/stripe-terminal";
import type { ServerConfig } from "./types";

export type TerminalAvailability =
  | { available: true }
  | {
      available: false;
      reason: "unsupported" | "not_approved" | "no_permission" | "error";
      message?: string;
    };

let initState: "uninitialized" | "initializing" | "ready" | "failed" = "uninitialized";
let availability: TerminalAvailability = { available: false, reason: "unsupported" };
let activeCfg: ServerConfig | null = null;

async function fetchConnectionToken(cfg: ServerConfig): Promise<string> {
  const res = await fetch(`${cfg.apiBaseUrl}/api/register/connection-token`, {
    method: "POST",
    headers: { "X-API-Key": cfg.apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`connection-token failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { secret?: string };
  if (!data.secret) throw new Error("connection-token response missing secret");
  return data.secret;
}

export async function ensureTerminal(
  cfg: ServerConfig,
  isTestMode: boolean,
): Promise<TerminalAvailability> {
  if (initState === "ready") return availability;
  if (initState === "initializing") {
    // wait for in-flight init
    while (initState === "initializing") await new Promise((r) => setTimeout(r, 50));
    return availability;
  }
  if (!Capacitor.isNativePlatform()) {
    availability = { available: false, reason: "unsupported", message: "Native only" };
    initState = "failed";
    return availability;
  }

  initState = "initializing";
  activeCfg = cfg;

  try {
    // Wire the request-token listener before initialize() — the SDK calls it
    // on its own schedule (fresh token every ~3 min while connected).
    await StripeTerminal.addListener(TerminalEventsEnum.RequestedConnectionToken, async () => {
      if (!activeCfg) return;
      try {
        const tok = await fetchConnectionToken(activeCfg);
        await StripeTerminal.setConnectionToken({ token: tok });
      } catch (err) {
        console.error("[terminal] failed to refresh connection token:", err);
      }
    });

    // Provide an initial token before initialize() so the SDK has something to use.
    const initialToken = await fetchConnectionToken(cfg);
    await StripeTerminal.setConnectionToken({ token: initialToken });

    await StripeTerminal.initialize({ isTest: isTestMode });

    // Discover Tap-to-Pay reader (this device, acting as a reader). If
    // Stripe hasn't approved the account for TTPA the array will be empty.
    const { readers } = await StripeTerminal.discoverReaders({
      type: TerminalConnectTypes.TapToPay,
    });
    if (!readers || readers.length === 0) {
      availability = {
        available: false,
        reason: "not_approved",
        message:
          "Tap-to-Pay isn't enabled for this Stripe account yet. Apply at dashboard.stripe.com/terminal/locations.",
      };
      initState = "failed";
      return availability;
    }

    // Connect to the discovered reader (the phone itself).
    await StripeTerminal.connectReader({ reader: readers[0] });

    availability = { available: true };
    initState = "ready";
    return availability;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Some error messages are recognizable signals worth surfacing differently.
    let reason: "unsupported" | "not_approved" | "no_permission" | "error" = "error";
    if (/permission/i.test(msg)) reason = "no_permission";
    else if (/not.*supported|unsupported/i.test(msg)) reason = "unsupported";
    else if (/approv|capability/i.test(msg)) reason = "not_approved";
    availability = { available: false, reason, message: msg };
    initState = "failed";
    return availability;
  }
}

/** Re-attempt initialization. Useful after the user grants permission or
 *  the merchant gets approved. */
export function resetTerminalInitState(): void {
  initState = "uninitialized";
  availability = { available: false, reason: "unsupported" };
}

/** Collect a payment via NFC tap and confirm the PaymentIntent.
 *  Throws if not initialized or the tap fails. */
export async function collectViaTapToPay(paymentIntent: string): Promise<void> {
  if (initState !== "ready") {
    throw new Error("Terminal SDK not ready. Call ensureTerminal first.");
  }
  await StripeTerminal.collectPaymentMethod({ paymentIntent });
  await StripeTerminal.confirmPaymentIntent();
}

export async function disconnectTerminal(): Promise<void> {
  if (initState !== "ready") return;
  try {
    await StripeTerminal.disconnectReader();
  } catch {
    /* swallow — disconnect is best-effort */
  }
  resetTerminalInitState();
}
