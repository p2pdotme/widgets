# @p2pdotme/checkout-widget

Drop-in React widgets for the [P2P.me](https://p2p.me) checkout flow.
Users pay you in **local fiat** (UPI, PIX, SPEI, QRIS, …) — your contract
receives **USDC on Base**. Three widgets in one package:

- **`<P2PCheckout>`** — the buy flow. User picks currency → pays merchant
  off-chain → your contract is paid USDC.
- **`<P2POfframp>`** — the sell-back flow. User sells back an NFT they
  bought through `<P2PCheckout>` and receives local fiat in return.
- **`<P2POrderHistory>`** — a subgraph-backed list of the connected user's
  orders. Auto-hides when there's nothing pending. Click "Resume" on a
  pending row to re-open `<P2PCheckout>` in tracking-only mode.

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
npm i @p2pdotme/checkout-widget
# or
pnpm add @p2pdotme/checkout-widget
# or
yarn add @p2pdotme/checkout-widget
```

Peer deps your app must have: `react@>=18`, `react-dom@>=18`, `viem@>=2`.

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
| **Subgraph URL** (optional) | Read endpoint for SDK routing + `<P2POrderHistory>`. Skip if you're using explicit `circleId` everywhere and don't need a history widget. |
| **Wallet signer** | Anything that can produce `{ to, data, gasLimit }` → signed tx hash. Privy embedded wallets and viem-native accounts are both supported via the `CheckoutSigner` adapter (see [Signer adapter](#signer-adapter)). |

> **Where to read more:** the contracts repo (under
> `contracts/CheckoutIntegratorV2.sol` and `contracts/MarketplaceCheckoutIntegrator.sol`)
> contains the interfaces you implement plus deploy/registration scripts.

---

## Quick start — Buy flow (`<P2PCheckout>`)

The widget is **integrator-agnostic for buys**: you give it a `placeOrder`
callback that produces an `orderId`, and the widget takes over from there.
Pass `subgraphUrl` + `usdcAddress` + `usdcAmount` and you can omit
`circleId` from your currency list — the widget routes via the SDK.

```tsx
import {
  P2PCheckout,
  parseOrderIdFromReceipt,
  type CheckoutSigner,
  type CurrencyOption,
  type PlaceOrderContext,
  type PlaceOrderResult,
} from "@p2pdotme/checkout-widget";
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
    <P2PCheckout
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

## Sell-back flow (`<P2POfframp>`)

Available when your integrator is `MarketplaceCheckoutIntegrator`-shaped (has
`userInitiateSellBack`, `deliverOfframpUpi`, `reconcile`, `proxyAddress`).
The widget handles: optional sweep of the NFT from the user's `UserProxy` to
their EOA, the burn, the encrypted UPI delivery, and status polling through
to either `COMPLETED` or `CANCELLED` (refund).

```tsx
import { P2POfframp, type CurrencyOption } from "@p2pdotme/checkout-widget";

<P2POfframp
  integratorAddress="0x59422CFb0b1951F98eCD5C720bC3F4ec4E00Bb64" // MarketplaceCheckoutIntegrator
  marketplaceAddress="0xFCd89B3022b4C13F57bB97aCd040F2e4C458290F" // SimpleNFTMarketplace-style
  tokenId={42n}
  signer={signer}
  currencies={CURRENCIES}
  diamondAddress="0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9"
  usdcAddress="0x4095fE4f1E636f11A95820BA2bB87F335Bd1040d"
  chainId={84532}
  onComplete={(orderId) => console.log("paid out", orderId)}
  onCancelled={(orderId) => console.warn("refunded", orderId)}
  onError={(err) => console.error(err)}
/>
```

`integratorAddress` must have `offrampEnabled = true`, a configured
`offrampRelayer`, a non-zero `maxUsdcPerOfframp`, and a USDC pool to fund the
sell-back. See the contracts repo's deployment scripts for setup.

> **Offramp does not auto-route.** Every currency you pass to `<P2POfframp>`
> must carry an explicit `circleId` — the sell flow uses it directly in the
> integrator tx. (Only the buy widget calls the SDK's routing path.)

---

## Order history & resume (`<P2POrderHistory>`)

A read-only widget that lists the connected user's orders from the
subgraph. Two common patterns:

- **Pending banner** on a home page (`filter="pending"`) — auto-hides when
  nothing's outstanding.
- **Full history page or drawer** (`filter="all"`) — shows everything,
  grouped into Pending / Past.

Click "Resume" on a pending row → host opens `<P2PCheckout>` in
**tracking-only mode** with that orderId. The checkout widget polls the
chain and snaps directly to whichever screen the order is currently on
(no "Finding merchant" flash for already-accepted orders).

```tsx
import { useCallback, useState } from "react";
import { P2PCheckout, P2POrderHistory, type CheckoutSigner } from "@p2pdotme/checkout-widget";

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
      <P2POrderHistory
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
        <P2PCheckout
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
`onCancel` fires from `<P2PCheckout>`, pass that orderId into
`optimisticUpdates` — the history widget overlays the terminal status
immediately. The overlay is harmlessly redundant once the subgraph
catches up.

`refreshKey` is the matching imperative escape hatch: bumping it forces
an immediate refetch (useful from the same `onComplete` / `onCancel`
handlers).

### `<P2POrderHistory>` props

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

## Currency configuration

You decide which currencies your integrator accepts by passing a
`CurrencyOption[]`. `circleId` is **optional** — leave it off and the
widget routes via the SDK (requires `subgraphUrl` + `usdcAddress` +
`usdcAmount` on `<P2PCheckout>`); set it to pin a specific merchant
circle for that currency. Mix-and-match is fine:

```ts
const CURRENCIES: CurrencyOption[] = [
  { symbol: "INR", flag: "🇮🇳", paymentMethod: "UPI" },                 // SDK-routed
  { symbol: "BRL", flag: "🇧🇷", paymentMethod: "PIX" },                 // SDK-routed
  { symbol: "MEX", flag: "🇲🇽", paymentMethod: "SPEI", circleId: 7n },  // pinned
];
```

> **`<P2POfframp>` requires explicit `circleId` on every currency** — only
> `<P2PCheckout>` calls the SDK's routing path.

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

**`getSmallOrderThreshold(currency)` / `getSmallOrderFixedFee(currency)`** —
the "Transaction Fee" row. Orders ≤ threshold incur the fixed fee in USDC,
converted to fiat at the same `buyPrice` (currently **10 USDC threshold,
0.125 USDC fee** in prod for INR / IDR / BRL — read dynamically per
currency so this tracks any protocol updates). Orders above the threshold
pay zero (row hidden).

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

## Reading integrator limits

Every integrator exposes a `userTxLimit()` view returning the per-tx USDC cap
(6-decimals). Two helpers ship with the package so you can render this value
in your product UI without rolling your own viem client.

### `useUserTxLimit` (React hook)

```tsx
import { useUserTxLimit } from "@p2pdotme/checkout-widget";

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
import { fetchUserTxLimit } from "@p2pdotme/checkout-widget";

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

| `phase` (buy) | When it's set | What's on screen |
|---|---|---|
| `checkout` | Initial render with a `placeOrder` callback | Pre-order screen: amount, product, currency picker, **fiat breakdown**, "Pay {total}" button |
| `placing` | `placeOrder` running (incl. SDK routing) | "Placing order…" with spinner |
| `placed` | tx confirmed; order = `PLACED` on Diamond | "Finding a merchant" — polls every 3 s for an accept |
| `accepted` | order = `ACCEPTED` (a merchant has matched) | **5-min countdown pill**, "Pay exactly X" hero with breakdown, decrypted UPI / payment details, copy buttons, **I've paid** button, cancel option. Polls every 15 s for on-chain cancellation. |
| `paid` | user clicked I've paid → `paidBuyOrder` succeeded | "Verifying your payment" — polls every 10 s for completion |
| `completed` | order = `COMPLETED` | Success screen → fires `onComplete` |
| `cancelled` | order = `CANCELLED` | "Order cancelled / refunded" with **Done** button → fires `onCancel` |
| `error` | Pre-order placement failure | Error message + retry/close → fires `onError`. Failures during `accepted`/`paid` actions (cancel, mark-paid) stay on-screen with an inline error — they don't reset the phase. |

Sell-back (offramp) phases: `form` → `sweeping?` → `placing` → `placed` →
`accepted` → `encrypting` → `paid` → `completed` (or `cancelled`).

---

## API reference

### `<P2PCheckout>` props

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
| `usdcAmount` | `bigint` | conditional | USDC amount the user is charged (6-dec). Required for SDK routing; also drives the fiat breakdown when `subgraphUrl` is set. |
| `fiatAmount` | `bigint` | — | **Override.** When omitted, the widget derives it from on-chain `getPriceConfig(currency).buyPrice × usdcAmount` plus the small-order fee (gross). Pass this only to pin a custom fiat amount (e.g. a fixed-price promo). |
| `chainId` | `number` | — | Defaults to **84532 (Base Sepolia)**. Override for mainnet. |
| `diamondAddress` | `0x…` | — | Defaults to a Sepolia testnet Diamond. **Override for production.** |
| `rpcUrl` | `string` | — | Custom RPC for status polling. Defaults to viem's chain default. |
| `mode` | `"modal" \| "inline"` | — | Default `modal`. |
| `open` | `boolean` | — | Modal-only. |
| `demo` | `boolean` | — | See [Demo mode](#demo-mode). |
| `screening` | `ScreeningConfig` | — | Enables fraud-engine logging + post-tx link-order so the merchant app sees the order as screened. See [Fraud screening (B2B)](#fraud-screening-b2b). Requires `signer.signMessage`. |
| `onOrderPlaced` | `(orderId, txHash) => void` | — | Order fully placed on-chain. |
| `onComplete` | `(orderId) => void` | — | Order reached `COMPLETED`. |
| `onCancel` | `(orderId) => void` | — | Order reached `CANCELLED`. |
| `onError` | `(err) => void` | — | Any error during the flow. |
| `onClose` | `() => void` | — | User dismissed the modal. |

### `<P2POfframp>` props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `integratorAddress` | `0x…` | ✅ | Must be a `MarketplaceCheckoutIntegrator`-shaped contract. |
| `marketplaceAddress` | `0x…` | ✅ | Client implementing `IMarketplaceClient` (`ownerOf`, `tokenProduct`, `tokenPrice`). |
| `tokenId` | `bigint` | ✅ | Token to sell back; user (or their proxy) must own it. |
| `signer` | `CheckoutSigner` | ✅ | Same signer you use for buys. |
| `currencies` | `CurrencyOption[]` | ✅ | Currency picker. **Every entry must carry an explicit `circleId`** — offramp does not auto-route. |
| `diamondAddress` | `0x…` | ✅ | Status polling. |
| `usdcAddress` | `0x…` | ✅ | For decimal formatting + balance reads. |
| `chainId` | `number` | — | Default `84532`. |
| `rpcUrl` | `string` | — | Status polling RPC. |
| `subgraphUrl` | `string` | — | Reserved for SDK reads. |
| `fiatAmountLimit` | `bigint` | — | Slippage floor (6 decimals). `0` = no check. |
| `mode` / `open` / events | — | — | Same shape as `<P2PCheckout>`. |

> Looking for `<P2POrderHistory>` props? See its dedicated section
> [above](#order-history--resume-p2porderhistory).

### Helper exports

```ts
import {
  // widgets
  P2PCheckout,
  P2POfframp,
  P2POrderHistory,
  // event-decoding helpers
  parseOrderIdFromReceipt,
  parseOfframpOrderIdFromReceipt,
  // integrator reads (see "Reading integrator limits")
  useUserTxLimit,
  fetchUserTxLimit,
  INTEGRATOR_LIMITS_ABI,
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
} from "@p2pdotme/checkout-widget";
```

Type-only exports include `P2PCheckoutProps`, `P2POfframpProps`,
`P2POrderHistoryProps`, `CheckoutSigner`, `CheckoutPhase`, `OfframpPhase`,
`PlaceOrderResult`, `PlaceOrderContext`, `CurrencyOption`,
`PaymentAddressValidator`, `ScreeningConfig`, `ScreeningOrderDetails`,
and `ScreeningUserDetails`.

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

2. **Pass `screening`** to `<P2PCheckout>`. Source the values from your env.

   ```tsx
   <P2PCheckout
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
<P2PCheckout demo placeOrder={async () => ({ orderId: "demo", txHash: "0x" })} signer={signer} />
```

---

## Troubleshooting

**Tx estimation reverts immediately**
The new P2P Diamond is **proxy-only** — it rejects direct integrator calls.
Make sure your integrator is registered on the Diamond *with a non-zero
`proxyImpl`* and that `userPlaceOrder` routes `placeB2BOrder` through your
per-user `UserProxy` clone. (See the contracts repo's
`MarketplaceCheckoutIntegrator.sol` / `CheckoutIntegratorV2.sol` for the
canonical pattern.)

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

**`<P2POrderHistory>` still shows a just-completed order as "Awaiting payment"**
The subgraph has ~10–20s indexing latency. Forward the orderId from
`<P2PCheckout>`'s `onComplete` / `onCancel` into the history widget's
`optimisticUpdates` prop and bump `refreshKey` — the row flips status
immediately and reconciles with the subgraph on the next fetch. See
[Optimistic terminal updates](#optimistic-terminal-updates).

**SDK routing throws "Routing requires subgraphUrl, usdcAddress, and usdcAmount"**
You left `circleId` off some `CurrencyOption` but didn't pass the routing
inputs to `<P2PCheckout>`. Either add `circleId` to that currency or pass
all three routing props. `fiatAmount` is optional — when missing the widget
derives it from on-chain `getPriceConfig`.

---

## Local development against a private fork

```bash
git clone https://github.com/p2pdotme/p2pdotme-checkout-widget
cd p2pdotme-checkout-widget
npm install
npm run build       # tsup → dist/{index.js,index.cjs,index.d.ts}
npm pack --dry-run  # preview what will be published
```

To consume the local build from another app:

```bash
# in the widget repo
npm pack
# copy the .tgz path, then in your app:
npm i /path/to/p2pdotme-checkout-widget-0.1.0.tgz
```

---

## Versioning

Semver. `0.x` minor releases may add props but won't change existing prop
shapes. `1.0` will commit to a stable surface.

## License

MIT — see [LICENSE](./LICENSE).
