# Storm Test — register offline-mode demo runbook

End-to-end test that proves the register keeps working through:

- **State A — Normal**: everything online, sales flow normally
- **State B — Store Ops down**: phone has internet, Store Ops API unreachable; sales queue locally and sync when ops returns
- **State C — Fully offline**: phone has no internet; sales queue locally and sync when reconnected

Status indicator on the register tells the cashier which state they're in at every moment. No state silently drops sales.

## Pre-flight setup (one-time per device)

1. **Build + install** the register app:
   ```
   cd apps/register
   npm run build
   npx cap sync android
   npx cap open android
   ```
   ▶ Run from Android Studio onto a connected device.

2. **Set a PIN on Shawn's pos_staff record** — required because the register login is PIN-based, not Google. From Store Ops on a desktop browser:
   - `/dashboard/staff` → click on Shawn → "Set PIN" → choose 4 digits → save.
   - The PIN is stored as a SHA-256 hash on `pos_staff.pin_hash`.

3. **Bootstrap the register**:
   - Launch the register app on the phone. First-launch screen prompts for API key + store ID.
   - **API key**: from `C:\Users\shawn\OneDrive\Desktop\register-api-key-DELETE-AFTER-USE.txt` (minted earlier, prefix `ar_live_k79sxYgN`, scope `register:write`).
   - **Store ID**: `cmoegx80r000004i5ml460vn9` (FU Games & Cafe, your store).
   - Tap "Bootstrap" — pulls inventory + staff (with PINs) onto the device.

4. **Sign in** at the PIN screen with the PIN you just set.

5. You should land on the register home with inventory visible. Status banner should be absent (state A — online).

## Test 1 — State A baseline

1. Tap an inventory item. It appears in the cart.
2. Tap "Cash · $X.XX". Sale completes. Toast says "Sale complete · queued; will appear on dashboard within seconds."
3. Open `https://www.afterroar.store/dashboard/sales` in a browser. The sale should be visible within 30 seconds.
4. Settings → "Recent events" should show `cash_sale · APPLIED`.

## Test 2 — State B (Store Ops down)

Simulate ops being down without taking the phone offline:

**Option A: pause the Vercel deployment.**
- `vercel.com` → afterroar-ops → deployments → click the production deployment → "..." → "Disable Production Domain"
- Or: in the project settings, override the production-alias to a fake URL temporarily

**Option B: WAF block** — easier to revert.
- In Cloudflare (if your domain runs through it), add a temporary rule blocking your phone's IP.

**Option C: phone-side block** — cleanest for a demo.
- In the register's Settings, edit the API base URL to something invalid (e.g. `https://www.afterroar-down.store`). The app will fail to reach Store Ops but still have internet.
- Reset the URL when test is done.

Steps:
1. Trigger the block. Wait ~30 seconds for the next mode poll.
2. Status banner should change to **STORE OPS UNREACHABLE**.
3. Ring up another sale.
4. Toast says "queued; will appear on dashboard within seconds" — same path as state A from the cashier's perspective.
5. Settings → "Recent events" shows `cash_sale · PENDING`.
6. Lift the block. Within 30 seconds, the event status should flip to `APPLIED`.
7. Verify the sale appears on `dashboard/sales`.

## Test 3 — State C (fully offline)

1. Toggle airplane mode on the phone, or turn off WiFi + cellular.
2. Wait ~30 seconds for the next mode poll.
3. Status banner should change to **OFFLINE**.
4. Cart screen shows an additional warning: "OFFLINE — sale will sync when service returns."
5. Ring up a sale. Sale completes locally.
6. Settings → "Recent events" shows `cash_sale · PENDING`.
7. Toggle airplane mode off. The sync loop fires immediately on the `online` event.
8. Within ~10 seconds, event status flips to `APPLIED`.
9. Verify on the dashboard.

## What to look for

- **Status banner is always honest** — if you can't reach the server, the cashier knows.
- **Sales never disappear** — events persist in local SQLite even if the app is killed mid-state-C. Reopen, they're still pending; they sync when reconnected.
- **No double-applies** — even if you force a manual sync three times, the server marks the second + third attempts as `duplicate` (idempotency by `(deviceId, eventId)`).
- **Inventory decrements on the dashboard** — the same number on the register and on Store Ops `/dashboard/inventory` after sync.

## What's NOT in this demo

- **Card sales** — R3 needs Stripe Terminal integration. Demo uses cash sales only.
- **Multi-register conflicts** — only one register involved.
- **Owner reconciliation queue** — `/dashboard/reconciliation` exists but won't show anything for a clean demo (no oversold inventory, no negative balances). Force an oversold scenario by setting an inventory item's `quantity` to 0 and ringing up the same item — that produces a `conflict` row.
- **Staff role enforcement** — anyone with a PIN can ring up a sale in this demo. R3 will gate operations by role (cashier can sell, manager can refund, etc.).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Bootstrap returns 401 | API key wrong / revoked | Re-mint at `/admin/api-keys` |
| Bootstrap returns 403 "scope" | Key doesn't have `register:write` | Re-mint with the right scope |
| Login screen has no staff | No staff have PINs set | Set PIN on `pos_staff.pin_hash` via Store Ops |
| Status banner stuck on "OFFLINE" while online | `navigator.onLine` lying or `Network` plugin not initialized | Force-reload the app; check device's Settings → Network |
| Pending events never sync after reconnecting | Sync loop crashed | Settings → "Sync now" button to retry manually |
| Inventory shows 0 quantity after a few sales | Working as intended — dashboard reflects sold items | Refresh from server in Settings |
