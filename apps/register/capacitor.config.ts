import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "me.afterroar.register",
  appName: "Afterroar Register",
  webDir: "dist",
  // R1: WebView loads the deployed web register directly. Local React app is
  // a thin shell that only takes over for offline detection and (later)
  // native bridges.
  //
  // R2 will:
  //   - Remove `server.url` so the app loads its own bundled SPA
  //   - Move register UI code into apps/register/src instead of pointing
  //     at the live URL
  //   - Add @capacitor-community/sqlite for the local event log
  //   - Add @capacitor-community/stripe-terminal for native card capture
  server: {
    url: "https://www.afterroar.store/dashboard/register",
    androidScheme: "https",
    // Allow navigation to OAuth providers and Stripe, otherwise WebView
    // refuses to leave the original origin during sign-in flows.
    allowNavigation: [
      "*.afterroar.store",
      "*.afterroar.me",
      "*.fulluproar.com",
      "accounts.google.com",
      "*.stripe.com",
    ],
  },
  android: {
    // Lock to portrait — register is a counter/tablet app, not a landscape
    // media app. Setting this here means we don't have to wrestle with it
    // in AndroidManifest later.
    backgroundColor: "#0a0a0a",
  },
  plugins: {
    // Route fetch() through native HTTP (bypasses CORS for cross-origin
    // calls from R2 sync logic to afterroar.store / afterroar.me).
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
