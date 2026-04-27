# Register offline modes — states A/B/C and the `offlinePaymentMode` setting

## The three states

When a register is running, exactly one of these is true at every moment:

| State | Phone has internet | Phone reaches Store Ops | Stripe path | Risk to store |
|---|---|---|---|---|
| **A — Normal** | ✓ | ✓ | Capture via Stripe Terminal, sale logged to Store Ops in real time | None |
| **B — Store Ops down** | ✓ | ✗ | Capture via Stripe Terminal (works fine), sale queued for sync when Store Ops returns | None — money is in store's Stripe balance, only inventory desync until sync |
| **C — Fully offline** | ✗ | ✗ | Stripe Terminal **deferred capture** — card data encrypted on device, auth attempted when reconnected | **Real risk** — if card declines later, store eats the loss |

State B is more common in practice than people expect. Vercel deploy hiccups, Neon connection-pool blips, CDN regional issues — all of these temporarily break "Store Ops reachable" while leaving "internet works" intact. Covering state B with zero customer-visible risk is the largest single SLA win.

## The per-store setting

```
PosStore.offlinePaymentMode: 'reject' | 'queue_when_online' | 'capture_at_risk'
```

| Value | Allows state A | Allows state B | Allows state C | Use case |
|---|---|---|---|---|
| `reject` | ✓ | ✗ | ✗ | High-fraud / high-ticket stores that prefer to refuse a sale rather than risk anything |
| `queue_when_online` (DEFAULT) | ✓ | ✓ | ✗ | Sensible baseline — covers transient Store Ops outages with no risk; refuses sales only when the phone has no internet at all |
| `capture_at_risk` | ✓ | ✓ | ✓ | Owner has explicitly opted into eating decline losses for the convenience of never refusing a customer |

The default is `queue_when_online` because that's the largest improvement with zero downside. `capture_at_risk` is opt-in and visible as a toggle in store settings with explicit framing of the tradeoff.

## State C — required UX guardrails

When state C is allowed AND we enter state C, the cashier UX **must**:

1. **Banner prominent on the register screen** — full-width, orange/yellow background, text reading something like "OFFLINE MODE — Card will be authorized when service returns" with the timestamp of last successful connection.
2. **Per-transaction acknowledgment** — completing a sale requires tapping a confirmation button labeled clearly: "Capture this sale offline (card may decline later)". No silent state-C captures, ever. The cashier explicitly signs off on each one.
3. **Receipt language** — printed/emailed receipts in state C include a line: "Card pending authorization — will complete when payment system reconnects." Customer is informed, not surprised when (if) a decline happens.
4. **Owner notification post-sync** — after a state-C capture syncs and either completes or declines, the owner gets a digest: "5 deferred captures from yesterday — 4 succeeded, 1 declined ($45.20). Customer phone: 555-1234." Action is on the owner, not lost in noise.

## State B — what the cashier sees

State B looks identical to state A from the cashier's perspective — sales complete, cards charge, receipts print. The only visual difference is a subtle indicator (small chip in the corner: "syncing later") that signals "Store Ops is catching up." No friction, no banners, because there's no risk.

Inventory updates and ledger entries land in the local register's event log; sync happens automatically when Store Ops returns.

## State A — the boring happy path

Sale rings up, Stripe captures, ledger entry posts to Store Ops, inventory decrements server-side, customer points update, receipt prints. No event log, no queue, no reconciliation needed. ~95% of operations should be in state A.

## Edge cases

- **Connection flaps mid-transaction** — register treats each sale as one atomic event. Don't split a sale across states. Detect state at sale start; if connection changes mid-flow, finish the sale in the state we started in. Re-detect on next sale.
- **Two registers in different states at the same store** — register A is online, register B is in state B. Both should work; their event logs sync independently. Inventory drift between the two is normal until sync.
- **Customer demands receipt while offline** — receipt prints immediately with deferred-status note. Customer can be re-emailed receipt with auth result later.
- **Cashier wants to verify a customer's loyalty balance** — cached locally from last sync. Banner says "as of [timestamp]". Stale data is acceptable for read; writes go to the event log.

## Settings UX

In Store Ops admin (`afterroar.store/dashboard/settings/payments`), surface the setting like this:

> **Offline payment behavior**
> When the register loses connection to our servers, what should happen?
>
> ⚪ **Refuse the sale** — Cashier sees an error. Most cautious.
> 🔘 **Queue the sale, charge the card normally (default)** — When you have internet, sales go through normally even if Store Ops is briefly down. No risk to you.
> ⚪ **Capture the card and authorize later** — Even with no internet at all, cashier can ring up sales. Card is charged when service returns. **You take the risk if a card declines.**

Default is the middle option. Bottom option requires confirmation dialog acknowledging "I understand declined cards become my loss."

## Implementation notes

- `offlinePaymentMode` lives on `PosStore.settings` JSON (we don't add a column for a setting that has 3 values).
- Register downloads the setting at startup + on every sync; cached locally so it's available offline.
- Stripe Terminal's offline-payments feature is the implementation primitive for state C — capture happens with `paymentIntent.confirm({ offline: true })`-style flow, queued in Stripe's SDK, automatically uploaded when the device reconnects.
- The reconciliation UI for post-sync results lives on `afterroar.store/dashboard/reconciliation` — see [`register-sync-architecture.md`](register-sync-architecture.md) for the broader sync model that this fits into.
