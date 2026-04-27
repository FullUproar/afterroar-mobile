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
  },
};

export default config;
