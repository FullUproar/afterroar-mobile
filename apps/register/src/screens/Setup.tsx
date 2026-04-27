/**
 * First-launch screen. Cashier (or owner) pastes the API key + store ID,
 * we fetch the bootstrap snapshot (inventory + staff) and persist locally.
 * Once setup is done, this screen never shows again unless local data is
 * wiped or the device is "reset" from Settings.
 */

import { useState } from "react";
import { setServerConfig } from "../device";
import { fetchBootstrap } from "../api";
import { replaceInventory, replaceStaff } from "../db";
import { Screen, Button, Input, Card, H1, H2, Muted, colors } from "../ui";
import type { ServerConfig } from "../types";

const DEFAULT_BASE = "https://www.afterroar.store";

export function Setup({ onDone }: { onDone: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [storeId, setStoreId] = useState("");
  const [apiBase, setApiBase] = useState(DEFAULT_BASE);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!apiKey.trim() || !storeId.trim()) {
      setError("API key and store ID are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cfg: ServerConfig = {
        apiKey: apiKey.trim(),
        storeId: storeId.trim(),
        apiBaseUrl: apiBase.trim() || DEFAULT_BASE,
        deviceId: "bootstrap",
      };
      const data = await fetchBootstrap(cfg);
      await setServerConfig({
        apiKey: apiKey.trim(),
        storeId: storeId.trim(),
        apiBaseUrl: apiBase.trim() || DEFAULT_BASE,
      });
      await replaceInventory(data.inventory);
      await replaceStaff(data.staff);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div style={{ marginBottom: "1.5rem" }}>
        <H1>Set up this register</H1>
        <Muted style={{ marginTop: "0.25rem" }}>
          One-time setup. Pulls inventory + staff onto the device for offline use.
        </Muted>
      </div>

      <Card style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          <Muted>API key (from /admin/api-keys on afterroar.me)</Muted>
          <div style={{ marginTop: "0.25rem" }}>
            <Input
              value={apiKey}
              onChange={setApiKey}
              placeholder="ar_live_…"
              autoFocus
            />
          </div>
        </label>
        <label>
          <Muted>Store ID</Muted>
          <div style={{ marginTop: "0.25rem" }}>
            <Input
              value={storeId}
              onChange={setStoreId}
              placeholder="cmoegx80r000004i5ml460vn9"
            />
          </div>
        </label>

        {showAdvanced ? (
          <label>
            <Muted>API base URL</Muted>
            <div style={{ marginTop: "0.25rem" }}>
              <Input value={apiBase} onChange={setApiBase} placeholder={DEFAULT_BASE} />
            </div>
          </label>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            style={{
              background: "transparent",
              border: "none",
              color: colors.inkSoft,
              fontSize: "0.78rem",
              cursor: "pointer",
              alignSelf: "flex-start",
              padding: 0,
            }}
          >
            advanced
          </button>
        )}

        {error ? (
          <div style={{ color: colors.red, fontSize: "0.85rem", padding: "0.5rem 0" }}>
            {error}
          </div>
        ) : null}

        <Button onClick={handleSubmit} disabled={busy} size="lg">
          {busy ? "Setting up…" : "Bootstrap"}
        </Button>
      </Card>

      <Card style={{ marginTop: "1.25rem" }}>
        <H2>How to get an API key</H2>
        <Muted style={{ marginTop: "0.5rem", lineHeight: 1.5 }}>
          1. Sign in to{" "}
          <span style={{ color: colors.orange }}>afterroar.me/admin/api-keys</span>{" "}
          as an owner.<br />
          2. Mint a key with the <code>register:write</code> scope.<br />
          3. The full key is shown <em>once</em>. Copy it here immediately.<br />
          4. Store ID is the cuid of your store in the pos_stores table — visible
          in the Store Ops dashboard URL bar.
        </Muted>
      </Card>
    </Screen>
  );
}
