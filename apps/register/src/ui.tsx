/**
 * Tiny styled primitives used across the register screens. Inline styles
 * keep the bundle small + the visual identity consistent without a
 * full design system. Dark, orange-accented, optimized for tablet
 * portrait at finger-friendly tap targets.
 */

import type { CSSProperties, ReactNode } from "react";

export const colors = {
  bg: "#0a0a0a",
  panel: "rgba(31, 41, 55, 0.7)",
  panelHi: "rgba(31, 41, 55, 0.95)",
  rule: "#1f2937",
  ink: "#e2e8f0",
  inkSoft: "#94a3b8",
  inkFaint: "#6b7280",
  cream: "#FBDB65",
  orange: "#FF8200",
  orangeDim: "rgba(255, 130, 0, 0.18)",
  green: "#10b981",
  amber: "#fbbf24",
  red: "#ef4444",
};

export function Screen({ children, padded = true }: { children: ReactNode; padded?: boolean }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(ellipse at top, rgba(255, 130, 0, 0.08), transparent 60%), #0a0a0a",
        color: colors.ink,
        padding: padded ? "1rem" : 0,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </main>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  size?: "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
}

export function Button({ children, onClick, variant = "primary", size = "md", disabled, type = "button", style }: ButtonProps) {
  const palette =
    variant === "primary"
      ? { bg: colors.orange, fg: "#0a0a0a", border: colors.orange }
      : variant === "danger"
      ? { bg: "transparent", fg: colors.red, border: colors.red }
      : { bg: "transparent", fg: colors.inkSoft, border: colors.rule };
  const padding = size === "lg" ? "1rem 1.5rem" : "0.75rem 1rem";
  const fontSize = size === "lg" ? "1.05rem" : "0.95rem";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: disabled ? colors.rule : palette.bg,
        color: disabled ? colors.inkFaint : palette.fg,
        border: `1px solid ${disabled ? colors.rule : palette.border}`,
        borderRadius: "0.5rem",
        padding,
        fontSize,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function Input(props: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean }) {
  return (
    <input
      type={props.type ?? "text"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "0.75rem",
        background: "rgba(0,0,0,0.3)",
        border: `1px solid ${colors.rule}`,
        borderRadius: "0.5rem",
        color: colors.ink,
        fontSize: "1rem",
        outline: "none",
      }}
    />
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: colors.panel,
        border: `1px solid ${colors.rule}`,
        borderRadius: "0.75rem",
        padding: "1rem",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 style={{ color: colors.cream, fontSize: "1.5rem", fontWeight: 900, margin: 0 }}>{children}</h1>;
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 style={{ color: colors.cream, fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>{children}</h2>;
}

export function Muted({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ color: colors.inkSoft, fontSize: "0.85rem", margin: 0, ...style }}>{children}</p>;
}

export function Pill({ children, color = colors.inkSoft, bg }: { children: ReactNode; color?: string; bg?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.2rem 0.5rem",
        borderRadius: "999px",
        background: bg ?? `${color}20`,
        color,
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

export function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
