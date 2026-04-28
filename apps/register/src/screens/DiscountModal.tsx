/**
 * Cart-level discount modal. Cashier picks % or $ off the subtotal,
 * optionally enters a reason, applies. Applied discount is computed in
 * cents up front so the cart math stays simple.
 *
 * Future R3: line-item discounts, manager-override gate above a threshold.
 */

import { useMemo, useState } from "react";
import { Button, H1, Muted, colors, fmtCents } from "../ui";
import type { Discount } from "../types";

interface Props {
  subtotalCents: number;
  current: Discount | null;
  onApply: (d: Discount | null) => void;
  onClose: () => void;
}

const QUICK_REASONS = ["Returning customer", "Damaged", "Promo", "Comp", "Manager"];

export function DiscountModal({ subtotalCents, current, onApply, onClose }: Props) {
  const [kind, setKind] = useState<Discount["kind"]>(current?.kind ?? "percent");
  const [valueText, setValueText] = useState(current ? String(current.value) : "");
  const [reason, setReason] = useState(current?.reason ?? "");

  const parsed = useMemo(() => {
    const n = parseFloat(valueText);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (kind === "percent") return Math.min(100, n);
    return n; // dollars
  }, [valueText, kind]);

  const computedCents = useMemo(() => {
    if (parsed <= 0) return 0;
    if (kind === "percent") return Math.round((subtotalCents * parsed) / 100);
    return Math.min(subtotalCents, Math.round(parsed * 100));
  }, [parsed, kind, subtotalCents]);

  function handleApply() {
    if (computedCents <= 0) return;
    onApply({
      kind,
      value: parsed,
      reason: reason.trim() || undefined,
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "1rem", overflow: "auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <H1>Apply discount</H1>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: colors.inkSoft,
              fontSize: "1.5rem",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <Muted>Subtotal {fmtCents(subtotalCents)}</Muted>

        {/* Kind selector */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          {(["percent", "amount"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              style={{
                flex: 1,
                background: kind === k ? colors.orange : "transparent",
                color: kind === k ? "#0a0a0a" : colors.inkSoft,
                border: `1px solid ${kind === k ? colors.orange : colors.rule}`,
                borderRadius: "0.5rem",
                padding: "0.625rem",
                fontWeight: 800,
                fontSize: "0.95rem",
                cursor: "pointer",
              }}
            >
              {k === "percent" ? "% off" : "$ off"}
            </button>
          ))}
        </div>

        {/* Numeric input */}
        <div style={{ marginTop: "0.875rem", position: "relative" }}>
          <input
            autoFocus
            value={valueText}
            onChange={(e) => setValueText(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder={kind === "percent" ? "10" : "5.00"}
            inputMode="decimal"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "0.875rem 2.5rem 0.875rem 0.875rem",
              background: "rgba(0,0,0,0.3)",
              border: `1px solid ${colors.rule}`,
              borderRadius: "0.5rem",
              color: colors.cream,
              fontSize: "1.5rem",
              fontWeight: 800,
              outline: "none",
            }}
          />
          <span
            style={{
              position: "absolute",
              right: "0.875rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: colors.inkSoft,
              fontSize: "1.25rem",
              fontWeight: 800,
            }}
          >
            {kind === "percent" ? "%" : "$"}
          </span>
        </div>

        {/* Quick reason chips */}
        <Muted style={{ marginTop: "1rem" }}>Reason (optional)</Muted>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.4rem" }}>
          {QUICK_REASONS.map((r) => {
            const active = reason === r;
            return (
              <button
                key={r}
                onClick={() => setReason(active ? "" : r)}
                style={{
                  background: active ? colors.orangeDim : "transparent",
                  color: active ? colors.cream : colors.inkSoft,
                  border: `1px solid ${active ? colors.orange : colors.rule}`,
                  borderRadius: "999px",
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Or type a reason…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "0.625rem 0.75rem",
            marginTop: "0.5rem",
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${colors.rule}`,
            borderRadius: "0.5rem",
            color: colors.ink,
            fontSize: "0.95rem",
            outline: "none",
          }}
        />

        {/* Preview */}
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            background: colors.panelHi,
            borderRadius: "0.5rem",
            border: `1px solid ${colors.rule}`,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: colors.inkSoft }}>Discount</span>
          <span style={{ color: computedCents > 0 ? colors.orange : colors.inkFaint, fontWeight: 800 }}>
            {computedCents > 0 ? `-${fmtCents(computedCents)}` : "—"}
          </span>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          {current && (
            <Button variant="danger" onClick={() => onApply(null)} style={{ flex: 1 }}>
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={computedCents <= 0} style={{ flex: 1 }}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
