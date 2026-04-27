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

export interface RegisterEvent {
  id: string;             // client-generated UUID
  lamport: number;
  wallTime: number;       // ms since epoch
  type: "cash_sale";      // R2 demo: only cash sales
  payload: CashSalePayload;
  status: EventStatus;
  conflictData?: unknown;
  errorMessage?: string;
}

export interface CashSalePayload {
  items: CartLine[];
  totalCents: number;
  staffId: string;
  paymentMethod: "cash";
}

export interface ServerConfig {
  apiKey: string;
  storeId: string;
  apiBaseUrl: string;     // typically https://www.afterroar.store
  deviceId: string;       // generated on first boot
}
