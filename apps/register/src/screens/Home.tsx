/**
 * Register home — product picker, cart, checkout.
 *
 * Stage 4 demo scope: cash sales only. Tap items to add to cart, adjust
 * quantities, "Cash" button completes the sale → writes a `cash_sale`
 * event to the local event log → sync loop pushes to /api/sync.
 */

import { useEffect, useMemo, useState } from "react";
import { listInventory, appendEvent } from "../db";
import { nextLamport } from "../device";
import { refreshPendingCount, syncOnce } from "../sync";
import { Screen, Card, Button, H1, Muted, colors, fmtCents } from "../ui";
import type { CartLine, InventoryItem, Staff, ServerConfig, ConnectionMode } from "../types";

interface HomeProps {
  staff: Staff;
  cfg: ServerConfig;
  mode: ConnectionMode;
  onSignOut: () => void;
  onSettings: () => void;
}

export function Home({ staff, cfg, mode, onSignOut, onSettings }: HomeProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [completing, setCompleting] = useState(false);
  const [lastSale, setLastSale] = useState<{ totalCents: number; items: number; offline: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listInventory().then(setInventory);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q),
    );
  }, [inventory, search]);

  const totalCents = cart.reduce((s, l) => s + l.qty * l.priceCents, 0);
  const totalItems = cart.reduce((s, l) => s + l.qty, 0);

  function addToCart(item: InventoryItem) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.inventoryItemId === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { inventoryItemId: item.id, name: item.name, qty: 1, priceCents: item.priceCents }];
    });
  }

  function adjustQty(itemId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.inventoryItemId === itemId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  async function completeCashSale() {
    if (cart.length === 0 || completing) return;
    setCompleting(true);
    setError(null);
    try {
      const evtId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const lamport = await nextLamport();
      await appendEvent({
        id: evtId,
        lamport,
        wallTime: Date.now(),
        type: "cash_sale",
        payload: {
          items: cart,
          totalCents,
          staffId: staff.id,
          paymentMethod: "cash",
        },
      });
      setLastSale({ totalCents, items: totalItems, offline: mode === "offline" });
      setCart([]);
      void refreshPendingCount();
      // Best-effort immediate push if online
      if (mode !== "offline") void syncOnce(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sale failed");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <Screen>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <div>
          <H1>Register</H1>
          <Muted style={{ marginTop: "0.15rem" }}>
            {staff.name} · {staff.role}
          </Muted>
        </div>
        <button
          onClick={onSettings}
          style={{
            background: "transparent",
            border: `1px solid ${colors.rule}`,
            borderRadius: "0.5rem",
            padding: "0.5rem 0.75rem",
            color: colors.inkSoft,
            cursor: "pointer",
            fontSize: "0.78rem",
          }}
        >
          ⚙
        </button>
      </header>

      {/* Last-sale toast (auto-dismiss-ish — just clears on next add) */}
      {lastSale && (
        <Card
          style={{
            background: lastSale.offline ? "rgba(251, 191, 36, 0.15)" : "rgba(16, 185, 129, 0.15)",
            border: `1px solid ${lastSale.offline ? colors.amber : colors.green}40`,
            marginBottom: "0.625rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <span style={{ fontSize: "1.25rem" }}>{lastSale.offline ? "⚠" : "✓"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: colors.cream, fontWeight: 800 }}>
                Sale complete · {fmtCents(lastSale.totalCents)} · {lastSale.items} item{lastSale.items === 1 ? "" : "s"}
              </div>
              <Muted style={{ marginTop: "0.15rem" }}>
                {lastSale.offline
                  ? "OFFLINE — will sync when service returns"
                  : "Queued; will appear on the dashboard within seconds"}
              </Muted>
            </div>
            <button
              onClick={() => setLastSale(null)}
              style={{ background: "transparent", border: "none", color: colors.inkSoft, cursor: "pointer", fontSize: "1.25rem" }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </Card>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search products…"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "0.625rem 0.875rem",
          background: "rgba(0,0,0,0.3)",
          border: `1px solid ${colors.rule}`,
          borderRadius: "0.5rem",
          color: colors.ink,
          fontSize: "0.95rem",
          outline: "none",
          marginBottom: "0.625rem",
        }}
      />

      {/* Product list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.375rem",
          marginBottom: "0.625rem",
        }}
      >
        {filtered.length === 0 ? (
          <Card>
            <Muted>{inventory.length === 0 ? "No inventory cached. Bootstrap from Settings." : "No matches."}</Muted>
          </Card>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              style={{
                background: colors.panel,
                border: `1px solid ${colors.rule}`,
                borderRadius: "0.5rem",
                padding: "0.625rem 0.875rem",
                cursor: "pointer",
                color: colors.ink,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: colors.cream, fontWeight: 700, fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.name}
                </div>
                <div style={{ color: colors.inkSoft, fontSize: "0.72rem", marginTop: "0.1rem" }}>
                  {item.sku ?? "no SKU"} · qty {item.quantity}
                </div>
              </div>
              <div style={{ color: colors.orange, fontWeight: 800, marginLeft: "0.75rem" }}>{fmtCents(item.priceCents)}</div>
            </button>
          ))
        )}
      </div>

      {/* Cart + checkout */}
      <Card style={{ background: colors.panelHi }}>
        {cart.length === 0 ? (
          <Muted style={{ textAlign: "center" }}>Tap items above to add to cart.</Muted>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", maxHeight: "30vh", overflowY: "auto", marginBottom: "0.75rem" }}>
              {cart.map((line) => (
                <div key={line.inventoryItemId} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: colors.ink, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {line.name}
                    </div>
                    <div style={{ color: colors.inkSoft, fontSize: "0.7rem" }}>
                      {fmtCents(line.priceCents)} ea
                    </div>
                  </div>
                  <button onClick={() => adjustQty(line.inventoryItemId, -1)} style={qtyBtn}>−</button>
                  <span style={{ minWidth: "1.5rem", textAlign: "center", color: colors.cream, fontWeight: 800 }}>{line.qty}</span>
                  <button onClick={() => adjustQty(line.inventoryItemId, +1)} style={qtyBtn}>+</button>
                  <span style={{ minWidth: "4rem", textAlign: "right", color: colors.orange, fontWeight: 800 }}>
                    {fmtCents(line.qty * line.priceCents)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.625rem" }}>
              <span style={{ color: colors.inkSoft, fontSize: "0.78rem" }}>{totalItems} item{totalItems === 1 ? "" : "s"}</span>
              <span style={{ color: colors.cream, fontSize: "1.5rem", fontWeight: 900 }}>{fmtCents(totalCents)}</span>
            </div>
            {mode === "offline" && (
              <div
                style={{
                  background: "rgba(251, 191, 36, 0.15)",
                  border: `1px solid ${colors.amber}50`,
                  borderRadius: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  marginBottom: "0.625rem",
                  color: colors.amber,
                  fontSize: "0.78rem",
                  fontWeight: 700,
                }}
              >
                ⚠ OFFLINE — sale will sync when service returns
              </div>
            )}
            {error ? (
              <div style={{ color: colors.red, fontSize: "0.85rem", marginBottom: "0.5rem" }}>{error}</div>
            ) : null}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button variant="ghost" onClick={() => setCart([])} disabled={completing}>
                Clear
              </Button>
              <Button onClick={completeCashSale} disabled={completing} size="lg" style={{ flex: 1 }}>
                {completing ? "…" : `Cash · ${fmtCents(totalCents)}`}
              </Button>
            </div>
          </>
        )}
      </Card>

      <button
        onClick={onSignOut}
        style={{
          background: "transparent",
          border: "none",
          color: colors.inkFaint,
          fontSize: "0.7rem",
          cursor: "pointer",
          marginTop: "0.5rem",
          textAlign: "center",
        }}
      >
        Sign out
      </button>
    </Screen>
  );
}

const qtyBtn = {
  width: "2rem",
  height: "2rem",
  borderRadius: "0.375rem",
  border: `1px solid ${colors.rule}`,
  background: "transparent",
  color: colors.cream,
  fontSize: "1rem",
  fontWeight: 800,
  cursor: "pointer",
};
