import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "me.afterroar.register",
  appName: "Afterroar Register",
  webDir: "dist",
  // R2: register is now a real local SPA (no more server.url WebView wrap).
  // The whole point of R2 is offline-capable cashier flows; loading
  // afterroar.store inside the WebView would defeat that. UI runs locally,
  // talks to the server only via /api/sync.
  android: {
    backgroundColor: "#0a0a0a",
  },
  plugins: {
    CapacitorHttp: {
      // fetch() routes through native Android HTTP — bypasses CORS for
      // cross-origin calls to afterroar.store/api/sync.
      enabled: true,
    },
    CapacitorSQLite: {
      androidIsEncryption: false,
      // We don't encrypt the local SQLite for now. Cashier-side card data
      // never lives in our SQLite (Stripe Terminal SDK manages its own
      // encrypted offline cache when we get to R3). What lives in our
      // SQLite is inventory + staff PINs (already hashed) + sale events
      // (no PAN data). Acceptable for v1.
    },
  },
};

export default config;
