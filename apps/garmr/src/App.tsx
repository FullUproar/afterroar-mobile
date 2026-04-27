/**
 * Garmr — phone-native watchdog for the Afterroar/Full Uproar platform.
 *
 * Polls the 4 surfaces every POLL_INTERVAL_MS. Tracks consecutive-failure
 * counters per surface; fires a local notification + haptic buzz on the
 * Nth failure, and a recovery notification when the surface comes back.
 *
 * The whole point: this runs on YOUR phone, not in the cloud. Independent
 * failure domain from anything it's monitoring. Even total platform-side
 * outage produces an alert because the alert logic is on-device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SURFACES, type Surface } from "./surfaces";
import { aggregateStatus, isDown, probeAll, type ProbeResult, type ProbeStatus } from "./probe";
import { ensureNotificationPermission, fireAlert, FAILURES_BEFORE_ALERT } from "./alert";

const POLL_INTERVAL_MS = 60_000;

const STATUS_COLORS: Record<ProbeStatus, { fg: string; bg: string; label: string }> = {
  healthy:     { fg: "#10b981", bg: "rgba(16, 185, 129, 0.12)",  label: "Healthy" },
  slow:        { fg: "#fbbf24", bg: "rgba(251, 191, 36, 0.12)",  label: "Slow" },
  degraded:    { fg: "#fbbf24", bg: "rgba(251, 191, 36, 0.12)",  label: "Degraded" },
  unhealthy:   { fg: "#ef4444", bg: "rgba(239, 68, 68, 0.12)",   label: "Unhealthy" },
  unreachable: { fg: "#ef4444", bg: "rgba(239, 68, 68, 0.12)",   label: "Unreachable" },
};

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function App() {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [polling, setPolling] = useState(false);
  const [permGranted, setPermGranted] = useState<boolean | null>(null);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);

  // Per-surface consecutive-failure counter. Reset on success.
  const failCounts = useRef<Map<string, number>>(new Map());
  // Alerted-state tracker — true if we've already fired a "down" alert
  // for this surface and haven't yet seen recovery.
  const alertedDown = useRef<Map<string, boolean>>(new Map());

  const overall = useMemo(() => aggregateStatus(results), [results]);

  const tick = useCallback(async () => {
    setPolling(true);
    try {
      const fresh = await probeAll(SURFACES);
      setResults(fresh);
      setLastPollAt(Date.now());

      // Alert state machine, per surface
      for (const r of fresh) {
        const key = r.surface.name;
        const wasAlerted = alertedDown.current.get(key) ?? false;
        const downNow = isDown(r.status);
        if (downNow) {
          const count = (failCounts.current.get(key) ?? 0) + 1;
          failCounts.current.set(key, count);
          if (count >= FAILURES_BEFORE_ALERT && !wasAlerted) {
            await fireAlert(r.surface, r.status, "down");
            alertedDown.current.set(key, true);
          }
        } else {
          failCounts.current.set(key, 0);
          if (wasAlerted) {
            await fireAlert(r.surface, r.status, "recovered");
            alertedDown.current.set(key, false);
          }
        }
      }
    } finally {
      setPolling(false);
    }
  }, []);

  useEffect(() => {
    ensureNotificationPermission().then(setPermGranted);
    void tick();
    const id = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "1.25rem 1rem 2rem",
        background:
          "radial-gradient(ellipse at top, rgba(255, 130, 0, 0.12), transparent 60%), #0a0a0a",
        color: "#e2e8f0",
        boxSizing: "border-box",
      }}
    >
      <header style={{ marginBottom: "1.25rem" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 900,
            color: "#FBDB65",
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          Garmr 🐺
        </h1>
        <p style={{ fontSize: "0.78rem", color: "#9ca3af", margin: "0.25rem 0 0" }}>
          Watchdog. Polls every {POLL_INTERVAL_MS / 1000}s. Alerts on{" "}
          {FAILURES_BEFORE_ALERT} consecutive failures.
        </p>
      </header>

      <section
        style={{
          padding: "0.875rem 1rem",
          marginBottom: "1.25rem",
          background: STATUS_COLORS[overall].bg,
          border: `1px solid ${STATUS_COLORS[overall].fg}40`,
          borderRadius: "0.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "#9ca3af",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Platform
          </div>
          <div style={{ fontSize: "1.25rem", color: STATUS_COLORS[overall].fg, fontWeight: 900 }}>
            ● {STATUS_COLORS[overall].label}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "0.72rem", color: "#9ca3af" }}>
          {polling ? "checking…" : lastPollAt ? `checked ${relTime(lastPollAt)}` : "—"}
          <br />
          {permGranted === false && (
            <span style={{ color: "#ef4444" }}>Notifications denied</span>
          )}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {SURFACES.map((s: Surface) => {
          const result = results.find((r) => r.surface.name === s.name);
          const status: ProbeStatus = result?.status ?? "healthy";
          const colors = STATUS_COLORS[status];
          return (
            <a
              key={s.name}
              href={s.visitUrl}
              target="_blank"
              rel="noopener"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.875rem",
                padding: "0.875rem 1rem",
                background: "rgba(31, 41, 55, 0.6)",
                border: `1px solid ${colors.fg}40`,
                borderRadius: "0.75rem",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  width: "0.65rem",
                  height: "0.65rem",
                  borderRadius: "50%",
                  background: colors.fg,
                  boxShadow: `0 0 8px ${colors.fg}80`,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#FBDB65", fontWeight: 700, fontSize: "0.95rem" }}>{s.name}</div>
                <div style={{ color: "#94a3b8", fontSize: "0.72rem", marginTop: "0.15rem" }}>
                  {result
                    ? `${colors.label} · ${result.latencyMs}ms${
                        result.httpStatus ? ` · HTTP ${result.httpStatus}` : ""
                      }`
                    : "checking…"}
                  {result?.detail ? ` · ${result.detail.slice(0, 80)}` : null}
                </div>
              </div>
              <div style={{ color: "#6b7280", fontSize: "1.25rem", lineHeight: 1 }}>↗</div>
            </a>
          );
        })}
      </section>

      <button
        onClick={() => void tick()}
        disabled={polling}
        style={{
          marginTop: "1.5rem",
          width: "100%",
          padding: "0.75rem",
          background: "transparent",
          border: "1px solid #374151",
          borderRadius: "0.5rem",
          color: polling ? "#6b7280" : "#FF8200",
          fontWeight: 700,
          fontSize: "0.85rem",
          cursor: polling ? "default" : "pointer",
        }}
      >
        {polling ? "Checking…" : "Check now"}
      </button>

      <footer style={{ marginTop: "2rem", color: "#6b7280", fontSize: "0.7rem", textAlign: "center" }}>
        Garmr runs on-device. Independent of the cloud it watches.
      </footer>
    </main>
  );
}
