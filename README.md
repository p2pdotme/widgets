# @p2pdotme/widgets

[![npm version](https://img.shields.io/npm/v/@p2pdotme/widgets.svg)](https://www.npmjs.com/package/@p2pdotme/widgets)
[![npm downloads](https://img.shields.io/npm/dm/@p2pdotme/widgets.svg)](https://www.npmjs.com/package/@p2pdotme/widgets)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@p2pdotme/widgets)](https://bundlephobia.com/package/@p2pdotme/widgets)
[![CI](https://github.com/p2pdotme/widgets/actions/workflows/ci.yml/badge.svg)](https://github.com/p2pdotme/widgets/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Drop-in React widgets for the [P2P.me](https://p2p.me) checkout flow.
Users pay you in **local fiat** (UPI, PIX, SPEI, QRIS, …) — your contract
receives **USDC on Base**. Four widgets in one package:

- **`<Checkout>`** — the buy flow. User picks currency → pays merchant
  off-chain → your contract is paid USDC.
- **`<Cashout>`** — the sell / withdraw flow. User converts USDC they
  already hold on Base into local fiat. Integrator-agnostic — host
  supplies three callbacks (`placeCashout`, `deliverUpi`, optional
  `reconcile`); widget orchestrates the Diamond lifecycle.
- **`<PaymentHistory>`** — a subgraph-backed list of the connected user's
  orders. Auto-hides when there's nothing pending. Click "Resume" on a
  pending row to re-open `<Checkout>` in tracking-only mode.
- **`<Support>`** / **`<PaymentHistoryWithSupport>`** — per-order chat for
  disputes, wired against a self-hosted Chatwoot via the `p2pdotme/support`
  bridge. Wallet-signed sign-in, neutral identity labels between parties,
  one-line drop-in on history rows.

The widgets handle: order placement, **SDK circle routing** (optional —
no per-currency `circleId` plumbing required), status polling, encrypted
payment-detail delivery, an on-screen **fiat breakdown** (subtotal +
protocol fee + total, derived from on-chain price config), a **5-minute
auto-cancel countdown** on the accepted screen, "I've paid" confirmation,
cancellation, slippage limits, B2B fraud screening (opt-in), and the full
visual state machine. You provide the **signer**, the **integrator contract
address**, and (for buys) a `placeOrder` callback that emits a transaction.

```
+----------+      placeOrder()       +------------+    USDC on Base    +-----------+
|  buyer   | ----------------------> | integrator | -----------------> |  client   |
|  wallet  |    (your callback)      |   (yours)  |    on completion   | (yours)   |
+----------+                         +------------+                    +-----------+
      ^                                    |                                  |
      | local-fiat UPI/PIX/SPEI            | placeB2BOrder via UserProxy      | mints,
      | paid to merchant off-chain         | on the P2P Diamond               | grants
      |                                    v                                  v
      |                              +------------+
      +----------------------------->|  Diamond   |
            merchant-found order     |  (P2P)     |
                                     +------------+
```

---

## Status

`v0.1.0` — current API is stable for the documented props, but minor releases
may add props or events. Pin to a minor (`^0.1.0`) until 1.0.

## Install

```bash
npm i @p2pdotme/widgets
# or
pnpm add @p2pdotme/widgets
# or
yarn add @p2pdotme/widgets
```

Peer deps your app must have: `react@>=18`, `react-dom@>=18`, `viem@>=2`.

## Subpath exports

Each widget lives behind its own subpath so a host that only renders one
pays for one widget's bytes:

| Import path | Exports |
|---|---|
| `@p2pdotme/widgets` | Shared types + helpers — `CheckoutSigner`, `CurrencyOption`, `P2PError`, `P2PTheme`, `OrderStatus`, `parseOrderIdFromReceipt`, `useUserTxLimit`, `registerRevertSelectors`, validators, ABIs. **No widget components.** |
| `@p2pdotme/widgets/checkout` | `Checkout` + `CheckoutProps`, `CheckoutPhase`, `PlaceOrderContext`, `PlaceOrderResult`, `PendingOrderSummary`. |
| `@p2pdotme/widgets/cashout` | `Cashout` + `CashoutProps`, `CashoutPhase`, `PlaceCashoutContext`, `PlaceCashoutResult`, `DeliverUpiContext`, `ReconcileContext`. |
| `@p2pdotme/widgets/payment-history` | `PaymentHistory` + `PaymentHistoryProps`. |
| `@p2pdotme/widgets/support` | `Support`, `PaymentHistoryWithSupport` + `SupportProps`, `SupportSigner`, `SupportRole`, `SupportStatus`, `SupportSession`, Privy / Thirdweb signer adapters. |

```ts
// Buy flow only
import { Checkout } from "@p2pdotme/widgets/checkout";
import type { CheckoutSigner } from "@p2pdotme/widgets";

// Cashout-only host
import { Cashout } from "@p2pdotme/widgets/cashout";

// History widget anywhere
import { PaymentHistory } from "@p2pdotme/widgets/payment-history";

// Per-order support chat (drops into a history row, or stands alone)
import { Support, PaymentHistoryWithSupport } from "@p2pdotme/widgets/support";
```

Tree-shakers (Vite/Next/Webpack/esbuild) all honor the `exports` map, so
unused subpaths never ship in your bundle.

---

## Prerequisites

Before you can use this widget you need an **integrator contract** registered
on the P2P Diamond. The widget *does not* deploy contracts — it only drives
the user-side UX of an existing integrator.

| You need | What it is |
|---|---|
| **Integrator contract** | Your business logic on Base. Templates: `CheckoutIntegratorV2` (consumer purchases of an `ICheckoutClient`), `MarketplaceCheckoutIntegrator` (third-party clients identified by `msg.sender`, with optional sell-back), `LotPotCheckoutIntegrator`, etc. |
| **Diamond registration** | A super-admin call: `B2BGatewayFacet.registerIntegrator(integrator, usdcThroughIntegrator, proxyImpl)`. Talk to P2P to get this done. |
| **Currency / circle mapping** | Each currency is backed by a merchant *circle* on the Diamond. With SDK routing (pass `subgraphUrl` + `usdcAddress` + `usdcAmount`) you can leave `circleId` off — the widget picks one for you at place-order time. Hardcode `circleId` per currency only when you want to pin a specific merchant. |
| **Subgraph URL** (optional) | Read endpoint for SDK routing + `<PaymentHistory>`. Skip if you're using explicit `circleId` everywhere and don't need a history widget. |
| **Wallet signer** | Anything that can produce `{ to, data, gasLimit }` → signed tx hash. Privy embedded wallets and viem-native accounts are both supported via the `CheckoutSigner` adapter (see [Signer adapter](#signer-adapter)). |

> **Where to read more:** the contracts repo (under
> `contracts/CheckoutIntegratorV2.sol` and `contracts/MarketplaceCheckoutIntegrator.sol`)
> contains the interfaces you implement plus deploy/registration scripts.

---

## Quick start — Buy flow (`<Checkout>`)

The widget is **integrator-agnostic for buys**: you give it a `placeOrder`
callback that produces an `orderId`, and the widget takes over from there.
Pass `subgraphUrl` + `usdcAddress` + `usdcAmount` and you can omit
`circleId` from your currency list — the widget routes via the SDK.

```tsx
import {
  parseOrderIdFromReceipt,
  type CheckoutSigner,
  type CurrencyOption,
} from "@p2pdotme/widgets";
import {
  Checkout,
  type PlaceOrderContext,
  type PlaceOrderResult,
} from "@p2pdotme/widgets/checkout";
import { encodeFunctionData, stringToHex, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import {
  createLocalStorageRelayStore,
  createRelayIdentity,
} from "@p2pdotme/sdk/orders";

const INTEGRATOR_ADDRESS = "0x4eEe0701b53A031B510468fe4b9C6523Aa21613a"; // your integrator
const CLIENT_ADDRESS     = "0xF99216e437f04270D815563c548A0E4599207973"; // your client (V2-style)
const USDC_ADDRESS       = "0x4095fE4f1E636f11A95820BA2bB87F335Bd1040d"; // Base Sepolia USDC
const SUBGRAPH_URL       = "https://api.studio.thegraph.com/query/.../version/latest";
const PRODUCT_ID         = 1n;
const QUANTITY           = 1n;
const USDC_PRICE         = 5n; // $5 USDC per unit

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

// userPlaceOrder ABI of your integrator. Identical across all V2-shaped
// templates in the contracts repo.
const INTEGRATOR_ABI = [
  {
    name: "userPlaceOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "client", type: "address" },
      { name: "productId", type: "uint256" },
      { name: "quantity", type: "uint256" },
      { name: "currency", type: "bytes32" },
      { name: "circleId", type: "uint256" },
      { name: "pubKey", type: "string" },
      { name: "preferredPaymentChannelConfigId", type: "uint256" },
      { name: "fiatAmountLimit", type: "uint256" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
] as const;

// circleId omitted — the widget will route via the SDK using the routing
// inputs below. To pin a specific merchant circle for a currency, add
// `circleId: 1n` to its entry (mix-and-match is fine).
const CURRENCIES: CurrencyOption[] = [
  { symbol: "INR", flag: "🇮🇳", paymentMethod: "UPI" },
  { symbol: "BRL", flag: "🇧🇷", paymentMethod: "PIX" },
];

export function CheckoutDemo({ signer }: { signer: CheckoutSigner }) {
  const placeOrder = async (ctx: PlaceOrderContext): Promise<PlaceOrderResult> => {
    if (!ctx.currency) throw new Error("Currency not selected");
    // The widget guarantees `circleId` is resolved before invoking placeOrder
    // — either the explicit value you passed, or the SDK-routed one.
    if (ctx.currency.circleId === undefined) throw new Error("No circle resolved");

    // Persist a relay identity per browser. The merchant uses this pubkey to
    // encrypt their UPI/PIX details to the user.
    const store = createLocalStorageRelayStore();
    let identity = await store.get();
    if (!identity) { identity = createRelayIdentity(); await store.set(identity); }

    const data = encodeFunctionData({
      abi: INTEGRATOR_ABI,
      functionName: "userPlaceOrder",
      args: [
        CLIENT_ADDRESS, PRODUCT_ID, QUANTITY,
        stringToHex(ctx.currency.symbol, { size: 32 }),
        ctx.currency.circleId,
        identity.publicKey,
        0n, // preferredPaymentChannelConfigId — 0 = no preference
        0n, // fiatAmountLimit — 0 = no slippage check
      ],
    });

    const { hash } = await signer.sendTransaction({
      to: INTEGRATOR_ADDRESS, data, gasLimit: 1_500_000,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new Error("Tx reverted");

    const orderId = parseOrderIdFromReceipt(receipt as any);
    if (!orderId) throw new Error("orderId missing from receipt");
    return { orderId, txHash: hash };
  };

  return (
    <Checkout
      placeOrder={placeOrder}
      currencies={CURRENCIES}
      amount="5 USDC"
      productName="Common NFT"
      signer={signer}
      chainId={84532}
      // Routing inputs — required when any currency in `currencies` omits
      // `circleId`. The widget calls `placeOrder.prepare()` from the SDK
      // and forwards the resolved circleId into your `placeOrder` callback.
      subgraphUrl={SUBGRAPH_URL}
      usdcAddress={USDC_ADDRESS}
      usdcAmount={USDC_PRICE * 1_000_000n}
      onComplete={(orderId) => console.log("paid", orderId)}
      onCancel={(orderId) => console.warn("cancelled", orderId)}
      onError={(err) => console.error(err)}
    />
  );
}
```

Once the user clicks **Pay now**, the widget:

1. If `circleId` is missing on the picked currency, calls
   `@p2pdotme/sdk/orders` `placeOrder.prepare()` to route. Eligibility is
   scoped by the **gross fiat amount** the widget derives from
   `usdcAmount × buyPrice` (from on-chain `getPriceConfig`) plus the
   protocol's small-order fee where applicable.
2. Invokes your `placeOrder` callback with `ctx.currency.circleId`
   populated. You submit the integrator tx and return the `orderId`.
3. Polls `Diamond.getOrdersById(orderId)` for status changes.
4. On `ACCEPTED`: decrypts the merchant's UPI/PIX with the user's relay
   key, renders the payment QR + address, and starts a **5-minute
   auto-cancel countdown**.
5. User clicks **I've paid** → widget calls `Diamond.paidBuyOrder(orderId)`.
6. On `COMPLETED`: fires `onComplete` and shows a success state.

The pre-order screen renders a **fiat breakdown** (subtotal + additional
fee + total) sourced from on-chain config — see
[Built-in pricing & countdown](#built-in-pricing--countdown). Cancellation,
error, and "merchant didn't accept in time" states are handled automatically.

---

## Credit accounting (optional, integrator-agnostic)

Some integrators (e.g. `LotPotCheckoutIntegrator`) accumulate redeemable
USDC on a user's per-user proxy from previously-skipped fulfillments. The
widget surfaces this credit on the pre-order screen and enforces a
**concurrency rule** so a user can't place a second order while one is
still in flight.

### The rule

One in-flight order at a time: **any** pending order blocks a new
placement, regardless of amount or credit.

| Pending order on chain | Widget behavior |
|---|---|
| none                                 | normal flow (credit, if any, applies as a `Credit applied: −X` row, billing `max(usdcAmount − credit, 0)`) |
| any (same or different `usdcAmount`) | render the **"Finish your pending order first"** screen — the user must complete or cancel the pending order before placing another; a **Resume that order** button (when `onResumeRequest` is wired) takes them back to it |

Credit no longer affects the block / allow decision — it only drives the
pre-order breakdown. Stale legacy retail orders are filtered out so a
"pending forever" order can't permanently lock the user out.

When credit fully covers the order, the CTA changes to **Redeem credit**
and the host's integrator is expected to skip the Diamond entirely (LotPot's
`userPlaceOrder` does this when `credit >= total`, returning `orderId=0`).
The host returns `{ ..., creditOnly: true }` and the widget snaps to a
"Credit redeemed" success screen — no merchant polling.

### Plumbing it in

Two optional callbacks on `<Checkout>` — both must be set together:

```tsx
import { Checkout, type PendingOrderSummary } from "@p2pdotme/widgets/checkout";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

// Read your integrator's `availableCredit(user)` view. LotPot exposes it
// as a uint256 on the deployed integrator contract.
const LOTPOT_ABI = parseAbi([
  "function availableCredit(address user) view returns (uint256)",
]);

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const INTEGRATOR = "0xd1381f3e9a456da91Df1d178C7f1E91ef1Ec7056"; // your address

async function fetchCredit(user: `0x${string}`): Promise<bigint> {
  return (await publicClient.readContract({
    address: INTEGRATOR, abi: LOTPOT_ABI,
    functionName: "availableCredit", args: [user],
  })) as bigint;
}

// Pending orders: the host knows the full purchase intent for each order
// (Diamond stores only the credit-applied delta). For LotPot, the full
// intent lives on the integrator's `LotPotOrderCreated.totalUsdcAmount`
// event — query the subgraph or scan logs.
async function fetchPendingOrders(user: `0x${string}`): Promise<PendingOrderSummary[]> {
  const rows = await querySubgraph(/* … */);
  return rows
    .filter((r) => r.status === 0 || r.status === 1 || r.status === 2) // PLACED/ACCEPTED/PAID
    .map((r) => ({ orderId: r.orderId.toString(), usdcAmount: BigInt(r.totalUsdcAmount) }));
}

<Checkout
  signer={signer}
  placeOrder={placeOrder}        // unchanged — host submits the integrator tx
  currencies={CURRENCIES}
  usdcAmount={5_000_000n}        // 5 USDC
  fetchCredit={fetchCredit}
  fetchPendingOrders={fetchPendingOrders}
  onResumeRequest={(orderId) => {
    // Pending order exists: user clicked "Resume that order". Re-open the
    // widget in tracking-only mode by passing `orderId={orderId}` next time.
    setResumeOrderId(orderId);
  }}
  // … the rest of CheckoutProps
/>
```

The host's `placeOrder` callback signature is unchanged — the widget
doesn't pass credit info into the callback. The integrator handles
credit netting on-chain (LotPot reads `balanceOf(proxy)` inside
`userPlaceOrder` and nets the Diamond delta itself). The host should
return `{ creditOnly: true, orderId: "0" or sentinel, txHash }` only when
the on-chain redemption took the credit-only fast path (no Diamond
order placed).

> **No integrator-specific code in the widget.** The widget never imports
> a LotPot ABI; the callbacks above are the entire API. Plug the same
> callbacks in for any integrator that exposes its own equivalent of
> `availableCredit(user)` + full-intent pending-order metadata.

---

## Offramp flow (`<Cashout>`)

Convert USDC the user already holds on Base into local fiat (UPI, PIX,
SPEI, …). Same callback-shaped API as `<Checkout>` — the widget is
integrator-agnostic. It orchestrates the **Diamond-level** lifecycle
(auto-route circleId, poll status, encrypt the user's payment address)
and delegates the integrator-specific tx encoding to host callbacks.

```tsx
import { type CurrencyOption } from "@p2pdotme/widgets";
import {
  Cashout,
  type PlaceCashoutContext, type PlaceCashoutResult,
  type DeliverUpiContext, type ReconcileContext,
} from "@p2pdotme/widgets/cashout";

const CURRENCIES: CurrencyOption[] = [
  { symbol: "INR", flag: "🇮🇳", paymentMethod: "UPI" /* circleId optional */ },
  { symbol: "BRL", flag: "🇧🇷", paymentMethod: "PIX" },
];

<Cashout
  signer={signer}
  usdcAddress="0x4095fE4f1E636f11A95820BA2bB87F335Bd1040d"
  diamondAddress="0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9"
  // Required when any CurrencyOption omits circleId — widget routes via the SDK.
  subgraphUrl="https://api.studio.thegraph.com/query/.../graphql"
  currencies={CURRENCIES}
  defaultAmountUsdc={2_000_000n} // optional — pre-fills the amount input

  // Three host callbacks — see "Offramp callback contract" below.
  placeCashout={hostPlaceCashout}
  deliverUpi={hostDeliverUpi}
  reconcile={hostReconcile}

  onOrderPlaced={(id, hash) => console.log("placed", id, hash)}
  onComplete={(orderId) => console.log("paid out", orderId)}
  onCancelled={(orderId) => console.warn("refunded", orderId)}
  onError={(err) => console.error(err)}
/>
```

What the widget does, in order:

1. Reads the user's USDC balance for the "Max" affordance + insufficient-
   balance hint (standard ERC20 `balanceOf` — no integrator dependency).
2. Reads `getPriceConfig(currency).sellPrice` + `getSmallOrderThreshold` /
   `getSmallOrderFixedFeeSell` from the Diamond (with a fallback to the
   deprecated `getSmallOrderFixedFee` selector on pre-V22 Diamonds — see
   `readSmallOrderFixedFee`), renders the breakdown:
   `You receive = principal × sellPrice` in fiat (no deduction; Diamond
   leaves `actualFiatAmount` unchanged for SELL) and `Total charged =
   principal + fee` in USDC (Diamond pulls `actualUsdtAmount = principal
   + fee` at `setSellOrderUpi`). The fee is USDC-denominated, waived
   when `principal > smallOrderThreshold`.
3. On submit, if the selected currency has no `circleId`, calls
   `@p2pdotme/sdk` `placeOrder.prepare({ orderType: 1, … })` and harvests
   `prepared.meta.circleId`. Diamond-level operation — no integrator code.
4. Calls **`placeCashout`** — the host approves USDC + submits the
   integrator's place-offramp tx + parses the receipt for an `orderId`.
5. Polls `getOrdersById(orderId)`. On `ACCEPTED` (1) encrypts the user's
   payment address against the merchant's pubkey via the SDK, then calls
   **`deliverUpi`** — host submits the integrator's `deliverOfframpUpi`.
6. On `COMPLETED` (3) or `CANCELLED` (4), best-effort calls
   **`reconcile`** so the integrator can close out its bookkeeping.

### Integrator contract — selectors the widget expects

Your integrator needs three functions (names can be anything; the host
adapter is the only place the widget learns the actual ABI). Together
they bridge user wallet → Diamond:

1. **place-offramp** — pulls `amount` USDC from `msg.sender`, places a
   SELL on the Diamond as a B2B order via your system proxy, emits an
   event carrying `orderId`. Reference: `LotPotCheckoutIntegrator
   .userInitiateOfframp` in `p2p-checkout/contracts`.

2. **deliver-upi** — reads `getAdditionalOrderDetails(orderId)
   .actualUsdtAmount` (= principal + fee in USDC) from the Diamond,
   funds the system proxy with that amount, then has the proxy call
   `setSellOrderUpi(orderId, encUpi, 0)`. The widget passes the
   encrypted UPI blob in — your function never sees a plaintext address.

3. **reconcile** *(optional)* — once the Diamond reaches `COMPLETED`
   (3) or `CANCELLED` (4), sweeps any leftover USDC from the system
   proxy (cancellations refund the principal here) and updates your
   integrator's local order record. Skip if you don't keep bookkeeping
   on the integrator.

The widget itself never imports these ABIs. Your host wraps them in
the three callbacks described next.

> **Pool funding note.** The Diamond pulls `actualUsdtAmount` (principal
> + fee) at `setSellOrderUpi`. `userInitiateOfframp` only pulls the
> principal from the user. The fee comes from the integrator's USDC
> balance (the "pool"). On a fresh deploy, top up the integrator's USDC
> by at least a few hundred small-order fees, or `placeCashout` will
> revert with `OfframpInsufficientPool` on the first user.

### Offramp callback contract

Three callbacks. Required: `placeCashout`, `deliverUpi`. Optional:
`reconcile` (skip if your integrator doesn't expose it).

```ts
type PlaceCashoutContext = {
  /** Currency the user picked. `circleId` is guaranteed populated —
   *  either the value the host pinned, or one the SDK routed. */
  currency: CurrencyOption;
  /** Raw fiat payment address (UPI / PIX / etc). Do NOT submit on-chain
   *  — the widget will encrypt it and call `deliverUpi` later. */
  paymentAddress: string;
  /** Principal (6-decimal bigint). This is the `amount` you pass to the
   *  integrator's place-offramp tx — NOT what the user's wallet is
   *  debited. */
  usdcAmount: bigint;
  /** Small-order fixed fee (6-decimal bigint), `0n` when waived. The
   *  Diamond pulls `usdcAmount + feeUsdc` from `order.user` at
   *  `setSellOrderUpi`, so approve this total to your integrator. */
  feeUsdc: bigint;
  /** User's relay pubkey — pass to the integrator's place-offramp tx so
   *  the merchant knows what key to encrypt their fiat-receipt against. */
  userPubKey: string;
};

type PlaceCashoutResult = { orderId: string; txHash: string };
type DeliverUpiContext  = { orderId: string; encryptedUpi: string };
type ReconcileContext   = { orderId: string; status: number /* 3=COMPLETED, 4=CANCELLED */ };
```

### Reference implementation — `LotPotCheckoutIntegrator`

The merchant-app's `marketplace.tsx` is the canonical example (paste-able):

```ts
// Host-side: ABI fragments + helpers live in YOUR app, not the widget.
const LOTPOT_INTEGRATOR_ABI = [
  { name: "userInitiateOfframp", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" }, { name: "currency", type: "bytes32" },
      { name: "fiatAmount", type: "uint256" }, { name: "circleId", type: "uint256" },
      { name: "preferredPaymentChannelConfigId", type: "uint256" },
      { name: "userPubKey", type: "string" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }] },
  { name: "deliverOfframpUpi", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint256" }, { name: "encUpi", type: "string" }],
    outputs: [] },
  { name: "reconcile", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint256" }, { name: "currentStatus", type: "uint8" }],
    outputs: [] },
  // LotPot OfframpInitiated event for receipt parsing:
  { type: "event", name: "OfframpInitiated",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
    ] },
] as const;

const placeCashout = async (ctx: PlaceCashoutContext): Promise<PlaceCashoutResult> => {
  // 1. Approve USDC to the integrator if allowance is short. Approve the
  //    TOTAL (`principal + fee`) — Diamond pulls that much at setSellOrderUpi.
  const totalCharge = ctx.usdcAmount + ctx.feeUsdc;
  const allowance = await publicClient.readContract({ address: USDC, abi: ERC20_ABI,
    functionName: "allowance", args: [signer.address, INTEGRATOR] }) as bigint;
  if (allowance < totalCharge) {
    const { hash } = await signer.sendTransaction({
      to: USDC,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve",
        args: [INTEGRATOR, totalCharge] }),
      gasLimit: 100_000,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  // 2. Submit the integrator's place-offramp tx.
  const data = encodeFunctionData({
    abi: LOTPOT_INTEGRATOR_ABI, functionName: "userInitiateOfframp",
    args: [
      ctx.usdcAmount, stringToHex(ctx.currency.symbol, { size: 32 }),
      0n /* fiatAmountLimit */, ctx.currency.circleId!,
      ctx.currency.paymentChannelConfigId ?? 0n, ctx.userPubKey,
    ],
  });
  const { hash } = await signer.sendTransaction({ to: INTEGRATOR, data, gasLimit: 1_000_000 });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  // 3. Parse orderId from the integrator's OfframpInitiated event.
  const orderId = parseLotPotOfframpOrderId(receipt);
  if (!orderId) throw new Error("orderId not in receipt");
  return { orderId, txHash: hash };
};

const deliverUpi = async (ctx: DeliverUpiContext) => {
  const data = encodeFunctionData({
    abi: LOTPOT_INTEGRATOR_ABI, functionName: "deliverOfframpUpi",
    args: [BigInt(ctx.orderId), ctx.encryptedUpi],
  });
  const { hash } = await signer.sendTransaction({ to: INTEGRATOR, data, gasLimit: 500_000 });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash };
};

const reconcile = async (ctx: ReconcileContext) => {
  const data = encodeFunctionData({
    abi: LOTPOT_INTEGRATOR_ABI, functionName: "reconcile",
    args: [BigInt(ctx.orderId), ctx.status],
  });
  const { hash } = await signer.sendTransaction({ to: INTEGRATOR, data, gasLimit: 200_000 });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash };
};
```

For a different integrator (e.g., a custom one not following the LotPot
shape), the contract above is the same — only the ABI fragments and event
parser change. The widget never knows the difference.

### TradeStars offramp v2 (allocation-funded)

The TradeStars offramp funds the SELL from a **per-user-proxy allocation** (a
relayer moves vault USDC into the user's proxy after a Solana burn), not the
user's wallet USDC. Three differences vs the LotPot recipe:

1. **No USDC approve** — the proxy already holds the funds; `placeCashout` just
   calls `userStartOfframp(allocationId, …)`.
2. **`fetchAvailableOfframp`** sources the "Max" amount from the integrator's
   `availableOfframp(user)` view instead of the wallet balance.
3. **History** merges the user's per-user proxy (where `order.user` lives for
   offramps) via `<PaymentHistory resolveExtraAddresses=…>`.

```ts
const TRADESTARS_ABI = [
  { name: "userStartOfframp", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "allocationId", type: "uint256" }, { name: "currency", type: "bytes32" },
      { name: "fiatAmount", type: "uint256" }, { name: "circleId", type: "uint256" },
      { name: "preferredPaymentChannelConfigId", type: "uint256" }, { name: "userPubKey", type: "string" },
    ], outputs: [{ name: "orderId", type: "uint256" }] },
  { name: "userDeliverOfframpUpi", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint256" }, { name: "encUpi", type: "string" }], outputs: [] },
  { name: "syncOfframp", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint256" }], outputs: [] },
  { name: "availableOfframp", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "pendingAllocations", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256[]" }] },
  { name: "proxyAddress", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }], outputs: [{ type: "address" }] },
  { type: "event", name: "OfframpOrderPlaced", inputs: [
    { name: "allocationId", type: "uint256", indexed: true },
    { name: "orderId", type: "uint256", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false } ] },
] as const;

// Host picks an allocationId from pendingAllocations(user) before mounting <Cashout>.
const allocationId = /* selected pending allocation (a bigint) */;

<Cashout
  /* …usdcAddress, diamondAddress, signer, currencies, subgraphUrl… */
  fetchAvailableOfframp={(user) =>
    publicClient.readContract({ address: INTEGRATOR, abi: TRADESTARS_ABI,
      functionName: "availableOfframp", args: [user] }) as Promise<bigint>}
  placeCashout={async (ctx) => {                 // NO approve — proxy already funded
    const data = encodeFunctionData({ abi: TRADESTARS_ABI, functionName: "userStartOfframp",
      args: [allocationId, stringToHex(ctx.currency.symbol, { size: 32 }), 0n,
             ctx.currency.circleId!, ctx.currency.paymentChannelConfigId ?? 0n, ctx.userPubKey] });
    const { hash } = await signer.sendTransaction({ to: INTEGRATOR, data, gasLimit: 1_000_000 });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { orderId: parseTradeStarsOrderId(receipt) /* OfframpOrderPlaced */, txHash: hash };
  }}
  deliverUpi={async (ctx) => {
    const data = encodeFunctionData({ abi: TRADESTARS_ABI, functionName: "userDeliverOfframpUpi",
      args: [BigInt(ctx.orderId), ctx.encryptedUpi] });
    const { hash } = await signer.sendTransaction({ to: INTEGRATOR, data, gasLimit: 500_000 });
    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }}
  reconcile={async (ctx) => {                     // permissionless syncOfframp
    const data = encodeFunctionData({ abi: TRADESTARS_ABI, functionName: "syncOfframp",
      args: [BigInt(ctx.orderId)] });
    const { hash } = await signer.sendTransaction({ to: INTEGRATOR, data, gasLimit: 200_000 });
    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }}
/>

// Offramps are attributed to the user's proxy — merge it into history:
<PaymentHistory signer={signer} subgraphUrl={SUBGRAPH} usdcAddress={USDC}
  resolveExtraAddresses={async (user) => [
    (await publicClient.readContract({ address: INTEGRATOR, abi: TRADESTARS_ABI,
      functionName: "proxyAddress", args: [user] })) as `0x${string}`,
  ]} />
```

A cancelled offramp leaves the USDC in the user's proxy, so the `<Cashout>`
"Try again" button re-places from the same balance — self-serve retry, no
relayer/owner. See `payment-integrators/docs/OFFRAMP-V2.md` for the contract side.

> **Tip:** `userPubKey` is auto-generated from the SDK's relay identity
> (lazily persisted in localStorage). Hosts that already use `<Checkout>`
> share the same identity — no extra wiring required.

---

## Order history & resume (`<PaymentHistory>`)

A read-only widget that lists the connected user's orders from the
subgraph. Two common patterns:

- **Pending banner** on a home page (`filter="pending"`) — auto-hides when
  nothing's outstanding.
- **Full history page or drawer** (`filter="all"`) — shows everything,
  grouped into Pending / Past.

Click "Resume" on a pending row → host opens `<Checkout>` in
**tracking-only mode** with that orderId. The checkout widget polls the
chain and snaps directly to whichever screen the order is currently on
(no "Finding merchant" flash for already-accepted orders).

```tsx
import { useCallback, useState } from "react";
import { type CheckoutSigner } from "@p2pdotme/widgets";
import { Checkout } from "@p2pdotme/widgets/checkout";
import { PaymentHistory } from "@p2pdotme/widgets/payment-history";

export function HomePage({ signer }: { signer: CheckoutSigner }) {
  const [resumeOrderId, setResumeOrderId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey]       = useState(0);
  const [overrides, setOverrides]         = useState<Record<string, "completed" | "cancelled">>({});

  const onComplete = useCallback((id: string) => {
    setOverrides((p) => ({ ...p, [id]: "completed" }));
    setRefreshKey((k) => k + 1);
    setResumeOrderId(null);
  }, []);
  const onCancel = useCallback((id: string) => {
    setOverrides((p) => ({ ...p, [id]: "cancelled" }));
    setRefreshKey((k) => k + 1);
    setResumeOrderId(null);
  }, []);

  return (
    <>
      <PaymentHistory
        signer={signer}
        subgraphUrl={SUBGRAPH_URL}
        usdcAddress={USDC_ADDRESS}
        chainId={84532}
        filter="pending"               // banner: auto-hides when empty
        onResume={setResumeOrderId}
        refreshKey={refreshKey}        // bump to force refetch
        optimisticUpdates={overrides}  // bridge subgraph indexing latency
      />

      {resumeOrderId && (
        <Checkout
          orderId={resumeOrderId}      // tracking-only — no placeOrder needed
          signer={signer}
          chainId={84532}
          onClose={() => setResumeOrderId(null)}
          onComplete={onComplete}
          onCancel={onCancel}
        />
      )}
    </>
  );
}
```

### Smart auto-poll

The widget polls the subgraph every 15s **only while at least one order
is non-terminal**. A merchant accepting your order updates the status
badge automatically; when everything's terminal, polling stops. Tune or
disable with `pollIntervalMs` (set `0` to disable).

### Optimistic terminal updates

The subgraph has ~10–20s indexing latency. When `onComplete` /
`onCancel` fires from `<Checkout>`, pass that orderId into
`optimisticUpdates` — the history widget overlays the terminal status
immediately. The overlay is harmlessly redundant once the subgraph
catches up.

`refreshKey` is the matching imperative escape hatch: bumping it forces
an immediate refetch (useful from the same `onComplete` / `onCancel`
handlers).

### B2B-only history

By default the list shows **all** of the user's orders (retail + B2B). To
show only orders placed through a B2B integrator gateway, set `b2bOnly` —
or, to scope to specific integrators, pass `integrators`.

There's no separate "is this B2B?" flag on a plain order: B2B orders are
identified by a companion `b2Borders` subgraph query keyed on the connected
user, intersected with the order list. So this needs nothing beyond the
`subgraphUrl` you already pass.

**Adding integrator addresses.** The `integrators` allow-list takes the
**on-chain integrator contract address(es)** — the same address P2P
registered for you via `B2BGatewayFacet.registerIntegrator(...)` (see
[Prerequisites](#prerequisites)). It's your own integrator contract, so you
already have it (e.g. the `INTEGRATOR_ADDRESS` from the buy-flow example).
Matching is case-insensitive.

- **Omit `integrators` (or pass `[]`)** → every B2B order the user has, across
  *all* integrators, including ones P2P has since deactivated ("old"
  integrators). Useful for an ecosystem-wide "your P2P purchases" view.
- **Pass one or more addresses** → only B2B orders placed through those
  integrators. Passing a non-empty list implies `b2bOnly`, so you don't need
  both.

Since integrators are addresses on-chain (no names), pass `integratorNames`
to label them. The label only renders as a per-row tag when the visible list
spans **more than one** integrator — for a single-integrator list it's
suppressed as redundant.

```tsx
<PaymentHistory
  signer={signer}
  subgraphUrl={SUBGRAPH_URL}
  usdcAddress={USDC_ADDRESS}
  chainId={84532}
  filter="all"
  // Only this integrator's B2B orders (implies b2bOnly):
  integrators={["0x4eEe0701b53A031B510468fe4b9C6523Aa21613a"]}
  // Optional friendly labels (shown when >1 integrator is visible):
  integratorNames={{
    "0x4eEe0701b53A031B510468fe4b9C6523Aa21613a": "Acme Checkout",
  }}
/>
```

> **Pagination note.** The order list is fetched newest-first up to `limit`
> (default 20, mixing retail + B2B) and the B2B intersection is applied
> client-side. A user with more than `limit` total orders may not see older
> B2B orders — raise `limit` (max 100) for B2B-heavy histories.

### `<PaymentHistory>` props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `signer` | `CheckoutSigner` | ✅ | Used for `signer.address`. |
| `subgraphUrl` | `string` | ✅ | Read endpoint. |
| `usdcAddress` | `0x…` | ✅ | Forwarded to the SDK client. |
| `chainId` | `number` | — | Default `84532`. |
| `diamondAddress` | `0x…` | — | Defaults to Sepolia testnet Diamond. |
| `rpcUrl` | `string` | — | Custom RPC. |
| `limit` | `number` | — | Page size. Default `20`, max `100`. |
| `filter` | `"pending" \| "all"` | — | Default `"all"`. |
| `hideWhenEmpty` | `boolean` | — | Render `null` (no card) when nothing to show. Default `true` for `filter="pending"`, `false` otherwise. |
| `title` | `string` | — | Defaults to `"Pending orders"` for `filter="pending"`, `"Order history"` otherwise. |
| `style` | `CSSProperties` | — | Merged into the root card. Use for outer spacing that disappears with the card on auto-hide. |
| `onResume` | `(orderId) => void` | — | Click handler for the "Resume" button on pending rows. |
| `refreshKey` | `number \| string` | — | Bump to force an immediate refetch. |
| `optimisticUpdates` | `Record<string, "completed" \| "cancelled">` | — | Local terminal-status overlay. Pass a stable reference. |
| `pollIntervalMs` | `number` | — | Auto-poll cadence while pending exists. Default `15000`. `0` disables. |
| `b2bOnly` | `boolean` | — | Show only B2B orders. See [B2B-only history](#b2b-only-history). |
| `integrators` | `string[]` | — | Allow-list of integrator contract addresses (case-insensitive). Non-empty ⇒ implies `b2bOnly`. Omit/`[]` ⇒ all of the user's B2B orders across every integrator. |
| `integratorNames` | `Record<string, string>` | — | Address → display-name map for the per-row integrator tag. Case-insensitive; unmapped integrators fall back to a shortened address. |
| `theme` | `P2PTheme` | — | Optional visual overrides. See [Theming](#theming). |

---

## Per-order support (`<Support>` / `<PaymentHistoryWithSupport>`)

A wallet-authed chat thread per order, wired against a self-hosted
Chatwoot via the `p2pdotme/support` bridge service. Use it when a user
hits "raise dispute" or needs help on an in-flight order — both sides
land in the same thread with neutral, identity-masked labels
("Customer" ↔ "Order Fulfillment Partner") instead of swapping wallet
addresses or handles on Telegram.

Two surfaces ship from `@p2pdotme/widgets/support`:

- **`<Support>`** — a standalone launcher button + modal you drop next to
  any order surface.
- **`<PaymentHistoryWithSupport>`** — `PaymentHistory` with the launcher
  composed into every row. Also silently refreshes a bridge session on
  mount and decorates rows that have an open Chatwoot conversation with
  an "Active support" pip.

### Quick start

```tsx
import { PaymentHistoryWithSupport } from "@p2pdotme/widgets/support";
import type { CheckoutSigner } from "@p2pdotme/widgets";

export function OrdersDrawer({ signer }: { signer: CheckoutSigner }) {
  return (
    <PaymentHistoryWithSupport
      signer={signer}
      subgraphUrl={SUBGRAPH_URL}
      usdcAddress={USDC_ADDRESS}
      chainId={84532}
      filter="all"
      support={{
        signer,                                  // any CheckoutSigner works
        originApp: "merchant-demo",              // your app's slug
        bridgeUrl: "https://support-bridge.example.com",
        theme: CHECKOUT_THEME,                   // same P2PTheme as the rest
      }}
    />
  );
}
```

Or, standalone, alongside an existing tracker:

```tsx
import { Support } from "@p2pdotme/widgets/support";

<Support
  orderId={order.id}
  originApp="merchant-demo"
  signer={signer}
  bridgeUrl="https://support-bridge.example.com"
  disputeStatus={order.disputeStatus /* "none" | "open" | "resolved" */}
/>
```

### What happens on click

1. **Sign-in** — widget asks the signer for a personal_sign over
   `support.p2p.me:sign-in:<addr lowercased>:<chainId>:<ts>`, POSTs
   `{ address, chainId, timestamp, signature, orderId }` to
   `<bridgeUrl>/auth/sign-in`. `chainId` is resolved live from the
   connected wallet at sign time via `signer.getChainId()` (supplied by
   `fromPrivyWallet` / `fromThirdwebAccount`). It is mandatory and is bound
   into the signed message so the bridge can verify ERC-1271 / ERC-6492
   signatures on the right chain and reject cross-chain replays. There is no
   Base Sepolia (84532) default: sign-in throws before producing any
   signature if the chainId cannot be resolved (D-027-v3 §4). The 7-day session
   token is cached in `localStorage` (per `(bridgeUrl, address, orderId)`)
   so subsequent clicks are silent.
2. **Inbox resolution** — the bridge reads the order's on-chain
   `circleId`, looks up the per-circle Chatwoot inbox, and returns the
   widget's `chatwoot` session block (`websiteToken`, identifier HMAC,
   …) or `chatwoot: null` if no inbox is bound to that circle (e.g.
   pre-acceptance, or a circle that hasn't been provisioned).
3. **Chat** — widget boots the Chatwoot Web SDK against the resolved
   inbox, calls `setUser` with the identity HMAC, and hands the user off
   to Chatwoot's own iframe. The widget's modal auto-closes.

### States the modal can render

| State | When | UX |
|---|---|---|
| **Signing in** | First click, or after cache eviction | Spinner + "Approve the message request in your wallet" |
| **Loading chat** | Sign-in OK, booting Chatwoot SDK | Spinner + "Connecting to the Payment Support Team..." |
| **Support not available yet** | Bridge returned `chatwoot: null` (pre-acceptance, or circle has no inbox) | Explainer + **Retry** + **Close** — never silently closes |
| **Error** | Sign-in 4xx/5xx, network failure, user-rejected signature, or Chatwoot boot failure | Bucketed copy (`Authorization cancelled` / `Sign-in failed` / `Connection issue` / `Chat couldn't load` / `Something went wrong`) with raw cause as muted monospace detail + **Retry** + **Close** |

### Signer

`<Support>` accepts a `SupportSigner` — narrower than `CheckoutSigner`,
just `{ address, signMessage }`. Any `CheckoutSigner` with a working
`signMessage` is a valid `SupportSigner`, so the same wallet you pass to
`<Checkout>` works here. Convenience adapters ship from the same subpath:

```ts
import { fromPrivyWallet, fromThirdwebAccount } from "@p2pdotme/widgets/support";
```

### Bridge

The bridge service ([`p2pdotme/support`](https://github.com/p2pdotme/support))
is a thin Fastify server that does five things: wallet sign-in, on-chain
role lookup (`user` / `merchant` / `circle_admin` / `ops`), per-order
circle → inbox resolution, HMAC issuance for Chatwoot, and ticket sync.
It exposes:

- `POST /auth/sign-in` — wallet authentication; returns session token +
  Chatwoot binding for an order.
- `GET  /auth/me` — validates a cached session token (silent refresh).
- `GET  /tickets/me` — open conversations for the signed-in wallet
  (drives the "Active support" pip).

Self-host the bridge alongside your Chatwoot instance, then point
`bridgeUrl` at it. The widget bundle does **not** include the bridge.

### `<Support>` props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `originApp` | `string` | ✅ | Free-form slug shown in the modal header — your app name. |
| `signer` | `SupportSigner` | ✅ | `{ address, signMessage }`. A `CheckoutSigner` works. |
| `bridgeUrl` | `string` | ✅ | Base URL of your bridge service. Trailing slash optional. |
| `orderId` | `string` | — | When present, the bridge resolves the per-order inbox + conversation. Omit for general support. |
| `disputeStatus` | `"none" \| "open" \| "resolved"` | — | Drives the launcher label (`Support` / `View support` / `View resolution`) and a colored status dot. Default `"none"`. |
| `theme` | `P2PTheme` | — | Same theming surface as the rest of the widgets. |
| `onOpen` / `onClose` | `() => void` | — | Lifecycle hooks. |

### `<PaymentHistoryWithSupport>` props

Inherits every `<PaymentHistory>` prop, plus:

| Prop | Type | Required | Notes |
|---|---|---|---|
| `support` | `{ signer, originApp, bridgeUrl, theme? }` | — | When present, every row renders a Support launcher and the widget silently refreshes a bridge session on mount for the "Active support" pip. When omitted, behaves identically to `<PaymentHistory>`. |

---

## Signer adapter

The widget accepts a `CheckoutSigner` — a tiny abstraction that lets it work
with Privy, viem-native accounts, wagmi, or any wallet kit:

```ts
interface CheckoutSigner {
  address: `0x${string}`;
  sendTransaction: (tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    gasLimit?: number;
  }) => Promise<{ hash: `0x${string}` }>;
}
```

### Privy (embedded wallet, gas-sponsored)

```tsx
import { useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";

function useCheckoutSigner(): CheckoutSigner | null {
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const w = wallets[0];
  return useMemo(() => {
    if (!w) return null;
    const isEmbedded = w.walletClientType === "privy";
    return {
      address: w.address as `0x${string}`,
      sendTransaction: async (tx) => {
        const result = await sendTransaction(
          { to: tx.to, data: tx.data, gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined },
          { address: w.address, ...(isEmbedded ? { sponsor: true } : {}) }
        );
        return { hash: result.hash as `0x${string}` };
      },
    };
  }, [w, sendTransaction]);
}
```

### viem (private key / browser injected)

```ts
import { createWalletClient, custom, http } from "viem";
import { baseSepolia } from "viem/chains";

const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum!) });
const [address] = await wallet.requestAddresses();

const signer: CheckoutSigner = {
  address,
  sendTransaction: async (tx) => {
    const hash = await wallet.sendTransaction({
      account: address,
      to: tx.to,
      data: tx.data,
      gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    });
    return { hash };
  },
};
```

### wagmi

```ts
import { useAccount, useSendTransaction } from "wagmi";

const { address } = useAccount();
const { sendTransactionAsync } = useSendTransaction();

const signer: CheckoutSigner | null = address
  ? {
      address,
      sendTransaction: async (tx) => {
        const hash = await sendTransactionAsync({
          to: tx.to, data: tx.data,
          gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
        });
        return { hash };
      },
    }
  : null;
```

---

## Theming

Visual tokens (colors, radii, font) flow through `--p2p-*` CSS variables
with widget defaults baked in via `var(…, fallback)`. Integrators have two
ways to override:

### 1. CSS variables (preferred)

Set them on `:root`, on the modal trigger, or on any ancestor — normal
cascade rules apply. The widget picks them up automatically.

```css
:root {
  --p2p-color-bg:           #ffffff;  /* modal / card background */
  --p2p-color-surface-alt:  #f5f5f5;  /* inner panels (breakdown card, payment-details, picker active item, order-history rows) */
  --p2p-color-fg:           #0d1230;  /* primary text */
  --p2p-color-muted:        #6b7280;  /* secondary text */
  --p2p-color-border:       rgba(0, 0, 0, 0.10);
  --p2p-color-accent:       #2d5bff;  /* primary CTA + highlights */
  --p2p-color-accent-fg:    #ffffff;  /* primary CTA text */
  --p2p-color-success:      #00c896;
  --p2p-color-danger:       #e5484d;

  --p2p-radius-modal:       16px;     /* modal + larger card surfaces */
  --p2p-radius-button:      12px;     /* buttons, inputs, small surfaces */

  --p2p-font: "Inter", system-ui, sans-serif;
}
```

All twelve are optional. Any you don't set keep the widget's defaults.
The accent/success/danger "soft" tints (used for status badges, error
backgrounds, etc.) derive automatically from their base color via
`color-mix(in srgb, … 12%, white)` — so a custom accent gets a matching
halo without extra work.

> **Dark themes**: the default `--p2p-color-surface-alt` (`#f5f5f5`) is
> a near-white panel that works only when `--p2p-color-bg` is also
> light. For dark themes, override it to a faint tint of `bg` so inner
> panels stay readable:
> ```css
> --p2p-color-bg:          #0a0b0d;
> --p2p-color-surface-alt: rgba(255, 255, 255, 0.04);
> --p2p-color-fg:          #ffffff;
> ```

### 2. `theme` prop (for hosts without `:root` access)

Same variables, delivered as inline `style` on the widget root. Useful for
CSS-in-JS apps, sandboxed iframes, or hosts where editing global CSS isn't
practical. All three widgets accept the same prop shape:

```tsx
import { type P2PTheme } from "@p2pdotme/widgets";
import { Checkout } from "@p2pdotme/widgets/checkout";

const theme: P2PTheme = {
  colors: {
    accent:     "#2d5bff",
    accentFg:   "#ffffff",
    success:    "#00c896",
    danger:     "#e5484d",
    // Dark theme? Set bg + fg + surfaceAlt together so inner panels read.
    // bg:         "#0a0b0d",
    // fg:         "#ffffff",
    // surfaceAlt: "rgba(255, 255, 255, 0.04)",
  },
  radii: { modal: 16, button: 12 },
  font:  "Lato, system-ui, sans-serif",
};

<Checkout theme={theme} {/* ...other props... */} />
<PaymentHistory theme={theme} {/* ... */} />
<Cashout theme={theme} {/* ... */} />
```

Internally the prop is written to inline `style="--p2p-color-accent: …"`
on the widget root, so CSS-variable overrides set on an ancestor still
win if you mix both approaches.

### Font behavior

Default is `font-family: inherit` on the widget root — your app's
typography flows through automatically. To pin a specific font, set
`--p2p-font` (or pass `theme.font`). The widget never ships a webfont.
The monospace font used for addresses and order IDs stays fixed by
design.

### What's *not* themable

Per-component CSS overrides, density/spacing, icon swaps, and motion
controls are intentionally out of scope. The variable contract is
forward-compatible — additional `--p2p-*` vars can be added later
without breaking callers.

### Locale / i18n

Widgets ship built-in copy for **`en`** (fallback), **`es`**, and
**`pt-BR`**. Pass `locale` to pin a language; omit it to auto-detect
from `navigator.language` / `navigator.languages` (e.g. `es-MX` → `es`,
`pt` → `pt-BR`, anything else → `en`):

```ts
<Checkout locale="pt-BR" {/* ... */} />
<Cashout locale="es" {/* ... */} />
<PaymentHistory locale="en" {/* ... */} />
<Support locale="pt-BR" {/* ... */} />
```

Helpers `resolveLocale`, `t`, `translateError`, `useT`, and
`I18nProvider` are also exported from `@p2pdotme/widgets` for hosts that
need the same catalogs outside the widgets.

---

## Currency configuration

You decide which currencies your integrator accepts by passing a
`CurrencyOption[]`. `circleId` is **optional** — leave it off and the
widget routes via the SDK (requires `subgraphUrl` + `usdcAddress` +
`usdcAmount` on `<Checkout>`); set it to pin a specific merchant
circle for that currency. Mix-and-match is fine:

```ts
const CURRENCIES: CurrencyOption[] = [
  { symbol: "INR", flag: "🇮🇳", paymentMethod: "UPI" },                 // SDK-routed
  { symbol: "BRL", flag: "🇧🇷", paymentMethod: "PIX" },                 // SDK-routed
  { symbol: "MEX", flag: "🇲🇽", paymentMethod: "SPEI", circleId: 7n },  // pinned
];
```

> **`<Cashout>` requires explicit `circleId` on every currency** — only
> `<Checkout>` calls the SDK's routing path.

The widget ships built-in defaults for these symbols (label, validator,
placeholder for the offramp address input). You can override per currency:

```ts
{
  symbol: "INR",
  flag: "🇮🇳",
  paymentMethod: "UPI",
  validatePaymentAddress: (input) =>
    /^[\w.-]+@[\w.-]+$/.test(input) ? null : "Enter a valid UPI handle",
  paymentAddressPlaceholder: "name@bank",
  paymentChannelConfigId: 0n, // optional — preferred PPC id forwarded to the SDK router
}
```

Currencies the widget knows about out of the box: `INR`, `IDR`, `BRL`, `ARS`,
`MEX`, `VEN`, `NGN`. Others work too — pass any symbol/flag/paymentMethod
combo, the widget treats unknown symbols as a generic compound-field input
unless you provide a `validatePaymentAddress`.

---

## Built-in pricing & countdown

The widget reads two pieces of on-chain config when the user picks a
currency and surfaces them in the UI automatically — no host wiring
needed.

**`getPriceConfig(currency).buyPrice`** — 6-decimal fiat-per-USDC rate.
Used to derive what the user pays. The pre-order screen renders:

```
Subtotal              INR 855.00
Transaction Fee       INR 10.69
Waived on orders above 10 USDC.
─────────────────────────────
Total                 INR 865.69
```

`Total` is what the **Pay now** button displays (e.g. *"Pay INR 865.69"*)
and what the widget passes to the SDK routing call as the eligibility
filter. The user always receives the full `usdcAmount` — the fee is
charged on top, in fiat.

**`getSmallOrderThreshold(currency)` / `getSmallOrderFixedFeeBuy(currency)`** —
the "Transaction Fee" row. Orders ≤ threshold incur the fixed fee in USDC,
converted to fiat at the same `buyPrice`. V22 split the unified fee into
three per-order-type values; BUY now pays **half** the configured fee to
reduce buyer-side friction, while SELL/PAY pay the full fee (currently
**10 USDC threshold; 0.0625 USDC BUY / 0.125 USDC SELL** in prod for INR /
IDR / BRL — read dynamically per currency so this tracks any protocol
updates). Orders above the threshold pay zero (row hidden). The widget's
`readSmallOrderFixedFee` helper transparently falls back to the deprecated
`getSmallOrderFixedFee` selector on pre-V22 Diamonds, so the same build
works against both.

**`getAdditionalOrderDetails(orderId).acceptedTimestamp`** — drives a
**5-minute auto-cancel countdown** on the accepted screen. When time
runs out, the "I've paid" button is disabled with a *"Payment window
expired"* label. The widget keeps polling and surfaces the on-chain
cancellation when it lands.

To opt out of routing (and the breakdown derivation), pass explicit
`circleId` on every currency and skip `subgraphUrl` / `usdcAddress`.
The accepted-screen breakdown still renders, sourced from on-chain
`actualFiatAmount` and `fixedFeePaid`.

---

## Pricing the order in fiat (`fiatChargeAmount`)

By default you tell `<Checkout>` the order size in USDC (`usdcAmount`) and
the widget shows the user the fiat equivalent. Payment-gateway integrators
often think the other way round — *"collect ₹5,000 from this user"* — and
don't want to pre-compute USDC. Pass **`fiatChargeAmount`** instead and the
widget does the conversion:

```tsx
<Checkout
  placeOrder={placeOrder}
  currencies={[{ symbol: "INR", flag: "🇮🇳", paymentMethod: "UPI" }]}
  // The ALL-IN fiat total the user pays (6-dec), fee included.
  fiatChargeAmount={5000_000000n}   // ₹5,000.00
  subgraphUrl={SUBGRAPH_URL}
  usdcAddress={USDC_ADDRESS}
  signer={signer}
  /* … */
/>
```

- **All-in semantics.** `fiatChargeAmount` is the *total the user pays* —
  the protocol's small-order fee is **baked in**, not added on top. The
  widget reads `getPriceConfig(currency).buyPrice`, backs the fee out of the
  total, and derives the USDC order amount so the **"You pay"** line lands on
  the number you passed, **to the nearest micro-USDC** (integer-division
  rounding leaves at most a sub-cent residual). (Compare `usdcAmount`, where
  the fee is charged *on top* of the USDC you specify.)
- **Denomination.** The amount is denominated in the **selected** currency.
  For a single-currency picker this is unambiguous; for a multi-currency
  picker the amount is interpreted in whichever currency the user is paying
  with.
- **Timing.** Conversion needs the on-chain rate, so the **Pay** button stays
  in its *"Loading quote…"* state until the price config resolves. If that
  read fails, the widget shows a *"rate unavailable"* error rather than
  guessing an amount.
- **Too-small guard.** If the entered total is below the protocol fee (e.g.
  a ₹5 charge when the fee alone is ~₹5.19), there's no positive order to
  place — the widget blocks placement with an *"amount too small"* message
  instead of billing a zero/negative order.
- **Credit accounting.** If you also wire the [credit gate](#credit-accounting-optional-integrator-agnostic),
  the fee is re-decided on the post-credit delta (the amount that reaches the
  Diamond), so the all-in total absorbs exactly the fee the chain charges and
  the user pays `fiatChargeAmount − creditValue`. (Payment gateways typically
  don't wire credit, so this is a no-op for them.)
- **Pass exactly one** of `usdcAmount` or `fiatChargeAmount`. If both are set,
  `usdcAmount` wins and a dev warning is logged.

### Encoding the resolved amount in your `placeOrder`

Because the widget computes the USDC amount, your `placeOrder` callback
receives it back on the context — alongside the fiat total — so you can
encode it into your gateway tx:

```tsx
const placeOrder = async (ctx: PlaceOrderContext) => {
  // ctx.usdcAmount → resolved USDC order amount (6-dec)
  // ctx.fiatAmount → all-in fiat total (6-dec), = fiatChargeAmount
  const data = encodeFunctionData({
    abi: GATEWAY_ABI,
    functionName: "placePayment",
    args: [ctx.currency!.circleId!, ctx.usdcAmount!, /* … */],
  });
  const { hash } = await signer.sendTransaction({ to: GATEWAY_ADDRESS, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { orderId: parseOrderIdFromReceipt(receipt)!, txHash: hash };
};
```

`ctx.usdcAmount` / `ctx.fiatAmount` are populated in **both** modes (in
`usdcAmount` mode they echo the resolved values), so a callback written this
way works regardless of which amount input the host uses.

> ⚠️ **`ctx.fiatAmount` is the fee-*inclusive* gross** the user pays. If your
> integrator tx takes an on-chain `fiatAmount` that the Diamond uses to derive
> `price = fiatAmount / amount`, pass the fee-**exclusive** subtotal there
> (`ctx.usdcAmount × buyPrice`), **not** `ctx.fiatAmount` — encoding the gross
> against the subtotal amount skews the price ratio. When in doubt, encode only
> `ctx.usdcAmount` (as above) and let the Diamond quote the fiat.

---

## Reading integrator limits

Every integrator exposes a `userTxLimit()` view returning the per-tx USDC cap
(6-decimals). Two helpers ship with the package so you can render this value
in your product UI without rolling your own viem client.

### `useUserTxLimit` (React hook)

```tsx
import { useUserTxLimit } from "@p2pdotme/widgets";

function TxLimitBadge({ integrator }: { integrator: `0x${string}` }) {
  const { data, error, isLoading, refetch } = useUserTxLimit(integrator, {
    chainId: 84532, // optional, default Base Sepolia
  });

  if (isLoading) return <span>Loading limit…</span>;
  if (error)     return <button onClick={refetch}>Retry</button>;
  return <span>Max ${data?.formatted} per transaction</span>;
}
```

| Option | Type | Notes |
|---|---|---|
| `chainId` | `number` | Default `84532` (Base Sepolia). Pass `8453` for mainnet. |
| `rpcUrl` | `string` | Custom RPC. Defaults to viem's chain default. |
| `decimals` | `number` | Default `6` (USDC). Override if your integrator denominates the limit in a token with different decimals. |
| `enabled` | `boolean` | Default `true`. Set to `false` to skip the fetch (e.g. while the integrator address is still resolving). |

Returns `{ data, error, isLoading, refetch }` where `data` is
`{ raw: bigint; formatted: string }` — the raw on-chain value plus a
ready-to-render decimal string. The hook re-fetches automatically when
`integratorAddress`, `chainId`, `rpcUrl`, or `decimals` change, and drops
stale responses if the inputs change mid-flight. Pass `null`/`undefined` for
the address to short-circuit until it's ready.

### `fetchUserTxLimit` (one-shot)

For non-React contexts (server components, scripts, Node tooling):

```ts
import { fetchUserTxLimit } from "@p2pdotme/widgets";

const { raw, formatted } = await fetchUserTxLimit(INTEGRATOR_ADDRESS, {
  chainId: 84532,
  rpcUrl: "https://...",
});
// raw:       1000000000n  (USDC, 6-decimals)
// formatted: "1000"
```

The `INTEGRATOR_LIMITS_ABI` ABI fragment is also exported if you'd rather
wire the read into your own wagmi/viem setup (`useReadContract`, etc.).

---

## Order lifecycle (what the widget shows)

### Buy (`<Checkout>`)

| `phase` | When it's set | What's on screen |
|---|---|---|
| `checkout` | Initial render with a `placeOrder` callback | Pre-order screen: amount, product, currency picker, **fiat breakdown**, "Pay {total}" button |
| `placing` | `placeOrder` running (incl. SDK routing) | "Placing order…" with spinner |
| `placed` | tx confirmed; order = `PLACED` on Diamond | "Finding a merchant" — polls every 3 s for an accept |
| `accepted` | order = `ACCEPTED` (a merchant has matched) | **5-min countdown pill**, "Pay exactly X" hero with breakdown, decrypted UPI / payment details, copy buttons, **I've paid** button, cancel option. Polls every 15 s for on-chain cancellation. |
| `paid` | user clicked I've paid → `paidBuyOrder` succeeded | "Verifying your payment" — polls every 10 s for completion |
| `completed` | order = `COMPLETED` | Success screen → fires `onComplete` |
| `cancelled` | order = `CANCELLED` | "Order cancelled / refunded" with **Done** button → fires `onCancel` |
| `error` | Pre-order placement failure | Error message + retry/close → fires `onError`. Failures during `accepted`/`paid` actions (cancel, mark-paid) stay on-screen with an inline error — they don't reset the phase. |

### Offramp (`<Cashout>`)

| `phase` | When it's set | What's on screen |
|---|---|---|
| `form` | Initial render | Amount input (with balance + Max), currency picker, **"You receive X" preview**, payment-address input, "Withdraw {amount}" button |
| `placing` | `placeCashout` running (incl. SDK routing + preflight) | "Submitting withdrawal…" with spinner |
| `placed` | place-offramp tx confirmed; order = `PLACED` | "Finding a merchant" — polls every 3 s |
| `accepted` | order = `ACCEPTED` | "Sending payment details" — widget encrypts the payment address against the merchant's on-chain pubkey, then immediately calls `deliverUpi` |
| `encrypting` | encrypt + `deliverUpi` running | Same screen as `accepted`, spinner |
| `paid` | order = `PAID` (Diamond pulled USDC) | "Watch for {fiat} arriving via {paymentMethod}" — polls every 8 s for completion |
| `completed` | order = `COMPLETED` (merchant marked done) | "Withdrawn!" success screen → fires `onComplete`; widget then fires optional `reconcile` callback best-effort |
| `cancelled` | order = `CANCELLED` (refund) | "Order cancelled — USDC refunded" → fires `onCancelled`; `reconcile` fired best-effort |
| `error` | Encrypt / deliver / placement failure | If `orderId` exists → retry-from-accepted screen. Otherwise → "Couldn't place withdrawal" with **Back to form**. |

### Offramp flowchart

```
                              ┌──────────┐
                              │   form   │  user picks currency,
                              └────┬─────┘  amount, payment address
                                   │ submit
                                   ▼
              widget: SDK routes circleId (Diamond-level)
              host:   approve USDC + place-offramp tx → orderId
                                   │
                                   ▼
                              ┌──────────┐
                              │ placing  │
                              └────┬─────┘
                                   │ placeCashout returns
                                   ▼
                              ┌──────────┐  poll every 3 s
                              │  placed  │  ← merchant pool considers
                              └────┬─────┘
                                   │ Diamond: ACCEPTED
                                   ▼
              widget: encrypt payment-address against merchant pubkey
              host:   deliverUpi(orderId, encryptedBlob)
                                   │
                                   ▼
                              ┌──────────┐
                              │encrypting│
                              └────┬─────┘
                                   │ Diamond pulls USDC → PAID
                                   ▼
                              ┌──────────┐  poll every 8 s
                              │   paid   │  ← merchant pays fiat
                              └────┬─────┘     off-chain
                                   │ merchant calls completeOrder
                                   ▼
                              ┌──────────┐
                              │completed │  widget: reconcile(3) best-effort
                              └──────────┘

   ─ cancellation path (any non-terminal phase) ─
   Diamond auto-cancels on timeout (3 min PLACED / 30 min ACCEPTED|PAID).
   USDC refunded to the user automatically; widget shows the cancelled
   screen and fires reconcile(4) best-effort.
```

### What lives where

| | Widget (`@p2pdotme/widgets`) | Host (your app) |
|---|---|---|
| Diamond reads (status, price config, additional details) | ✅ | — |
| SDK circle routing via `placeOrder.prepare` | ✅ | — |
| Payment-address encryption against merchant pubkey | ✅ | — |
| Status polling + state-machine UI | ✅ | — |
| Resume-on-Pay + localStorage caching (buy) | ✅ | — |
| `userInitiateOfframp` / equivalent tx + ABI | — | ✅ |
| `deliverOfframpUpi` / equivalent tx + ABI | — | ✅ |
| `reconcile` / equivalent tx + ABI | — | ✅ |
| USDC `approve` to integrator | — | ✅ |
| OrderId event parsing from receipt | — | ✅ |

The widget never imports an integrator-specific ABI — all integrator I/O
flows through the three host callbacks. That's the bright line.

---

## API reference

### `<Checkout>` props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `signer` | `CheckoutSigner` | ✅ | Wallet abstraction. |
| `placeOrder` | `(ctx) => Promise<{ orderId, txHash }>` | one of these | Async callback that places the order and returns the orderId. |
| `orderId` | `string` | one of these | Tracking-only mode: widget skips placement and polls chain status. Walks forward from any phase, so resuming an already-`PAID` or `COMPLETED` order works. |
| `currencies` | `CurrencyOption[]` | — | Renders the in-widget currency picker. |
| `amount` | `string` | — | Display string e.g. `"5 USDC"`. |
| `productName` | `string` | — | Display string. Also used as the "for {productName}" subtitle on the accepted screen. |
| `paymentNotice` | `ReactNode` | — | Caller-controlled banner above "Pay now" (e.g. "gas sponsored"). |
| `subgraphUrl` | `string` | conditional | Required when any `CurrencyOption` omits `circleId` — used for SDK circle routing. |
| `usdcAddress` | `0x…` | conditional | Same — required for SDK routing. |
| `usdcAmount` | `bigint` | conditional | USDC amount the user is charged (6-dec); the protocol fee is added on top. Required for SDK routing; also drives the fiat breakdown when `subgraphUrl` is set. Pass this **or** `fiatChargeAmount`, not both. |
| `fiatChargeAmount` | `bigint` | conditional | **Fiat-denominated alternative to `usdcAmount`.** The all-in fiat total (6-dec, fee included) the user pays; the widget converts it to a USDC order amount via the selected currency's on-chain `buyPrice`. See [Pricing the order in fiat](#pricing-the-order-in-fiat-fiatchargeamount). Denominated in the selected currency. Blocks placement if the total can't cover the protocol fee. |
| `fiatAmount` | `bigint` | — | **Routing override** (not a price). When omitted, the widget derives it from on-chain `getPriceConfig(currency).buyPrice × usdcAmount` plus the small-order fee (gross). Pass this only to pin the SDK routing eligibility filter (e.g. a fixed-price promo); it does **not** change what the user pays. |
| `chainId` | `number` | — | Defaults to **84532 (Base Sepolia)**. Override for mainnet. |
| `diamondAddress` | `0x…` | — | Defaults to a Sepolia testnet Diamond. **Override for production.** |
| `rpcUrl` | `string` | — | Custom RPC for status polling. Defaults to viem's chain default. |
| `mode` | `"modal" \| "inline"` | — | Default `modal`. |
| `open` | `boolean` | — | Modal-only. |
| `demo` | `boolean` | — | See [Demo mode](#demo-mode). |
| `theme` | `P2PTheme` | — | Optional visual overrides — colors, radii, font. See [Theming](#theming). |
| `screening` | `ScreeningConfig` | — | Enables fraud-engine logging + post-tx link-order so the merchant app sees the order as screened. See [Fraud screening (B2B)](#fraud-screening-b2b). Requires `signer.signMessage`. |
| `onOrderPlaced` | `(orderId, txHash) => void` | — | Order fully placed on-chain. |
| `onComplete` | `(orderId) => void` | — | Order reached `COMPLETED`. |
| `onCancel` | `(orderId) => void` | — | Order reached `CANCELLED`. |
| `onError` | `(err) => void` | — | Any error during the flow. |
| `onClose` | `() => void` | — | User dismissed the modal. |

### `<Cashout>` props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `signer` | `CheckoutSigner` | ✅ | Same signer you use for buys. |
| `usdcAddress` | `0x…` | ✅ | For the "you have X USDC available" affordance + balance check. Standard ERC20 read — no integrator dependency. |
| `diamondAddress` | `0x…` | ✅ | Status polling + on-chain price-config reads + SDK setup. |
| `currencies` | `CurrencyOption[]` | ✅ | Currency picker. `circleId` optional — left off → SDK auto-routes (orderType=1). |
| `placeCashout` | `(ctx) => Promise<{ orderId, txHash }>` | ✅ | Host callback — approves USDC + submits the integrator's place-offramp tx + parses receipt. See [Offramp callback contract](#offramp-callback-contract). |
| `deliverUpi` | `(ctx) => Promise<{ txHash }>` | ✅ | Host callback — submits the integrator's `deliverOfframpUpi` (widget supplies the already-encrypted blob). |
| `reconcile` | `(ctx) => Promise<{ txHash }>` | — | Host callback — submits the integrator's `reconcile` once the Diamond hits a terminal status. Skip if your integrator doesn't expose it. Called best-effort (errors swallowed). |
| `chainId` | `number` | — | Default `84532`. |
| `rpcUrl` | `string` | — | Custom RPC. |
| `subgraphUrl` | `string` | — | Required when any `CurrencyOption` omits `circleId` — passed to the SDK for routing. |
| `fiatAmountLimit` | `bigint` | — | Slippage floor (6 decimals). `0` = no check. |
| `defaultAmountUsdc` | `bigint` | — | Pre-fills the amount input (6-dec). User can still edit. |
| `fiatPayoutAmount` | `bigint` | — | **Fiat-denominated withdrawal** (alternative to `defaultAmountUsdc`). The fiat the user should **receive** (6-dec); the widget computes the USDC to sell via the selected currency's on-chain `sellPrice`. The small-order fee is charged separately in USDC, so it doesn't reduce the payout. Hides the amount input. The sell-side analog of `<Checkout>`'s `fiatChargeAmount`. |
| `theme` | `P2PTheme` | — | Optional visual overrides. See [Theming](#theming). |
| `mode` / `open` / events | — | — | Same shape as `<Checkout>`. |

> Looking for `<PaymentHistory>` props? See its dedicated section
> [above](#order-history--resume-p2porderhistory).

### Helper exports

```ts
import {
  // widgets
  Checkout,
  Cashout,
  PaymentHistory,
  // event-decoding helper (for V2-shaped integrator buy receipts)
  parseOrderIdFromReceipt,
  // integrator reads (see "Reading integrator limits")
  useUserTxLimit,
  fetchUserTxLimit,
  INTEGRATOR_LIMITS_ABI,
  // Diamond + ERC20 read fragment (no integrator code)
  DIAMOND_ABI,
  DEFAULT_DIAMOND_ADDRESS,
  USDC_DECIMALS,
  ERC20_READ_ABI,
  // currency defaults
  DEFAULT_VALIDATORS,
  DEFAULT_PLACEHOLDERS,
  PAYMENT_METHOD_LABEL,
  FALLBACK_VALIDATOR,
  getValidatorFor,
  getPlaceholderFor,
  getPaymentLabelFor,
  // enum
  OrderStatus,
} from "@p2pdotme/widgets";
```

**The package ships no integrator-specific ABIs.** `MarketplaceCheckoutIntegrator`,
`LotPotCheckoutIntegrator`, etc. live in your host app — the widget never
imports them. See the [Offramp callback contract](#offramp-callback-contract)
for what the host has to provide.

Type-only exports include `CheckoutProps`, `CashoutProps`,
`PaymentHistoryProps`, `P2PTheme`, `CheckoutSigner`, `CheckoutPhase`, `CashoutPhase`,
`PlaceOrderResult`, `PlaceOrderContext`, `PlaceCashoutContext`,
`PlaceCashoutResult`, `DeliverUpiContext`, `ReconcileContext`,
`CurrencyOption`, `PaymentAddressValidator`, `ScreeningConfig`,
`ScreeningOrderDetails`, and `ScreeningUserDetails`.

---

## Fraud screening (B2B)

The widget can log every buy attempt to the p2p.me fraud engine and link the
on-chain `orderId` back once it's known. The merchant app then sees the order
as screened+approved and accepts it. Without this, merchants serving B2B
orders won't see screening metadata and will reject the order.

The B2B log endpoint is a **passthrough**: it persists the encrypted payload
and always returns approved — no SEON, watchlist, or risk scoring runs. It
exists so merchant-app's existing `/order-statuses` lookup uniformly answers
`screened: true, status: approved` for orders that came through the widget.

### Wiring

1. **Extend the signer adapter** with `signMessage` (and `signerAddress` if you
   use ERC-4337 smart wallets — point it at the admin EOA).

   ```ts
   const signer: CheckoutSigner = {
     address: wallet.address as `0x${string}`,
     sendTransaction: async (tx) => { /* ... */ },
     signMessage: (message) => wallet.signMessage({ message }),
     // signerAddress: wallet.adminEOA, // smart wallets only
   };
   ```

2. **Pass `screening`** to `<Checkout>`. Source the values from your env.

   ```tsx
   <Checkout
     signer={signer}
     placeOrder={placeOrder}
     screening={{
       apiUrl: import.meta.env.VITE_FRAUD_ENGINE_API_URL,
       encryptionKey: import.meta.env.VITE_FRAUD_ENGINE_ENCRYPTION_KEY,
       orderSource: "acme-checkout",
       orderDetails: { cryptoAmount: 5, fiatAmount: 415, currency: "INR" },
       userDetails: { country: "IN", loginMethod: "google" },
     }}
   />
   ```

### Env variables (consumer app)

The widget reads no env vars itself; you pipe these into the `screening` prop
from your app's env. Names below assume Vite — use `NEXT_PUBLIC_…` for Next.js
or `REACT_APP_…` for CRA.

| Variable | Required | What it is |
|---|---|---|
| `VITE_FRAUD_ENGINE_API_URL` | ✅ | Fraud-engine base URL **including the `/api/v1` prefix** (e.g. `https://fe.p2p.lol/api/v1`). |
| `VITE_FRAUD_ENGINE_ENCRYPTION_KEY` | ✅ | 64-char hex AES-256-GCM key. Must match the backend's `SEON_ENCRYPTION_KEY` for that environment. |
| `VITE_FRAUD_ENGINE_ORDER_SOURCE` | — | Free-form analytics tag stored on each activity log. |

If `screening` is omitted or `signer.signMessage` is missing, the widget runs
the existing `placeOrder` path with no screening (orders will not be visible
to the merchant-app screening lookup).

---

## Demo mode

`demo={true}` short-circuits the on-chain side: `placeOrder` runs, the widget
fakes a state machine (PLACED → 5s → ACCEPTED with sample UPI → user clicks
I've paid → 10s → COMPLETED → onComplete). Useful for design reviews and
local UX iteration without spending real testnet USDC.

```tsx
<Checkout demo placeOrder={async () => ({ orderId: "demo", txHash: "0x" })} signer={signer} />
```

---

## Error handling

Every failure inside the widget — placement, screening, encrypt-and-deliver,
mark-paid, cancel — is classified into a single `P2PError` (a subclass of
`Error`) and passed to your `onError` callback. The error carries:

```ts
class P2PError extends Error {
  readonly code: P2PErrorCode;       // stable identifier — branch on this
  readonly category: P2PErrorCategory; // "wallet" | "revert" | "network" | …
  readonly userMessage: string;       // safe to render in UI (jargon-free)
  readonly retryable: boolean;        // UI hint
  readonly context: P2PErrorContext;  // flow, chainId, user, orderId, currency, …
  readonly revertSelector?: string;   // 0x-4-byte, when category === "revert"
  readonly revertName?: string;       // decoded Solidity name (when registered)
  readonly revertData?: string;       // full 0x-prefixed revert blob
  readonly hint?: string;             // dev-facing actionable hint (in logs)
  readonly cause?: unknown;           // original thrown value
}
```

The widget surfaces `err.userMessage` to end users and logs a structured
`[p2p-widget:<flow>] <CODE>` entry at `console.error` with selector / hint /
context so it shows up in Sentry / DataDog without extra wiring.

### Recognized codes

| code | category | when |
|---|---|---|
| `WALLET_USER_REJECTED` | wallet | User dismissed the wallet prompt (EIP-1193 `4001`, viem `UserRejectedRequestError`). |
| `WALLET_INSUFFICIENT_FUNDS` | wallet | Wallet balance < tx value + gas. |
| `REVERT_KNOWN` | revert | On-chain revert whose 4-byte selector is in the registry (decoded name on `err.revertName`). |
| `REVERT_UNKNOWN` | revert | On-chain revert with an unrecognized selector — register it to get a friendly message next time. |
| `NETWORK_RPC_UNREACHABLE` / `NETWORK_TIMEOUT` | network | RPC fetch failed / timed out. |
| `ROUTING_NO_MERCHANTS` | routing | SDK couldn't pick a circle (replaces internal "No eligible circles" jargon). |
| `ROUTING_MISSING_INPUTS` | validation | You omitted `circleId` but also didn't pass `subgraphUrl` + `usdcAddress` + an amount (`usdcAmount` or `fiatChargeAmount`). |
| `SCREENING_API_ERROR` | screening | Fraud-engine returned non-2xx. **Fail-open** — the order still proceeds. |
| `ENCRYPTION_PREFLIGHT_FAILED` / `ENCRYPTION_FAILED` | encryption | Crypto polyfills missing, or encrypt step failed at ACCEPTED handoff. |
| `ORDER_BAD_STATUS` | order | You tried to retry-deliver an order that's no longer in `ACCEPTED`. |
| `UNKNOWN` | unknown | Fall-through. The original message is still in `err.userMessage`. |

### Branching on the code

```tsx
import { P2PError } from "@p2pdotme/widgets";
import { Checkout } from "@p2pdotme/widgets/checkout";

<Checkout
  /* … */
  onError={(err) => {
    if (err instanceof P2PError) {
      switch (err.code) {
        case "WALLET_USER_REJECTED":
          // User cancelled — don't show a scary toast.
          return;
        case "REVERT_KNOWN":
          analytics.track("checkout_revert", { name: err.revertName });
          break;
        case "ROUTING_NO_MERCHANTS":
          analytics.track("checkout_no_liquidity", err.context);
          break;
      }
      toast.error(err.userMessage);
    } else {
      toast.error("Something went wrong");
    }
  }}
/>;
```

### Decoding integrator-specific reverts

The widget ships a default registry covering the **P2P Diamond order-flow
selectors** and the **B2B Gateway custom errors** (`B2BProxyAddressMismatch`,
`B2BIntegratorInactive`, `B2BIntegratorRejectedOrder`, …). When the host
integrator defines its own custom errors, register them once at app startup
so the widget can decode them by name in logs and show a friendly user
message instead of "The transaction reverted on-chain for an unrecognized
reason":

```ts
import { registerRevertSelectors } from "@p2pdotme/widgets";

// One-time, at app boot.
registerRevertSelectors({
  // selector is the first 4 bytes of keccak256("ErrorName(arg1,arg2)").
  // `cast sig "ErrorName(uint256)"` will print it for you.
  "0xabcd1234": {
    name: "MyIntegratorRejected",
    userMessage: "Your account hasn't been onboarded for this merchant yet.",
    hint: "Check the integrator's allowlist / KYC flag for this address.",
    retryable: false,
  },
});
```

If a revert comes through with an unrecognized selector, the structured log
line includes the decoded selector + an `https://openchain.xyz/signatures`
lookup URL so you can identify it and add it to the registry in the next
release.

### Debugging tools

- `classifyError(err, ctx?)` — pure function, returns a `P2PError`. Useful
  when you have your own catch sites (the host `placeOrder` body) and want
  the same classification.
- `logP2PError(err)` — emits the same structured `console.error` shape the
  widget uses internally.
- `lookupRevertSelector("0x...")` — read-only lookup against the registry.

---

## Troubleshooting

**"Execution reverted for an unknown reason" / tx reverts immediately**
Check the browser console — the widget logs a `[p2p-widget:place-buy] REVERT_*`
entry with the decoded selector, name, and a hint. For B2B Gateway custom
errors the most common cause is the integrator was deactivated, was
registered with the wrong `proxyImpl`, or its `validateOrder` rejected the
amount (`B2BIntegratorRejectedOrder` ⇒ per-user / daily tx limit hit). See
`docs/lotpot-credit-integrator-revert.md` for the full proxy-impl-mismatch
runbook. For an unrecognized selector, decode it with `cast 4byte 0x…` and
add it to the registry via `registerRevertSelectors`.

**Order stays in `PLACED` forever**
No merchant accepted within the Diamond's order-expiry window (typically 30
min). The order will auto-cancel; the widget will surface `CANCELLED` and
fire `onCancel`. If this happens often, there's no merchant capacity in
your `circleId` for that currency — talk to P2P.

**`Public Key could not be parsed` from the merchant side**
You're passing an invalid `pubKey` to `userPlaceOrder`. The pubkey must be a
valid uncompressed secp256k1 point (128 hex chars, no `0x04` prefix). Use
`createRelayIdentity()` from `@p2pdotme/sdk/orders` — never pass a placeholder
or all-zero string.

**`USDC remainder` event firing on every order**
Expected. The user's `UserProxy` auto-refunds any USDC residue back to the
EOA after each order. If your client charges less than the integrator
forwards, the difference comes back automatically — that's the event.

**Widget shows the buyer's old address after a Privy account-switch**
The `signer` prop is read on each render, so a parent re-render with the new
signer flushes the state. If you cache the signer in a memo, make sure the
deps include the wallet address.

**`<PaymentHistory>` still shows a just-completed order as "Awaiting payment"**
The subgraph has ~10–20s indexing latency. Forward the orderId from
`<Checkout>`'s `onComplete` / `onCancel` into the history widget's
`optimisticUpdates` prop and bump `refreshKey` — the row flips status
immediately and reconciles with the subgraph on the next fetch. See
[Optimistic terminal updates](#optimistic-terminal-updates).

**SDK routing throws "Routing requires subgraphUrl, usdcAddress, and an amount"**
You left `circleId` off some `CurrencyOption` but didn't pass the routing
inputs to `<Checkout>`. Either add `circleId` to that currency or pass
`subgraphUrl` + `usdcAddress` + an amount (`usdcAmount` **or**
`fiatChargeAmount`). `fiatAmount` is optional — when missing the widget
derives the routing filter from on-chain `getPriceConfig`.

---

## Local development against a private fork

```bash
git clone https://github.com/p2pdotme/widgets
cd widgets
npm install
npm run build       # tsup → dist/{index,checkout,cashout,payment-history}.{js,cjs,d.ts}
npm pack --dry-run  # preview what will be published
```

To consume the local build from another app:

```bash
# in the widget repo
npm pack
# copy the .tgz path, then in your app:
npm i /path/to/p2pdotme-widgets-0.1.0.tgz
```

---

## Versioning

Semver. `0.x` minor releases may add props but won't change existing prop
shapes. `1.0` will commit to a stable surface.

## License

MIT — see [LICENSE](./LICENSE).
