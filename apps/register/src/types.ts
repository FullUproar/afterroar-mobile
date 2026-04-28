/** Shared types across the register app. Mirror the server contract
 *  defined in apps/ops/src/lib/register-sync.ts. */

export type ConnectionMode = "online" | "ops-down" | "offline";

export interface InventoryItem {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
  sku?: string | null;
  category?: string | null;
  /** Primary scannable barcode (UPC/EAN). Used by the camera scanner. */
  barcode?: string | null;
  /** Alternate barcodes — publisher reprints with new UPCs, in-house labels. */
  barcodes?: string[];
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  pinHash: string | null;
}

export interface CartLine {
  inventoryItemId: string;
  name: string;
  qty: number;
  priceCents: number;
}

export type EventStatus = "pending" | "applied" | "conflict" | "duplicate" | "rejected";

export type RegisterEventType = "cash_sale" | "card_sale";

export interface RegisterEvent {
  id: string;             // client-generated UUID
  lamport: number;
  wallTime: number;       // ms since epoch
  type: RegisterEventType;
  payload: CashSalePayload | CardSalePayload;
  status: EventStatus;
  conflictData?: unknown;
  errorMessage?: string;
}

export interface Discount {
  /** "percent" → value is whole-percent (15 = 15%); "amount" → value is cents. */
  kind: "percent" | "amount";
  value: number;
  reason?: string;
}

interface SalePayloadBase {
  items: CartLine[];
  /** Sum of line prices before discount or tax. */
  subtotalCents: number;
  /** Resolved discount amount in cents (already computed from kind+value). */
  discountCents: number;
  /** The discount the cashier applied, if any. Kept for receipt + audit. */
  discount?: Discount | null;
  /** Tax computed on (subtotal - discount). 0 if tax_included_in_price. */
  taxCents: number;
  /** subtotal - discount + tax. Same as the ledger entry amount. */
  totalCents: number;
  staffId: string;
  customerId?: string | null;
}

export interface CashSalePayload extends SalePayloadBase {
  paymentMethod: "cash";
}

export interface CardSalePayload extends SalePayloadBase {
  paymentMethod: "card";
  /** Stripe PaymentIntent id, populated after the PI confirms 'succeeded'. */
  paymentIntentId: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  creditBalanceCents: number;
  loyaltyPoints: number;
}

export interface ServerConfig {
  apiKey: string;
  storeId: string;
  apiBaseUrl: string;     // typically https://www.afterroar.store
  deviceId: string;       // generated on first boot
}
