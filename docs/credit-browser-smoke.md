# Credit-aware checkout — manual browser smoke

Step-by-step browser smoke for the credit display + concurrency gate that
ships with `<Checkout>`. Run this on Base Sepolia against a deployed
credit-redemption LotPot integrator (PR
`lotpot/credit-redemption-and-fraud-guard` or later — needs the
`availableCredit(user)` view and the `LotPotFulfillmentSkipped` event).

## Pre-flight

- [ ] Credit-redemption LotPot integrator deployed on Sepolia. Note its address.
- [ ] MockMegapot from the same deploy (exposes `setRevertOnBuyTickets`).
- [ ] Demo merchant bot is running and accepting INR orders on circle 1.
- [ ] Your test EOA has ≥ 10 USDC + gas on Sepolia.
- [ ] The host app (e.g. `merchant-app/`) is wired with `fetchCredit` /
      `fetchPendingOrders` callbacks against the integrator. Reference
      implementation in the README §"Credit accounting".

## Seed credit

From the `p2p-checkout` repo:

```bash
DIAMOND_ADDRESS=0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9 \
USDC_ADDRESS=0x4095fE4f1E636f11A95820BA2bB87F335Bd1040d \
LOTPOT_INTEGRATOR_ADDRESS=<your credit-redemption integrator> \
MEGAPOT_ADDRESS=<matching MockMegapot> \
QUANTITY=2 \
npx hardhat run scripts/seed-lotpot-credit-sepolia.ts --network baseSepolia
```

Follow the printed hand-off: wait for bot accept, run `paidBuyOrder`, watch
credit appear on the proxy. Then run:

```bash
MEGAPOT_ADDRESS=<matching MockMegapot> \
npx hardhat run scripts/disarm-lotpot-mock.ts --network baseSepolia
```

so subsequent orders fulfill normally.

## Verify credit display (`credit > 0`, no pending)

- [ ] Open the host app's checkout page with `usdcAmount = 5_000_000n` (5 USDC).
- [ ] The pre-order screen shows an **Order** row at full price.
- [ ] A **Credit applied** row appears below with `−<your credit>` in fiat.
      The label includes `(X.XX USDC)` so the user sees the underlying USDC
      amount.
- [ ] **Subtotal** = `Order − Credit`, in fiat.
- [ ] **You pay** = subtotal + fee (when applicable).
- [ ] CTA reads `Pay <currency> <total>` — same shape as without credit,
      just deducted.

## Verify credit-only path (`credit ≥ usdcAmount`)

- [ ] Increase your credit so it exceeds `usdcAmount`. (Run the seed
      script twice if 2 USDC isn't enough, or set `QUANTITY=5`.)
- [ ] Open the checkout page with `usdcAmount ≤ credit`.
- [ ] **You pay** reads `Free (credit covers)`.
- [ ] CTA reads **Redeem credit**.
- [ ] Click it → host's `placeOrder` runs. Verify the integrator returned
      `creditOnly: true` with the host's chosen sentinel (LotPot uses
      `orderId: "0"`).
- [ ] Widget snaps directly to a **Credit redeemed** success screen — no
      "Finding merchant" flash.
- [ ] `onComplete` fires with the sentinel orderId.
- [ ] `availableCredit(me)` decreases by `usdcAmount`.

## Verify concurrency gate (`credit > 0` + same-amount pending)

- [ ] With credit > 0 already on your proxy, place an order at amount X.
      Let it sit in PLACED.
- [ ] Refresh the host app checkout with `usdcAmount = X` (same amount).
- [ ] Widget **auto-snaps to tracking** the pending order — no pre-order
      form, no Pay button. Stepper shows step 0.

## Verify concurrency gate (`credit > 0` + different-amount pending)

- [ ] With credit > 0 and a pending order at amount X still active, open
      the host app checkout with `usdcAmount = Y` where `Y ≠ X`.
- [ ] Widget renders the **"Finish your pending order first"** rejection
      screen with the pending order's ID + amount.
- [ ] Click **Resume that order** → `onResumeRequest(pendingOrderId)`
      fires; host should navigate the user to that order (e.g., re-open
      the widget with `orderId={pendingOrderId}`).
- [ ] Click **Close** → `onClose` fires; user can dismiss the rejection.

## Verify normal flow (`credit == 0`)

- [ ] After credit is fully redeemed (or before any has been seeded), the
      widget behaves identically to the pre-credit version:
  - [ ] No "Credit applied" row in the breakdown.
  - [ ] **You pay** equals the gross order total.
  - [ ] CTA reads `Pay <currency> <total>`.
  - [ ] Existing `<PaymentHistory>` resume flow still works for pending
        orders (no auto-snap, no rejection — host-driven resume).

## Edge cases

- [ ] `fetchCredit` throws / network error → widget treats as zero credit
      (form renders normally; no rejection). Verify in browser console
      that the error is logged but doesn't propagate to `onError`.
- [ ] `fetchPendingOrders` returns an empty array even though chain shows
      pending → widget shows the credit row but doesn't gate; user can
      place a new order. Acceptable — the host's pending query is the
      source of truth.
- [ ] Host omits one of the two callbacks → widget skips credit features
      entirely; runs the legacy flow.
