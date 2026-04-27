/**
 * R1 shell — when the Capacitor app is launched and `server.url` is reachable,
 * the WebView loads the live register at afterroar.store/dashboard/register
 * and this component never renders. This shell is only what users see when
 * `server.url` IS unreachable (e.g. local dev with `cap run android` while
 * offline, or during the brief moment before the WebView has loaded).
 *
 * R2 will replace this with the actual register UI implemented natively.
 * The offline-capable register lives here, not at the live URL.
 */

import { useEffect, useState } from "react";

export function App() {
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Soft auto-reload when the network comes back, in case we're stuck on
    // the shell because the WebView's `server.url` was unreachable at boot.
    const onOnline = () => {
      setRetryCount((n) => n + 1);
      window.location.reload();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        padding: "2rem",
        background:
          "radial-gradient(ellipse at top, rgba(255, 130, 0, 0.15), transparent 60%), #0a0a0a",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "4rem",
          height: "4rem",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #FF8200, #FBDB65)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.5rem",
          fontWeight: 900,
          color: "#0a0a0a",
        }}
      >
        AR
      </div>
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          color: "#FBDB65",
          margin: 0,
        }}
      >
        Afterroar Register
      </h1>
      <p
        style={{
          color: "#9ca3af",
          fontSize: "0.95rem",
          maxWidth: "24rem",
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        Connecting to Store Ops…
      </p>
      <p
        style={{
          color: "#6b7280",
          fontSize: "0.78rem",
          letterSpacing: "0.04em",
          margin: 0,
        }}
      >
        If this screen persists, your device may be offline. R2 will keep the
        register usable in this state.
      </p>
      {retryCount > 0 && (
        <p style={{ color: "#10b981", fontSize: "0.78rem", margin: 0 }}>
          Network detected — retrying…
        </p>
      )}
    </main>
  );
}
