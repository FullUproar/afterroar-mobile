/**
 * Alerting plumbing. Fires when a surface transitions into a down state,
 * and again when it recovers. Hysteresis: requires N consecutive failures
 * before firing (so a single transient flap doesn't wake you up).
 *
 * On native (Capacitor): uses LocalNotifications + Haptics.
 * In a browser: uses the Notifications API + vibrate (best effort).
 */

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { ProbeStatus } from "./probe";
import type { Surface } from "./surfaces";

export const FAILURES_BEFORE_ALERT = 2; // 2 consecutive failures (~120s at 60s poll) = alert

let nextNotificationId = 1;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  }
  const status = await LocalNotifications.checkPermissions();
  if (status.display === "granted") return true;
  const req = await LocalNotifications.requestPermissions();
  return req.display === "granted";
}

async function vibratePattern() {
  if (Capacitor.isNativePlatform()) {
    // Three sharp pulses — distinct from a normal notification buzz.
    await Haptics.impact({ style: ImpactStyle.Heavy });
    await new Promise((r) => setTimeout(r, 200));
    await Haptics.impact({ style: ImpactStyle.Heavy });
    await new Promise((r) => setTimeout(r, 200));
    await Haptics.impact({ style: ImpactStyle.Heavy });
    return;
  }
  if ("vibrate" in navigator) {
    navigator.vibrate([200, 100, 200, 100, 200]);
  }
}

export async function fireAlert(surface: Surface, status: ProbeStatus, kind: "down" | "recovered") {
  const title = kind === "down" ? `🔻 ${surface.name} is down` : `✓ ${surface.name} recovered`;
  const body =
    kind === "down"
      ? `Status: ${status}. Tap to investigate.`
      : `Back to healthy.`;

  if (Capacitor.isNativePlatform()) {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: nextNotificationId++,
          title,
          body,
          smallIcon: "ic_stat_garmr",
          extra: { surfaceUrl: surface.visitUrl },
        },
      ],
    });
    if (kind === "down") await vibratePattern();
    return;
  }

  // Browser fallback
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
  }
  if (kind === "down") await vibratePattern();
}
