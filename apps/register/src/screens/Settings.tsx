/**
 * Settings — connection mode, sync state, manual refresh, recent events,
 * reset device.
 */

import { useEffect, useState } from "react";
import { listAllEvents } from "../db";
import { onSyncChange, syncOnce, type SyncSnapshot } from "../sync";
import { fetchBootstrap } from "../api";
import { replaceInventory, replaceStaff } from "../db";
import {
  clearServerConfig,
  setApiBaseUrl,
  setTaxSettings,
  setStripePublishableKey,
  setTapToPayApproved,
  DEFAULT_API_BASE,
  SIM_OPS_DOWN_URL,
} from "../device";
import { Screen, Card, Button, H1, H2, Muted, Pill, colors } from "../ui";
import type { ServerConfig, ConnectionMode, RegisterEvent } from "../types";

interface SettingsProps {
  cfg: ServerConfig;
  mode: ConnectionMode;
  onBack: () => void;
  onResetDevice: () => void;
  onCfgChanged: () => void;
}

export function Settings({ cfg, mode, onBack, onResetDevice, onCfgChanged }: SettingsProps) {
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [events, setEvents] = useState<RegisterEvent[]>([]);
  const [busy, setBusy] = useState<"sync" | "bootstrap" | null>(null);
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null);

  useEffect(() => {
    const off = onSyncChange(setSnapshot);
    void listAllEvents(50).then(setEvents);
    const i = setInterval(() => void listAllEvents(50).then(setEvents), 5000);
    return () => {
      off();
      clearInterval(i);
    };
  }, []);

  async function handleSync() {
    setBusy("sync");
    try { await syncOnce(cfg); } finally { setBusy(null); }
  }

  async function handleBootstrap() {
    setBusy("bootstrap");
    setBootstrapMsg(null);
    try {
      const data = await fetchBootstrap(cfg);
      await replaceInventory(data.inventory);
      await replaceStaff(data.staff);
      await setTaxSettings({
        ratePercent: data.store.taxRatePercent,
        includedInPrice: data.store.taxIncludedInPrice,
      });
      await setStripePublishableKey(data.store.stripePublishableKey);
      await setTapToPayApproved(data.store.tapToPayApproved);
      setBootstrapMsg(`Refreshed: ${data.inventory.length} inventory, ${data.staff.length} staff`);
    } catch (err) {
      setBootstrapMsg(err instanceof Error ? `Failed: ${err.message}` : "Bootstrap failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleResetDevice() {
    if (!confirm("Reset this device? You'll need the API key + store ID again to set it up.")) return;
    await clearServerConfig();
    onResetDevice();
  }

  const opsDownSim = cfg.apiBaseUrl === SIM_OPS_DOWN_URL;
  async function toggleOpsDownSim() {
    await setApiBaseUrl(opsDownSim ? DEFAULT_API_BASE : SIM_OPS_DOWN_URL);
    onCfgChanged();
  }

  const modeColor = mode === "online" ? colors.green : mode === "ops-down" ? colors.amber : colors.red;
  const modeLabel = mode === "online" ? "Online" : mode === "ops-down" ? "Ops down" : "Offline";

  return (
    <Screen>
      <button
        onClick={onBack}
        style={{ background: "transparent", border: "none", color: colors.inkSoft, fontSize: "0.85rem", cursor: "pointer", padding: 0, marginBottom: "0.75rem", alignSelf: "flex-start" }}
      >
        ← Back to register
      </button>
      <H1>Settings</H1>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: "0.5rem", paddingRight: "0.25rem" }}>

      {/* Connection mode */}
      <Card style={{ marginTop: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <H2>Connection</H2>
            <Muted style={{ marginTop: "0.25rem" }}>
              {mode === "online" && "All systems reachable."}
              {mode === "ops-down" && "Internet works, Store Ops unreachable. Sales queue locally."}
              {mode === "offline" && "No internet. Sales queue locally; sync when reconnected."}
            </Muted>
          </div>
          <Pill color={modeColor}>● {modeLabel}</Pill>
        </div>
      </Card>

      {/* Demo / QA: simulate ops-down without touching production */}
      <Card style={{ marginTop: "0.75rem", borderColor: opsDownSim ? `${colors.amber}80` : colors.rule }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: "0.75rem" }}>
            <H2>Simulate ops down</H2>
            <Muted style={{ marginTop: "0.25rem" }}>
              Points the register at a bogus URL. Health probes fail; phone keeps internet. Used for the storm test.
            </Muted>
          </div>
          <Button onClick={toggleOpsDownSim} variant={opsDownSim ? "primary" : "ghost"}>
            {opsDownSim ? "On" : "Off"}
          </Button>
        </div>
      </Card>

      {/* Sync state */}
      <Card style={{ marginTop: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <H2>Sync</H2>
          <Pill color={
            (snapshot?.pendingCount ?? 0) === 0
              ? colors.green
              : mode === "offline" ? colors.red : colors.amber
          }>
            {snapshot?.pendingCount ?? 0} pending
          </Pill>
        </div>
        <Muted style={{ marginBottom: "0.625rem" }}>
          {snapshot?.lastSyncAt
            ? `Last sync: ${new Date(snapshot.lastSyncAt).toLocaleTimeString()} · ${snapshot.lastSyncResult ?? "—"}`
            : "No syncs yet"}
          {snapshot?.lastError ? ` · ${snapshot.lastError.slice(0, 100)}` : ""}
        </Muted>
        <Button onClick={handleSync} disabled={!!busy}>
          {busy === "sync" ? "Syncing…" : "Sync now"}
        </Button>
      </Card>

      {/* Inventory + staff bootstrap */}
      <Card style={{ marginTop: "0.75rem" }}>
        <H2>Refresh inventory + staff</H2>
        <Muted style={{ marginTop: "0.25rem", marginBottom: "0.625rem" }}>
          Pulls latest from Store Ops. Required when prices change or new staff are added.
        </Muted>
        {bootstrapMsg ? (
          <div style={{ color: bootstrapMsg.startsWith("Failed") ? colors.red : colors.green, fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            {bootstrapMsg}
          </div>
        ) : null}
        <Button onClick={handleBootstrap} disabled={!!busy} variant="ghost">
          {busy === "bootstrap" ? "Refreshing…" : "Refresh from server"}
        </Button>
      </Card>

      {/* Recent events */}
      <Card style={{ marginTop: "0.75rem" }}>
        <H2>Recent events</H2>
        <div style={{ marginTop: "0.5rem", maxHeight: "40vh", overflowY: "auto" }}>
          {events.length === 0 ? (
            <Muted>No events yet.</Muted>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {events.map((e) => {
                const color =
                  e.status === "applied" ? colors.green
                  : e.status === "pending" ? colors.amber
                  : e.status === "duplicate" ? colors.inkSoft
                  : colors.red;
                return (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.4rem 0", borderBottom: `1px solid ${colors.rule}` }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: colors.ink, fontSize: "0.85rem" }}>{e.type}</div>
                      <div style={{ color: colors.inkFaint, fontSize: "0.7rem" }}>
                        {new Date(e.wallTime).toLocaleTimeString()} · L{e.lamport}
                      </div>
                    </div>
                    <span style={{ color, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {e.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Danger zone */}
      <Card style={{ marginTop: "0.75rem", borderColor: `${colors.red}40` }}>
        <H2>Danger zone</H2>
        <Muted style={{ marginTop: "0.25rem", marginBottom: "0.625rem" }}>
          Reset clears the API key + store ID. The local event log is preserved (sync will retry once re-bootstrapped).
        </Muted>
        <Button onClick={handleResetDevice} variant="danger">
          Reset device
        </Button>
      </Card>

      </div>
    </Screen>
  );
}
