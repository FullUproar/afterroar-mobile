# Mobile strategy — phasing, platforms, prerequisites

## TL;DR

Build register first (revenue protection), Garmr second (personal watchdog), Passport third (consumer identity app). Android-first throughout — iOS adds real friction (Mac required, $99/yr Apple Developer Program, App Store review) and is a follow-on per app, not parallel.

## Why register first, not Garmr first

The original instinct was "build the watchdog first, learn Capacitor on a low-stakes app, then tackle register." Shawn flipped this for two reasons:

1. **Register is the SLA-protecting product moat.** The whole point of going to mobile is so the cashier keeps working when Vercel/Neon/network has a hiccup. That's what FLGS owners pay for. Garmr is a personal convenience for Shawn.
2. **The Stripe Terminal hardware integration is the riskiest unknown.** Discovering hardware-vs-Capacitor compatibility issues earlier is better than later. Pushing register through to R3 surfaces those risks while we still have runway to course-correct.

The "low-stakes practice" argument was real, mitigated by **staging register itself into three phases** — see below.

## Phasing

| Phase | App | Scope | Effort | Platforms |
|---|---|---|---|---|
| **R1** | register | Capacitor wrap of existing web register, online-only mode | 1–2 days | Android only |
| **R2** | register | Offline mode — local SQLite, event-sourced sync, Stripe Terminal SDK with offline payments, the per-store `offlinePaymentMode` setting + reconciliation UI | 5–10 days | Android only |
| **R3** | register | iOS port — Apple Developer Program enrollment, Mac/CI build setup, signing certs, App Store first-time review | 5–7 days (mostly Apple turnaround) | + iOS |
| **G**  | garmr | Phone-native uptime watchdog — single page polling 4 health endpoints, vibration + sound + push on failure | 1–2 days | Android only |
| **P**  | passport | Consumer app — push notifications, NFC/QR check-in, wallet-style passport | TBD | Android first → iOS |

Garmr is slotted between R2 and R3 — when we're waiting on Apple to approve the first iOS build, Garmr ships in parallel as a useful side-task.

## Why Android first

1. **One platform learning curve at a time.** Capacitor + Android Studio + Play Store first; iOS dance second.
2. **No money spent until Android proves out.** $99/yr Apple Developer Program + Mac purchase happen only at R3 — gated on register actually working.
3. **FLGS market reality.** Samsung Galaxy Tabs are common at the counter; iPad-only stores exist but aren't the majority. Android-only at launch isn't a meaningful market gap.
4. **Capacitor portability is high.** Adding iOS later is `npx cap add ios` plus the Apple paperwork — most React/Capacitor code works identically. We're not painting ourselves into an Android-only corner.

## What's needed for iOS (when we get to R3)

1. **Apple Developer Program** account — $99/year, 1–3 days for identity verification on first signup. Start the enrollment when R3 is on the immediate horizon, not before.
2. **Cloud Mac CI for builds.** Xcode is macOS-only and no Windows path exists, but for our usage profile (occasional iOS builds, ≤15/month at R3 cadence), **buying a Mac is wasted capital**. Use cloud:
   - **Codemagic** — best fit. Capacitor-friendly, 500 free build-minutes/month (about 25–40 iOS builds depending on size), $0.038/min after. Most R3 development fits in the free tier.
   - **GitHub Actions macOS runners** — already in the CI ecosystem we use for Android. Less generous on free minutes but most convenient if we want one workflow file managing both platforms. ~$0.16/min on paid tier.
   - **Bitrise** — established alternative, 200 free min/mo. Fine if Codemagic is unavailable.
3. **iPhone for real-device testing.** Cannot build iOS apps *on* an iPhone (Xcode is macOS-only), but can deploy builds to one for testing. Any modern iPhone works.

**Recommended path**: Codemagic free tier covers all of R3 development. If/when build volume genuinely outgrows it (months of regular iOS work, multiple developers), revisit. **Do not buy a Mac up front.** Buy the iPhone when convenient — different purchase, different reason (testing, not building).

## Stripe Terminal architecture decision (R2/R3)

Two paths considered:

- **(a) Wrap the existing server-side Stripe flow.** Simpler, but cannot do truly offline card capture.
- **(b) Use Stripe Terminal SDK directly on-device.** More work, but enables the offline payment flows described in [`register-offline-modes.md`](register-offline-modes.md).

**Decision: path (b)**, settled by the offline-mode requirements. The "we're fully offline and the customer needs to walk out with their stuff" use case (state C) is only achievable with on-device card capture + deferred upload. Path (a) couldn't support it.

Implementation: `@capacitor-community/stripe-terminal` plugin. Vetted at R2 start; if it's stale or broken, we wrap the native Stripe Terminal SDK ourselves via Capacitor's plugin authoring.

## What ships when

- **R1 ships first** — installable APK on cashier's tablet, identical to the web register but lives on the home screen. This alone is a meaningful improvement over visiting a URL.
- **R2 ships the actual product moat** — register that keeps working through outages.
- **R3 ships parity** — same product, both platforms.

Marketing-wise, R2 is the press release. R1 is the proof point. R3 is table stakes.

## Risk register

- **Stripe Terminal Capacitor plugin maintenance** — third-party, monitor health at R2 start. Fall-back: write our own plugin from Stripe's native SDK.
- **Apple App Store review** — first-time apps sometimes wait weeks. Mitigation: start enrollment + first iOS build early in R3 even if register isn't fully iOS-tested yet, so review clock starts ticking in parallel.
- **Hardware diversity** — Galaxy Tab generations, S22+, A-series; cheap Android tablets sold by box stores. Some have weird kernel quirks. Mitigation: test matrix in Capacitor's BrowserStack-equivalent (Sauce Labs, Firebase Test Lab) once R2 is real.
- **Cashier behavior under offline mode** — UX research is needed. The "OFFLINE — card will be charged later" banner has to be impossible to miss. Mitigation: actual store visit + watch a real cashier use it, before claiming R2 is done.
