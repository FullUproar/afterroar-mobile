import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "me.afterroar.garmr",
  appName: "Garmr",
  webDir: "dist",
  // No `server.url` — Garmr runs entirely as a local SPA. Polling logic
  // executes on-device against remote URLs; this is the whole point of
  // the watchdog being independent of the cloud infrastructure it monitors.
  android: {
    backgroundColor: "#0a0a0a",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_garmr",
      iconColor: "#FF8200",
      sound: "alert.wav",
    },
    // Route all `fetch()` calls through Android's native HTTP stack instead
    // of the WebView. Bypasses CORS — the health endpoints don't (and
    // shouldn't need to) advertise CORS headers since they're meant for
    // server-side monitoring tools.
    //
    // Without this: requests appear to complete (response arrives in
    // ≤1s) but JS sees "Failed to fetch" because the WebView blocks
    // reading the cross-origin response.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
