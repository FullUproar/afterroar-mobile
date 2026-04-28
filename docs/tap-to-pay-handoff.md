# Tap-to-Pay on Android — Handoff

**Status: scaffolded, NOT activated.** The server-side connection-token endpoint and the
capability gate are in place. The Capacitor plugin and Android-side wiring are deferred
because they require an `minSdkVersion` bump that needed real-device testing time we
didn't have.

This doc is the runbook for the next session — written so a fresh Claude or you can pick
it up cold without re-discovering the moving parts.

---

## What's already in place

| Piece | Where | State |
|---|---|---|
| Connection-token endpoint (API-key auth) | [apps/ops/src/app/api/register/connection-token/route.ts](../ops-afterroar-store/apps/ops/src/app/api/register/connection-token/route.ts) | ✅ Ready |
| Capability bucket `card_sale` (phone_internet) | [apps/register/src/capability.ts](../afterroar-mobile/apps/register/src/capability.ts) | ✅ Ready |
| Live-mode Elements card UI | [apps/register/src/screens/CardSaleModal.tsx](../afterroar-mobile/apps/register/src/screens/CardSaleModal.tsx) | ✅ Ready (typed entry, no NFC) |
| `applyCardSale` server handler with PI verification | [apps/ops/src/lib/register-sync.ts](../ops-afterroar-store/apps/ops/src/lib/register-sync.ts) | ✅ Ready |
| `card_sale` event type + payload contract | [apps/register/src/types.ts](../afterroar-mobile/apps/register/src/types.ts) | ✅ Ready |

So everything *around* Tap-to-Pay is wired. The remaining work is swapping the typed-card
flow for the NFC flow when Tap-to-Pay is ready.

---

## What's missing

### 1. The Capacitor plugin

`@capacitor-community/stripe-terminal@^6.5.1` (Cap-6 compatible) is what we want. Its
TypeScript surface includes `TerminalConnectTypes.TapToPay`, which is the right value
for Android Tap-to-Pay-on-Phone (TTPA).

**Do NOT install it without doing the Android changes below first** — the plugin's
build will fail otherwise.

### 2. Android build config bumps

The plugin requires:

```diff
// apps/register/android/variables.gradle
- minSdkVersion = 22
+ minSdkVersion = 30      // Tap-to-Pay needs Android 11+
  compileSdkVersion = 34   // already set
+ kotlinVersion = '2.0.+'  // up from whatever Cap default
```

```diff
// apps/register/android/build.gradle (project-level)
+ buildscript {
+   ext.kotlin_version = '2.0.+'
+   repositories { google(); mavenCentral() }
+   dependencies {
+     classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"
+   }
+ }
```

```diff
// apps/register/android/app/build.gradle
android {
+  packagingOptions {
+    resources.excludes.add("org/bouncycastle/x509/*")
+  }
}
```

### 3. AndroidManifest permissions

```xml
<!-- apps/register/android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.NFC" />
```

The Bluetooth perms aren't strictly needed for TTPA-only, but they're cheap to leave in
and they're needed if/when we add a physical reader.

### 4. Stripe merchant approval (the slow gate)

Tap-to-Pay-on-Android requires the merchant's Stripe account to be approved by Stripe.
This is a manual review process:

1. Submit the application from the Stripe dashboard:
   <https://dashboard.stripe.com/terminal/locations> → "Apply for Tap to Pay on Android"
2. Stripe reviews business type, PCI scope, expected volume
3. Approval typically takes **2-5 business days**

Without approval, `discoverReaders({ type: 'tap-to-pay' })` returns an empty array even
on a supported device. **Test in test mode first** — test mode doesn't require approval.

### 5. Device requirements

- Android 11+ (API 30+)
- NFC chip (most phones since 2018)
- Google Play Services
- Listed in Stripe's [supported devices](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=android#supported-devices)

---

## Implementation plan (next session, ~3-4h)

### Step 1 — Install + wire (30min)

```bash
cd apps/register
npm install @capacitor-community/stripe-terminal@^6.5.1
```

Apply the Android changes from sections 2 + 3 above.

```bash
npx cap sync android
```

### Step 2 — Register-side terminal helper (45min)

Create `apps/register/src/terminal.ts`:

