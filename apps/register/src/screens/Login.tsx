/**
 * PIN keypad login. Cashier picks their name, enters PIN, the local
 * staff_cache pin_hash is checked offline.
 *
 * Hash format must match Store Ops' /api/clock PATCH (apps/ops):
 * bcryptjs at cost 10. bcryptjs is pure-JS so it runs in the WebView.
 */

import { useEffect, useMemo, useState } from "react";
import { compare as bcryptCompare } from "bcryptjs";
import { listStaff } from "../db";
import { Screen, Card, H1, Muted, colors } from "../ui";
import type { Staff } from "../types";

export function Login({ onSignedIn }: { onSignedIn: (staff: Staff) => void }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listStaff().then(setStaff);
  }, []);

  const onlyWithPin = useMemo(() => staff.filter((s) => s.pinHash), [staff]);

  async function tryPin(nextPin: string) {
    setPin(nextPin);
    setError(null);
    if (!selected || !selected.pinHash) return;
    if (nextPin.length < 4) return;
    const ok = await bcryptCompare(nextPin, selected.pinHash);
    if (ok) {
      onSignedIn(selected);
      return;
    }
    if (nextPin.length >= 8) {
      setError("Wrong PIN.");
      setPin("");
    }
  }

  if (!selected) {
    return (
      <Screen>
        <H1>Who's on register?</H1>
        <Muted style={{ marginTop: "0.25rem" }}>Tap your name to sign in.</Muted>

        <div style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {onlyWithPin.length === 0 ? (
            <Card>
              <Muted>
                No staff with PINs are cached on this device. Set PINs from
                Store Ops → Staff → set PIN, then re-sync this register.
              </Muted>
            </Card>
          ) : (
            onlyWithPin.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSelected(s);
                  setPin("");
                  setError(null);
                }}
                style={{
                  background: colors.panel,
                  border: `1px solid ${colors.rule}`,
                  borderRadius: "0.75rem",
                  padding: "1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  color: colors.ink,
                  textAlign: "left",
                }}
              >
                <div>
                  <div style={{ color: colors.cream, fontWeight: 800, fontSize: "1rem" }}>{s.name}</div>
                  <div style={{ color: colors.inkSoft, fontSize: "0.78rem", textTransform: "capitalize" }}>{s.role}</div>
                </div>
                <span style={{ color: colors.orange, fontSize: "1.25rem" }}>›</span>
              </button>
            ))
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <button
        onClick={() => {
          setSelected(null);
          setPin("");
          setError(null);
        }}
        style={{
          background: "transparent",
          border: "none",
          color: colors.inkSoft,
          fontSize: "0.85rem",
          cursor: "pointer",
          padding: 0,
          marginBottom: "1rem",
          alignSelf: "flex-start",
        }}
      >
        ← Back
      </button>
      <H1>Hi, {selected.name}</H1>
      <Muted style={{ marginTop: "0.25rem" }}>Enter your PIN.</Muted>

      <div
        style={{
          marginTop: "1.5rem",
          display: "flex",
          gap: "0.5rem",
          justifyContent: "center",
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].slice(0, Math.max(4, pin.length || 4)).map((i) => (
          <div
            key={i}
            style={{
              width: "1rem",
              height: "1rem",
              borderRadius: "50%",
              background: i < pin.length ? colors.orange : colors.rule,
            }}
          />
        ))}
      </div>

      {error ? (
        <div style={{ color: colors.red, fontSize: "0.85rem", textAlign: "center", marginTop: "0.75rem" }}>
          {error}
        </div>
      ) : null}

      <div
        style={{
          marginTop: "1.5rem",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "0.625rem",
          maxWidth: "320px",
          margin: "1.5rem auto 0",
        }}
      >
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((n, i) => {
          const isAction = n === "" || n === "⌫";
          if (n === "") return <div key={i} />;
          return (
            <button
              key={i}
              onClick={() => {
                if (n === "⌫") {
                  setPin(pin.slice(0, -1));
                  setError(null);
                  return;
                }
                if (pin.length >= 8) return;
                void tryPin(pin + n);
              }}
              style={{
                aspectRatio: "1.5",
                background: isAction ? "transparent" : colors.panelHi,
                border: `1px solid ${colors.rule}`,
                borderRadius: "0.75rem",
                color: colors.cream,
                fontSize: "1.5rem",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </Screen>
  );
}
