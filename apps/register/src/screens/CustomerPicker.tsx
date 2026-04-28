/**
 * Customer-attribution modal. Search by name/phone/email, pick a result,
 * or create a new customer inline. Skip with "Continue as Guest".
 *
 * Capability: phone_internet — disabled tooltipped by the parent when offline.
 * (This screen assumes it's mounted only when the parent decided it's safe.)
 */

import { useEffect, useMemo, useState } from "react";
import { searchCustomers, createCustomer } from "../api";
import { Card, Button, H1, Muted, colors, fmtCents } from "../ui";
import type { Customer, ServerConfig } from "../types";

interface Props {
  cfg: ServerConfig;
  current: Customer | null;
  onPick: (c: Customer | null) => void; // null = guest / cleared
  onClose: () => void;
}

export function CustomerPicker({ cfg, current, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // New-customer form state
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);

  // Debounced search
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await searchCustomers(cfg, q);
        if (!cancelled) setResults(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cfg, q]);

  const headerLabel = useMemo(() => {
    if (q.trim()) return `${results.length} match${results.length === 1 ? "" : "es"}`;
    return "Recent customers";
  }, [q, results]);

  async function handleCreate() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const c = await createCustomer(cfg, {
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
      });
      onPick(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
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
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: "1rem",
          overflow: "hidden",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <H1>{showCreate ? "New customer" : "Attach customer"}</H1>
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

        {!showCreate && (
          <>
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, or email…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "0.875rem",
                background: "rgba(0,0,0,0.3)",
                border: `1px solid ${colors.rule}`,
                borderRadius: "0.5rem",
                color: colors.ink,
                fontSize: "1rem",
                outline: "none",
                marginBottom: "0.75rem",
              }}
            />

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <Button variant="ghost" onClick={() => onPick(null)} style={{ flex: 1 }}>
                {current ? "Switch to Guest" : "Continue as Guest"}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(true)} style={{ flex: 1 }}>
                + New customer
              </Button>
            </div>

            <Muted style={{ marginBottom: "0.5rem" }}>{loading ? "Searching…" : headerLabel}</Muted>

            {error && (
              <div style={{ color: colors.red, fontSize: "0.85rem", marginBottom: "0.5rem" }}>{error}</div>
            )}

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {results.length === 0 && !loading ? (
                <Card>
                  <Muted style={{ textAlign: "center" }}>
                    {q.trim()
                      ? "No matches. Try a different search, or create a new customer."
                      : "No customers yet. Create one to start tracking."}
                  </Muted>
                </Card>
              ) : (
                results.map((c) => {
                  const isCurrent = current?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onPick(c)}
                      style={{
                        background: isCurrent ? colors.orangeDim : colors.panel,
                        border: `1px solid ${isCurrent ? colors.orange : colors.rule}`,
                        borderRadius: "0.5rem",
                        padding: "0.75rem 0.875rem",
                        cursor: "pointer",
                        color: colors.ink,
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: colors.cream, fontWeight: 800, fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.name}
                        </div>
                        <div style={{ color: colors.inkSoft, fontSize: "0.74rem", marginTop: "0.1rem" }}>
                          {[c.phone, c.email].filter(Boolean).join(" · ") || "no contact info"}
                        </div>
                      </div>
                      <div style={{ marginLeft: "0.75rem", textAlign: "right", whiteSpace: "nowrap" }}>
                        {c.creditBalanceCents > 0 && (
                          <div style={{ color: colors.green, fontSize: "0.74rem", fontWeight: 700 }}>
                            {fmtCents(c.creditBalanceCents)} credit
                          </div>
                        )}
                        {c.loyaltyPoints > 0 && (
                          <div style={{ color: colors.amber, fontSize: "0.74rem", fontWeight: 700 }}>
                            {c.loyaltyPoints} pts
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        {showCreate && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              <FieldLabel>Name *</FieldLabel>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Jane Doe"
                style={inputStyle}
              />
              <FieldLabel>Phone</FieldLabel>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="555-123-4567"
                inputMode="tel"
                style={inputStyle}
              />
              <FieldLabel>Email</FieldLabel>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="jane@example.com"
                inputMode="email"
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ color: colors.red, fontSize: "0.85rem", marginTop: "0.75rem" }}>{error}</div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={creating} style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()} style={{ flex: 1 }}>
                {creating ? "Creating…" : "Create + attach"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: colors.inkSoft, fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>
      {children}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.75rem",
  background: "rgba(0,0,0,0.3)",
  border: `1px solid ${colors.rule}`,
  borderRadius: "0.5rem",
  color: colors.ink,
  fontSize: "1rem",
  outline: "none",
};
