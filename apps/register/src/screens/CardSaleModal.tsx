/**
 * Live-mode card sale: collect a real card via Stripe Elements inside
 * the WebView. The PaymentIntent has already been created server-side
 * (returning clientSecret); this modal mounts <PaymentElement>, lets
 * the cashier swipe (well, type) the card, and confirms.
 *
 * Flow:
 *   1. parent calls createPaymentIntent → gets { paymentIntentId, clientSecret, status }
 *   2. if status='succeeded' (test mode auto-confirm), parent fires event directly
 *   3. else parent renders <CardSaleModal clientSecret=... />
 *   4. cashier enters card → onSuccess(piId) called → parent fires card_sale event
 *
 * Tap-to-Pay (NFC swipe-without-typing) needs the native Stripe Terminal
 * SDK and is a follow-up; this typed flow ships now so the demo can take
 * real money.
 */

import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button, H1, Muted, colors, fmtCents } from "../ui";

interface Props {
  publishableKey: string;
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

export function CardSaleModal(props: Props) {
  const stripePromise = useMemo<Promise<Stripe | null>>(
    () => loadStripe(props.publishableKey),
    [props.publishableKey],
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: props.clientSecret,
          appearance: {
            theme: "night",
            variables: {
              colorPrimary: "#FF8200",
              colorBackground: "#1f2937",
              colorText: "#e2e8f0",
              colorDanger: "#ef4444",
              fontFamily: "system-ui, sans-serif",
              borderRadius: "8px",
            },
          },
        }}
      >
        <CardForm {...props} />
      </Elements>
    </div>
  );
}

function CardForm({ paymentIntentId, amountCents, onSuccess, onCancel }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Allow back-button / hardware-back to dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  async function handleSubmit() {
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Card validation failed");
      setSubmitting(false);
      return;
    }
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (confirmError) {
      setError(confirmError.message ?? "Payment failed");
      setSubmitting(false);
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      onSuccess(paymentIntent.id ?? paymentIntentId);
      return;
    }
    setError(`Payment status: ${paymentIntent?.status ?? "unknown"}`);
    setSubmitting(false);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "1rem", overflow: "auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <H1>Card sale</H1>
          <Muted style={{ marginTop: "0.15rem" }}>{fmtCents(amountCents)}</Muted>
        </div>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            background: "transparent",
            border: "none",
            color: colors.inkSoft,
            fontSize: "1.5rem",
            cursor: submitting ? "not-allowed" : "pointer",
            padding: 0,
            lineHeight: 1,
            opacity: submitting ? 0.4 : 1,
          }}
          aria-label="Cancel"
        >
          ×
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <PaymentElement
          onReady={() => setReady(true)}
          options={{ layout: "tabs" }}
        />
      </div>

      {error && (
        <div
          style={{
            background: "rgba(239,68,68,0.15)",
            border: `1px solid ${colors.red}50`,
            borderRadius: "0.5rem",
            padding: "0.5rem 0.75rem",
            marginTop: "0.75rem",
            color: colors.red,
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <Button variant="ghost" onClick={onCancel} disabled={submitting} style={{ flex: 1 }}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!ready || submitting || !stripe || !elements}
          size="lg"
          style={{ flex: 2 }}
        >
          {submitting ? "Processing…" : `Charge ${fmtCents(amountCents)}`}
        </Button>
      </div>
    </div>
  );
}