```ts
import {
  StripeTerminal,
  TerminalConnectTypes,
} from "@capacitor-community/stripe-terminal";
import type { ServerConfig } from "./types";

let initialized = false;

export async function initTerminal(cfg: ServerConfig, isTest: boolean) {
  if (initialized) return;
  await StripeTerminal.setConnectionToken({ token: await fetchConnectionToken(cfg) });
  await StripeTerminal.initialize({ isTest });
  // Re-fetch token on demand (the plugin calls our setConnectionToken())
  StripeTerminal.addListener("requestConnectionToken", async () => {
    const tok = await fetchConnectionToken(cfg);
    await StripeTerminal.setConnectionToken({ token: tok });
  });
  initialized = true;
}

async function fetchConnectionToken(cfg: ServerConfig): Promise<string> {
  const res = await fetch(`${cfg.apiBaseUrl}/api/register/connection-token`, {
    method: "POST",
    headers: { "X-API-Key": cfg.apiKey },
  });
  if (!res.ok) throw new Error(`connection-token failed: ${res.status}`);
  const data = await res.json();
  return data.secret;
}

export async function discoverTapToPay(): Promise<{ supported: boolean; reader?: unknown }> {
  const result = await StripeTerminal.discoverReaders({
    type: TerminalConnectTypes.TapToPay,
  });
  return { supported: result.readers.length > 0, reader: result.readers[0] };
}

export async function collectViaTapToPay(paymentIntent: string): Promise<void> {
  await StripeTerminal.collectPaymentMethod({ paymentIntent });
  await StripeTerminal.confirmPaymentIntent();
}
```

### Step 3 — Capability + UX swap (45min)

Add a new capability bucket for `card_sale_nfc` that's available only when:
- Mode is `online` or `ops-down`
- Tap-to-Pay was successfully discovered on init
- Stripe account has it approved (server-side flag — add to bootstrap response)

UX:
- Card button shows two sub-options: "Tap card" (NFC, primary) and "Type card" (Elements, fallback)
- When Tap is chosen, `collectViaTapToPay` opens the system NFC overlay
- On success, fire `card_sale` event with the resulting PI id
- On failure, offer to fall back to Elements

### Step 4 — Test mode loop (30min)

Stripe test mode supports a simulator card. Use `setSimulatorConfiguration` with a
test card type to validate the flow end-to-end without real cards.

### Step 5 — Bootstrap response flag (15min)

Add `tapToPayApproved: boolean` to the bootstrap response (default false). Read it
client-side to decide whether to show the Tap button at all. Wire it to the Stripe
account capability via `stripe.accounts.retrieve()` looking for `terminal_payments`
capability.

### Step 6 — Prod testing (45min — but only after approval)

- Test on a real Pixel 6+ (or similar approved device)
- Run a $0.50 test charge
- Verify the PI lands in /dashboard/sales as a card sale
- Verify capability gating: turn airplane mode on, the Tap button greys out

---

## Common gotchas

- **Test devices need Internet** even though the actual Tap action is NFC — the SDK
  authorizes through Stripe online.
- **Simulator mode in Android emulator doesn't actually render the system UI** —
  test-mode "simulated" cards work but the look-and-feel only appears on a real device.
- **The plugin uses an EVENT model** for some flows (`requestConnectionToken`,
  `paymentMethodCollected`, etc.) — set up listeners early in `initTerminal` so you
  don't miss the first event.
- **Stripe's Tap-to-Pay session has a max amount** (configurable per account — usually
  $5,000 default). Our register's per-cart cap should mirror this.
- **`discoverReaders` for Tap-to-Pay returns 0 readers** if the merchant isn't approved
  OR the device isn't supported — log both possibilities to telemetry.

---

## Why this isn't shipping tonight

| Issue | Reason |
|---|---|
| `minSdkVersion` bump 22→30 | Drops support for any device older than Android 11. Acceptable, but needs to be tested on the actual demo phone before shipping — too risky overnight. |
| Stripe merchant approval | Multi-day external process. Even with the code wired, it won't actually take a card until approved. |
| Real device testing | NFC + Tap-to-Pay don't work in the Android emulator. Need to test on Shawn's Pixel before declaring "done." |
| No fallback for declined approval | If Stripe denies, we need a graceful fallback. The Elements path (already shipped) IS the fallback, but the UX needs a "Tap to Pay unavailable on your device — falling back to typed entry" message that we haven't built yet. |

---

## Bonus: physical reader path (e.g. BBPOS WisePOS E)

The same plugin also supports `TerminalConnectTypes.Bluetooth` for the WisePOS E reader
(\$59-79). This is what'd be needed for State C (offline) card sales — the reader has
its own secure element that can capture cards without internet.

Same plugin, different connect type. The merchant just buys the reader, pairs it once
(in Settings), and it shows up as another option alongside Tap-to-Pay.

This is the right path for any FLGS that wants offline card sales. About 2h of UI work
once the plugin is wired in step 1 above.
