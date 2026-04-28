/**
 * Register R2 — top-level app state machine.
 *
 *   Setup → Login → Home (with Settings reachable from Home)
 *
 * Mode (online / ops-down / offline) is detected on a 30s interval and
 * also on online/offline browser events. The sync loop runs continuously
 * once setup is complete, pushing pending events whenever connectivity
 * permits.
 */

import { useEffect, useRef, useState } from "react";
import { Network } from "@capacitor/network";
import { getServerConfig, getDeviceId } from "./device";
import { detectMode } from "./api";
import { startSyncLoop, refreshPendingCount } from "./sync";
import { Setup } from "./screens/Setup";
import { Login } from "./screens/Login";
import { Home } from "./screens/Home";
import { Settings } from "./screens/Settings";
import { Screen, H1 } from "./ui";
import type { ServerConfig, Staff, ConnectionMode } from "./types";

type View = "loading" | "setup" | "login" | "home" | "settings";

const MODE_POLL_MS = 30_000;

export function App() {
  const [view, setView] = useState<View>("loading");
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("offline");
  const cfgRef = useRef<ServerConfig | null>(null);
  cfgRef.current = cfg;

  // Boot — load config, decide what screen to show
  useEffect(() => {
    void (async () => {
      // Make sure device ID exists before anything else
      await getDeviceId();
      const stored = await getServerConfig();
      setCfg(stored);
      setView(stored ? "login" : "setup");
      // Initial mode probe
      void detectMode(stored).then(setMode);
      // Pending event count for the badge
      void refreshPendingCount();
    })();
  }, []);

  // Mode polling — every 30s, and on network state changes
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const m = await detectMode(cfgRef.current);
      if (!cancelled) setMode(m);
    };
    void poll();
    const id = setInterval(poll, MODE_POLL_MS);
    const handle = Network.addListener("networkStatusChange", () => void poll());

    return () => {
      cancelled = true;
      clearInterval(id);
      void handle.then((h) => h.remove());
    };
  }, []);

  // Sync loop starts as soon as we have a config
  useEffect(() => {
    if (!cfg) return;
    startSyncLoop(() => cfgRef.current);
  }, [cfg]);

  if (view === "loading") {
    return (
      <Screen>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <H1>…</H1>
        </div>
      </Screen>
    );
  }

  if (view === "setup" || !cfg) {
    return (
      <Setup
        onDone={async () => {
          const stored = await getServerConfig();
          setCfg(stored);
          setView("login");
          void detectMode(stored).then(setMode);
        }}
      />
    );
  }

  if (view === "login" || !staff) {
    return (
      <Login
        onSignedIn={(s) => {
          setStaff(s);
          setView("home");
        }}
      />
    );
  }

  if (view === "settings") {
    return (
      <Settings
        cfg={cfg}
        mode={mode}
        onBack={() => setView("home")}
        onResetDevice={() => {
          setCfg(null);
          setStaff(null);
          setView("setup");
        }}
        onCfgChanged={async () => {
          const fresh = await getServerConfig();
          if (fresh) setCfg(fresh);
          void detectMode(fresh).then(setMode);
        }}
      />
    );
  }

  return (
    <>
      <ModeBanner mode={mode} />
      <Home
        staff={staff}
        cfg={cfg}
        mode={mode}
        onSignOut={() => {
          setStaff(null);
          setView("login");
        }}
        onSettings={() => setView("settings")}
      />
    </>
  );
}

/** Sticky banner at the very top of Home when we're not in 'online' mode. */
function ModeBanner({ mode }: { mode: ConnectionMode }) {
  if (mode === "online") return null;
  const isOffline = mode === "offline";
  const bg = isOffline ? "rgba(239, 68, 68, 0.15)" : "rgba(251, 191, 36, 0.15)";
  const fg = isOffline ? "#ef4444" : "#fbbf24";
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: bg,
        borderBottom: `1px solid ${fg}40`,
        padding: "0.5rem 1rem",
        textAlign: "center",
        color: fg,
        fontWeight: 800,
        fontSize: "0.85rem",
        letterSpacing: "0.04em",
      }}
    >
      {isOffline
        ? "● OFFLINE — sales queue locally and sync when service returns"
        : "● STORE OPS UNREACHABLE — sales queue locally; sync queued"}
    </div>
  );
}
