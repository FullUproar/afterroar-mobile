/**
 * Register home — product picker, cart, checkout.
 *
 * Stage 4 demo scope: cash sales only. Tap items to add to cart, adjust
 * quantities, "Cash" button completes the sale → writes a `cash_sale`
 * event to the local event log → sync loop pushes to /api/sync.
 */

import { useEffect, useMemo, useState } from "react";
import { listInventory, findItemByCode, appendEvent } from "../db";
import {
  nextLamport,
  getTaxSettings,
  getStripePublishableKey,
  getTapToPayApproved,
  type TaxSettings,
} from "../device";
import { refreshPendingCount, syncOnce } from "../sync";
import { capability } from "../capability";
import { scanOnce } from "../scanner";
import { createPaymentIntent } from "../api";
import { ensureTerminal, collectViaTapToPay, type TerminalAvailability } from "../terminal";
import { CustomerPicker } from "./CustomerPicker";
import { DiscountModal } from "./DiscountModal";
import { CardSaleModal } from "./CardSaleModal";
import { Screen, Card, Button, H1, Muted, colors, fmtCents } from "../ui";
import type { CartLine, InventoryItem, Staff, ServerConfig, ConnectionMode, Customer, Discount } from "../types";

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
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [discount, setDiscount] = useState<Discount | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [capabilityToast, setCapabilityToast] = useState<string | null>(null);
  const [tax, setTax] = useState<TaxSettings>({ ratePercent: 0, includedInPrice: false });
  const [completing, setCompleting] = useState(false);
  const [completingMethod, setCompletingMethod] = useState<"cash" | "card" | null>(null);
  const [lastSale, setLastSale] = useState<{
    totalCents: number;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    items: CartLine[];
    method: "cash" | "card";
    offline: boolean;
    customerName: string | null;
    customerEmail: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stripePk, setStripePk] = useState<string | null>(null);
  const [tapApproved, setTapApproved] = useState(false);
  const [terminalAvail, setTerminalAvail] = useState<TerminalAvailability>({
    available: false,
    reason: "unsupported",
  });
  // Active live-mode card sale: PI is created, awaiting Elements confirmation.
  const [pendingCard, setPendingCard] = useState<{
    eventId: string;
    paymentIntentId: string;
    clientSecret: string;
    amountCents: number;
    customerId: string | null;
  } | null>(null);

  const customerCap = capability(mode, "customer_lookup");
  const cardCap = capability(mode, "card_sale");
  const tapAvailable = tapApproved && cardCap.available && terminalAvail.available;

  useEffect(() => {
    void listInventory().then(setInventory);
    void getTaxSettings().then(setTax);
    void getStripePublishableKey().then(setStripePk);
    void (async () => {
      const approved = await getTapToPayApproved();
      setTapApproved(approved);
      if (!approved) return;
      // We don't know test-vs-live mode purely from the publishable key
      // (the server's payment-intent endpoint owns that distinction), but
      // the Stripe.js publishable key shape gives a usable hint.
      const pk = await getStripePublishableKey();
      const isTest = !pk || pk.startsWith("pk_test_");
      const avail = await ensureTerminal(cfg, isTest);
      setTerminalAvail(avail);
    })();
  }, [cfg]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q),
    );
  }, [inventory, search]);

  const subtotalCents = cart.reduce((s, l) => s + l.qty * l.priceCents, 0);
  const totalItems = cart.reduce((s, l) => s + l.qty, 0);
  const discountCents = useMemo(() => {
    if (!discount) return 0;
    if (discount.kind === "percent") return Math.round((subtotalCents * discount.value) / 100);
    return Math.min(subtotalCents, Math.round(discount.value * 100));
  }, [discount, subtotalCents]);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = tax.includedInPrice ? 0 : Math.round((taxableCents * tax.ratePercent) / 100);
  const totalCents = taxableCents + taxCents;

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

  async function handleScan() {
    const result = await scanOnce();
    if (!result.ok) {
      if (result.reason === "cancelled") return;
      const msg = result.message ?? "Scan failed";
      setCapabilityToast(msg);
      setTimeout(() => setCapabilityToast(null), 3500);
      return;
    }
    const item = await findItemByCode(result.code);
    if (item) {
      addToCart(item);
      return;
    }
    setCapabilityToast(`No match for ${result.code}. Try search by name.`);
    setSearch(result.code);
    setTimeout(() => setCapabilityToast(null), 3500);
  }

  function adjustQty(itemId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.inventoryItemId === itemId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  function genId(): string {
    return (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildSaleBase() {
    return {
      items: cart,
      subtotalCents,
      discountCents,
      discount: discount ?? null,
      taxCents,
      totalCents,
      staffId: staff.id,
      customerId: customer?.id ?? null,
    };
  }

  function resetAfterSale(method: "cash" | "card") {
    setLastSale({
      totalCents,
      subtotalCents,
      discountCents,
      taxCents,
      items: cart,
      method,
      offline: mode === "offline",
      customerName: customer?.name ?? null,
      customerEmail: customer?.email ?? null,
    });
    setCart([]);
    setCustomer(null);
    setDiscount(null);
    void refreshPendingCount();
    if (mode !== "offline") void syncOnce(cfg);
  }

  async function completeCashSale() {
    if (cart.length === 0 || completing) return;
    setCompleting(true);
    setCompletingMethod("cash");
    setError(null);
    try {
      const evtId = genId();
      const lamport = await nextLamport();
      await appendEvent({
        id: evtId,
        lamport,
        wallTime: Date.now(),
        type: "cash_sale",
        payload: { ...buildSaleBase(), paymentMethod: "cash" },
      });
      resetAfterSale("cash");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sale failed");
    } finally {
      setCompleting(false);
      setCompletingMethod(null);
    }
  }

  /** Fire the card_sale event with the now-confirmed PI id. Snapshot of the
   *  cart at PI-creation time is implicit: state hasn't mutated since the
   *  modal was opened (cart Clear/+/-/etc are blocked while completing). */
  async function fireCardSaleEvent(eventId: string, paymentIntentId: string, amountCents: number) {
    const lamport = await nextLamport();
    await appendEvent({
      id: eventId,
      lamport,
      wallTime: Date.now(),
      type: "card_sale",
      payload: { ...buildSaleBase(), paymentMethod: "card", paymentIntentId },
    });
    void amountCents; // recorded via totalCents on the payload
    resetAfterSale("card");
  }

  async function completeTapToPaySale() {
    if (cart.length === 0 || completing) return;
    if (!tapAvailable) return;
    setCompleting(true);
    setCompletingMethod("card");
    setError(null);
    try {
      const evtId = genId();
      const pi = await createPaymentIntent(cfg, {
        amountCents: totalCents,
        clientTxId: evtId,
        customerId: customer?.id ?? null,
      });
      // Test-mode auto-confirm short-circuits NFC entirely (the server already
      // ran the simulated charge); just record the event.
      if (pi.status === "succeeded") {
        await fireCardSaleEvent(evtId, pi.paymentIntentId, totalCents);
        return;
      }
      if (pi.status !== "requires_payment_method" && pi.status !== "requires_confirmation") {
        throw new Error(`Unexpected payment status: ${pi.status}`);
      }
      // Live-mode: hand the PI to the Terminal SDK for NFC tap collection.
      // collectViaTapToPay() opens the system overlay and resolves once the
      // tap completes (or rejects on cancel/error).
      await collectViaTapToPay(pi.paymentIntentId);
      await fireCardSaleEvent(evtId, pi.paymentIntentId, totalCents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tap-to-Pay sale failed");
      setCompleting(false);
      setCompletingMethod(null);
    }
  }

  async function completeCardSale() {
    if (cart.length === 0 || completing) return;
    if (!cardCap.available) return;
    setCompleting(true);
    setCompletingMethod("card");
    setError(null);
    try {
      const evtId = genId();
      const pi = await createPaymentIntent(cfg, {
        amountCents: totalCents,
        clientTxId: evtId,
        customerId: customer?.id ?? null,
      });

      if (pi.status === "succeeded") {
        // Test-mode auto-confirm path
        await fireCardSaleEvent(evtId, pi.paymentIntentId, totalCents);
        return;
      }

      if (pi.status === "requires_payment_method" || pi.status === "requires_confirmation") {
        // Live-mode path: open Elements modal
        if (!stripePk) {
          throw new Error(
            "Stripe publishable key missing on this device. Settings → Refresh inventory to re-pull, then retry.",
          );
        }
        if (!pi.clientSecret) {
          throw new Error("Server did not return clientSecret for live-mode card sale.");
        }
        setPendingCard({
          eventId: evtId,
          paymentIntentId: pi.paymentIntentId,
          clientSecret: pi.clientSecret,
          amountCents: totalCents,
          customerId: customer?.id ?? null,
        });
        // The modal owns the next step; keep `completing` true so the cart is locked.
        return;
      }

      throw new Error(`Unexpected payment status: ${pi.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Card sale failed");
      setCompleting(false);
      setCompletingMethod(null);
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: colors.cream, fontWeight: 800 }}>
                {lastSale.method === "card" ? "Card" : "Cash"} sale · {fmtCents(lastSale.totalCents)} · {lastSale.items.length} item{lastSale.items.length === 1 ? "" : "s"}
              </div>
              <Muted style={{ marginTop: "0.15rem" }}>
                {lastSale.offline
                  ? "OFFLINE — will sync when service returns"
                  : "Queued; will appear on the dashboard within seconds"}
              </Muted>
              <ReceiptOffer
                lastSale={lastSale}
                cfg={cfg}
                staffName={staff.name}
                mode={mode}
              />
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

      {/* Search + Scan */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.625rem" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          style={{
            flex: 1,
            boxSizing: "border-box",
            padding: "0.625rem 0.875rem",
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${colors.rule}`,
            borderRadius: "0.5rem",
            color: colors.ink,
            fontSize: "0.95rem",
            outline: "none",
          }}
        />
        <button
          onClick={handleScan}
          style={{
            background: "transparent",
            border: `1px solid ${colors.rule}`,
            borderRadius: "0.5rem",
            padding: "0.5rem 0.875rem",
            color: colors.cream,
            fontSize: "0.95rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            fontWeight: 700,
          }}
          aria-label="Scan barcode"
        >
          <span style={{ fontSize: "1.1rem" }}>⎙</span>
          <span>Scan</span>
        </button>
      </div>

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

      {/* Customer pill */}
      <button
        type="button"
        onClick={() => {
          if (customerCap.available) {
            setShowCustomerPicker(true);
          } else if (customer) {
            // Even when offline, allow clearing back to Guest
            setCustomer(null);
          } else {
            setCapabilityToast(customerCap.reason ?? null);
            setTimeout(() => setCapabilityToast(null), 3500);
          }
        }}
        style={{
          background: customer ? colors.orangeDim : "transparent",
          border: `1px solid ${customer ? colors.orange : colors.rule}`,
          borderRadius: "0.5rem",
          padding: "0.5rem 0.75rem",
          marginBottom: "0.5rem",
          color: customer ? colors.cream : customerCap.available ? colors.inkSoft : colors.inkFaint,
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "0.85rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: "1rem" }}>{customer ? "✓" : "○"}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: customer ? 800 : 500 }}>
            {customer ? customer.name : "Guest sale"}
          </span>
          {customer && (customer.creditBalanceCents > 0 || customer.loyaltyPoints > 0) && (
            <span style={{ color: colors.green, fontSize: "0.72rem", fontWeight: 700 }}>
              {customer.creditBalanceCents > 0 ? fmtCents(customer.creditBalanceCents) + " credit" : ""}
              {customer.creditBalanceCents > 0 && customer.loyaltyPoints > 0 ? " · " : ""}
              {customer.loyaltyPoints > 0 ? customer.loyaltyPoints + " pts" : ""}
            </span>
          )}
        </div>
        <span style={{ color: customerCap.available ? colors.orange : colors.inkFaint, fontSize: "0.78rem", whiteSpace: "nowrap" }}>
          {customer ? "Change" : customerCap.available ? "Attach customer" : "Offline"}
        </span>
      </button>

      {capabilityToast && (
        <div
          style={{
            background: "rgba(251, 191, 36, 0.15)",
            border: `1px solid ${colors.amber}50`,
            borderRadius: "0.5rem",
            padding: "0.5rem 0.75rem",
            marginBottom: "0.5rem",
            color: colors.amber,
            fontSize: "0.78rem",
          }}
        >
          {capabilityToast}
        </div>
      )}

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
            {/* Subtotal / discount / tax breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.625rem", fontSize: "0.85rem" }}>
              <SummaryLine label={`Subtotal · ${totalItems} item${totalItems === 1 ? "" : "s"}`} value={fmtCents(subtotalCents)} />
              {discount && discountCents > 0 && (
                <SummaryLine
                  label={
                    discount.kind === "percent"
                      ? `Discount · ${discount.value}%${discount.reason ? ` (${discount.reason})` : ""}`
                      : `Discount${discount.reason ? ` · ${discount.reason}` : ""}`
                  }
                  value={`-${fmtCents(discountCents)}`}
                  valueColor={colors.orange}
                  onClear={() => setDiscount(null)}
                />
              )}
              {taxCents > 0 && (
                <SummaryLine
                  label={`Tax · ${tax.ratePercent}%`}
                  value={fmtCents(taxCents)}
                />
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.625rem", paddingTop: "0.5rem", borderTop: `1px solid ${colors.rule}` }}>
              <span style={{ color: colors.inkSoft, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Total</span>
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
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <Button variant="ghost" onClick={() => setCart([])} disabled={completing}>
                Clear
              </Button>
              <Button variant="ghost" onClick={() => setShowDiscountModal(true)} disabled={completing}>
                {discount ? `Disc · ${discount.kind === "percent" ? `${discount.value}%` : `$${discount.value}`}` : "Discount"}
              </Button>
            </div>
            {tapAvailable && (
              <div style={{ marginBottom: "0.5rem" }}>
                <Button
                  onClick={() => void completeTapToPaySale()}
                  disabled={completing}
                  size="lg"
                  style={{
                    width: "100%",
                    background: "linear-gradient(135deg, #FF8200 0%, #FB923C 100%)",
                    border: "none",
                    color: "#0a0a0a",
                    fontSize: "1.1rem",
                    fontWeight: 900,
                    letterSpacing: "0.04em",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "1.4rem" }}>📱</span>
                    {completing && completingMethod === "card" ? "Tap to pay…" : `Tap to pay · ${fmtCents(totalCents)}`}
                  </span>
                </Button>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <Button
                onClick={() => {
                  if (cardCap.available) void completeCardSale();
                  else {
                    setCapabilityToast(cardCap.reason ?? null);
                    setTimeout(() => setCapabilityToast(null), 3500);
                  }
                }}
                disabled={completing || !cardCap.available}
                size="lg"
                variant={tapAvailable ? "ghost" : cardCap.available ? "primary" : "ghost"}
                style={{ flex: 1 }}
              >
                {completing && completingMethod === "card" && !tapAvailable
                  ? "…"
                  : tapAvailable
                  ? "Type card"
                  : `Card · ${fmtCents(totalCents)}`}
              </Button>
              <Button
                onClick={completeCashSale}
                disabled={completing}
                size="lg"
                variant="ghost"
                style={{ flex: 1 }}
              >
                {completing && completingMethod === "cash" ? "…" : `Cash · ${fmtCents(totalCents)}`}
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

      {showCustomerPicker && (
        <CustomerPicker
          cfg={cfg}
          current={customer}
          onPick={(c) => {
            setCustomer(c);
            setShowCustomerPicker(false);
          }}
          onClose={() => setShowCustomerPicker(false)}
        />
      )}

      {showDiscountModal && (
        <DiscountModal
          subtotalCents={subtotalCents}
          current={discount}
          onApply={(d) => {
            setDiscount(d);
            setShowDiscountModal(false);
          }}
          onClose={() => setShowDiscountModal(false)}
        />
      )}

      {pendingCard && stripePk && (
        <CardSaleModal
          publishableKey={stripePk}
          clientSecret={pendingCard.clientSecret}
          paymentIntentId={pendingCard.paymentIntentId}
          amountCents={pendingCard.amountCents}
          onSuccess={async (piId) => {
            const c = pendingCard;
            setPendingCard(null);
            try {
              await fireCardSaleEvent(c.eventId, piId, c.amountCents);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to record card sale");
            } finally {
              setCompleting(false);
              setCompletingMethod(null);
            }
          }}
          onCancel={() => {
            // PI was created but never confirmed; Stripe will auto-cancel
            // unconfirmed PIs after ~5 min. We don't actively cancel here
            // because the cashier might retry — they'd want a fresh PI.
            setPendingCard(null);
            setCompleting(false);
            setCompletingMethod(null);
          }}
        />
      )}
    </Screen>
  );
}

function SummaryLine({
  label,
  value,
  valueColor = colors.ink,
  onClear,
}: {
  label: string;
  value: string;
  valueColor?: string;
  onClear?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ color: colors.inkSoft, display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {label}
        {onClear && (
          <button
            onClick={onClear}
            style={{
              background: "transparent",
              border: "none",
              color: colors.inkFaint,
              fontSize: "0.95rem",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="Remove"
          >
            ×
          </button>
        )}
      </span>
      <span style={{ color: valueColor, fontFamily: "monospace", fontWeight: 700 }}>{value}</span>
    </div>
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

/* ------------------------------------------------------------------ */
/*  Post-sale receipt offer (inline on the success toast)               */
/* ------------------------------------------------------------------ */

interface ReceiptOfferProps {
  lastSale: {
    totalCents: number;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    items: CartLine[];
    method: "cash" | "card";
    customerName: string | null;
    customerEmail: string | null;
  };
  cfg: ServerConfig;
  staffName: string;
  mode: ConnectionMode;
}

function ReceiptOffer({ lastSale, cfg, staffName, mode }: ReceiptOfferProps) {
  const cap = capability(mode, "receipt_email");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(lastSale.customerEmail ?? "");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!cap.available) {
    return (
      <Muted style={{ marginTop: "0.4rem", fontSize: "0.72rem" }}>
        Receipt unavailable while {mode === "offline" ? "phone is offline" : "Store Ops is unreachable"}.
      </Muted>
    );
  }

  if (done) {
    return (
      <div style={{ marginTop: "0.4rem", color: colors.green, fontSize: "0.78rem", fontWeight: 700 }}>
        ✓ Receipt sent to {email}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: "0.4rem",
          background: "transparent",
          border: `1px solid ${colors.rule}`,
          borderRadius: "0.4rem",
          padding: "0.35rem 0.625rem",
          color: colors.cream,
          fontSize: "0.74rem",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        ✉ Email receipt
      </button>
    );
  }

  async function send() {
    if (!email.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(`${cfg.apiBaseUrl}/api/register/email-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
        body: JSON.stringify({
          email: email.trim(),
          items: lastSale.items.map((i) => ({
            name: i.name,
            quantity: i.qty,
            price_cents: i.priceCents,
          })),
          subtotal_cents: lastSale.subtotalCents,
          discount_cents: lastSale.discountCents,
          tax_cents: lastSale.taxCents,
          total_cents: lastSale.totalCents,
          payment_method: lastSale.method,
          customer_name: lastSale.customerName,
          staff_name: staffName,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Send failed (${res.status})`);
      }
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem", alignItems: "stretch" }}>
      <input
        type="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="customer@example.com"
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0.35rem 0.5rem",
          background: "rgba(0,0,0,0.3)",
          border: `1px solid ${colors.rule}`,
          borderRadius: "0.375rem",
          color: colors.ink,
          fontSize: "0.78rem",
          outline: "none",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void send();
        }}
      />
      <button
        onClick={send}
        disabled={!email.trim() || sending}
        style={{
          background: colors.orange,
          color: "#0a0a0a",
          border: "none",
          borderRadius: "0.375rem",
          padding: "0 0.75rem",
          fontWeight: 800,
          fontSize: "0.78rem",
          cursor: "pointer",
          opacity: !email.trim() || sending ? 0.4 : 1,
        }}
      >
        {sending ? "…" : "Send"}
      </button>
      {err && (
        <div style={{ color: colors.red, fontSize: "0.7rem", marginTop: "0.2rem" }}>{err}</div>
      )}
    </div>
  );
}
