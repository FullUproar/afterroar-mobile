/**
 * Thin wrapper around @capacitor-mlkit/barcode-scanning.
 *
 * The plugin opens a fullscreen camera overlay and returns the first
 * barcode it sees. We request permission lazily on first use.
 *
 * Web fallback: prompts for a manual entry. ML Kit is Android-only in
 * this codebase right now (iOS comes in R3+); on web the scanner
 * doesn't render a camera but the lookup path still works.
 */

import { Capacitor } from "@capacitor/core";
import { BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";

export type ScanResult =
  | { ok: true; code: string; format?: string }
  | { ok: false; reason: "cancelled" | "denied" | "unsupported" | "error"; message?: string };

export async function scanOnce(): Promise<ScanResult> {
  if (!Capacitor.isNativePlatform()) {
    const code = window.prompt("Scan unavailable on web — enter barcode/SKU manually:");
    if (!code) return { ok: false, reason: "cancelled" };
    return { ok: true, code: code.trim() };
  }

  // Permission gate
  try {
    const { camera } = await BarcodeScanner.checkPermissions();
    if (camera !== "granted") {
      const req = await BarcodeScanner.requestPermissions();
      if (req.camera !== "granted") {
        return { ok: false, reason: "denied", message: "Camera permission denied." };
      }
    }
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
  }

  // Module support check (Google Play Services barcode module installs lazily on Android)
  try {
    const supported = await BarcodeScanner.isSupported();
    if (!supported.supported) {
      return { ok: false, reason: "unsupported", message: "Device doesn't support barcode scanning." };
    }
  } catch {
    /* fallthrough */
  }

  // Scan
  try {
    const { barcodes } = await BarcodeScanner.scan();
    const first = barcodes?.[0];
    if (!first) return { ok: false, reason: "cancelled" };
    return { ok: true, code: first.rawValue ?? first.displayValue ?? "", format: String(first.format) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(msg)) return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "error", message: msg };
  }
}
