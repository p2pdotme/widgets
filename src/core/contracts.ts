import { createPublicClient, decodeEventLog, formatUnits, http } from "viem";
import { base, baseSepolia } from "viem/chains";

// ─── Diamond ABI ──────────────────────────────────────────────────────
//
// Only Diamond-level reads/writes ship in this package. Integrator-specific
// ABIs (MarketplaceCheckoutIntegrator, LotPotCheckoutIntegrator, etc.) live
// with the host app — the widgets accept callbacks that encode whatever
// integrator-specific tx the host needs to submit. See README §"Implementing
// offramp callbacks" + the merchant-app's `marketplace.tsx` for the
// canonical pattern.

const ORDER_TUPLE = {
  name: "",
  type: "tuple",
  components: [
    { name: "amount", type: "uint256" },
    { name: "fiatAmount", type: "uint256" },
    { name: "placedTimestamp", type: "uint256" },
    { name: "completedTimestamp", type: "uint256" },
    { name: "userCompletedTimestamp", type: "uint256" },
    { name: "acceptedMerchant", type: "address" },
    { name: "user", type: "address" },
    { name: "recipientAddr", type: "address" },
    { name: "pubkey", type: "string" },
    { name: "encUpi", type: "string" },
    { name: "userCompleted", type: "bool" },
    { name: "status", type: "uint8" },
    { name: "orderType", type: "uint8" },
    {
      name: "disputeInfo",
      type: "tuple",
      components: [
        { name: "raisedBy", type: "uint8" },
        { name: "status", type: "uint8" },
        { name: "redactTransId", type: "uint256" },
        { name: "accountNumber", type: "uint256" },
      ],
    },
    { name: "id", type: "uint256" },
    { name: "userPubKey", type: "string" },
    { name: "encMerchantUpi", type: "string" },
    { name: "acceptedAccountNo", type: "uint256" },
    { name: "assignedAccountNos", type: "uint256[]" },
    { name: "currency", type: "bytes32" },
    { name: "preferredPaymentChannelConfigId", type: "uint256" },
    { name: "circleId", type: "uint256" },
  ],
} as const;

export const DIAMOND_ABI = [
  {
    name: "paidBuyOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_orderId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getPriceConfig",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_currency", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "buyPrice", type: "uint256" },
          { name: "sellPrice", type: "uint256" },
          { name: "buyPriceOffset", type: "int256" },
          { name: "baseSpread", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getSmallOrderThreshold",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_currency", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // V22 split the unified small-order fee into per-order-type selectors:
  // BUY pays half (reduced buyer-side friction), SELL/PAY pay the full
  // configured fee. The deprecated unified selector is kept here so the
  // widget can transparently fall back on pre-V22 Diamond deployments —
  // see `readSmallOrderFixedFee` below. Once every targeted Diamond has
  // upgraded the deprecated entry can be deleted.
  {
    name: "getSmallOrderFixedFeeBuy",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_currency", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSmallOrderFixedFeeSell",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_currency", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSmallOrderFixedFeePay",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_currency", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSmallOrderFixedFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_currency", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getOrdersById",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [ORDER_TUPLE],
  },
  {
    name: "getAdditionalOrderDetails",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "fixedFeePaid", type: "uint64" },
          { name: "tipsPaid", type: "uint64" },
          { name: "acceptedTimestamp", type: "uint128" },
          { name: "paidTimestamp", type: "uint128" },
          { name: "reserved2", type: "uint128" },
          { name: "actualUsdtAmount", type: "uint256" },
          { name: "actualFiatAmount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export const DEFAULT_DIAMOND_ADDRESS = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as `0x${string}`;
export const USDC_DECIMALS = 6;

// ─── V2 integrator event helper (convenience, not Diamond) ───────────
//
// Decodes `CheckoutOrderCreated` / `B2BOrderPlaced` — the two events V2-shaped
// integrators emit when placing a buy order. Exported so hosts using a
// V2-style integrator can drop it straight into their `placeOrder` callback.
// Integrators that emit different events should parse the receipt themselves.

const CHECKOUT_ORDER_CREATED_EVENT = {
  type: "event" as const,
  name: "CheckoutOrderCreated",
  inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "client", type: "address", indexed: true },
    { name: "productId", type: "uint256", indexed: false },
    { name: "usdcAmount", type: "uint256", indexed: false },
  ],
};

const B2B_ORDER_PLACED_EVENT = {
  type: "event" as const,
  name: "B2BOrderPlaced",
  inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "integrator", type: "address", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
};

export function parseOrderIdFromReceipt(receipt: { logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[] }): string | null {
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: [CHECKOUT_ORDER_CREATED_EVENT], data: log.data, topics: log.topics as any });
      if (d.eventName === "CheckoutOrderCreated") return (d.args as any).orderId.toString();
    } catch {}
  }
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: [B2B_ORDER_PLACED_EVENT], data: log.data, topics: log.topics as any });
      if (d.eventName === "B2BOrderPlaced") return (d.args as any).orderId.toString();
    } catch {}
  }
  return null;
}

// ─── Small-order fee read (V22 forward-compat shim) ───────────────────
//
// V22 split the unified `getSmallOrderFixedFee(currency)` into three
// per-order-type selectors (Buy / Sell / Pay). This helper reads the
// right one and transparently falls back to the deprecated unified
// selector on pre-V22 Diamonds, so a single widget build works against
// every deployment in flight. The fallback path executes one extra
// view (the post-V22 read costs a single round-trip).
//
// The returned bigint is 6-dec USDC. BUY is half the per-currency
// `fixedFee/2` post-V22; SELL/PAY are the full configured fee on both
// V21 (where Buy/Sell/Pay were all the same) and V22.

type FixedFeeOrderType = "buy" | "sell" | "pay";

export async function readSmallOrderFixedFee(
  publicClient: { readContract: (args: any) => Promise<unknown> },
  diamondAddress: `0x${string}`,
  currencyHex: `0x${string}`,
  orderType: FixedFeeOrderType,
): Promise<bigint> {
  const typedFn =
    orderType === "buy"
      ? "getSmallOrderFixedFeeBuy"
      : orderType === "sell"
        ? "getSmallOrderFixedFeeSell"
        : "getSmallOrderFixedFeePay";
  try {
    return (await publicClient.readContract({
      address: diamondAddress,
      abi: DIAMOND_ABI,
      functionName: typedFn,
      args: [currencyHex],
    })) as bigint;
  } catch {
    return (await publicClient.readContract({
      address: diamondAddress,
      abi: DIAMOND_ABI,
      functionName: "getSmallOrderFixedFee",
      args: [currencyHex],
    })) as bigint;
  }
}

// ─── Common integrator interface helpers ─────────────────────────────
//
// `userTxLimit()` is the one selector our integrator templates all expose
// (returns the per-tx USDC cap in 6-dec). Useful as a sanity check before
// the host submits placeOrder — kept here as a documented convenience.

export const INTEGRATOR_LIMITS_ABI = [
  {
    name: "userTxLimit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Read `userTxLimit()` from an integrator. Returns the per-tx USDC cap as
 * both the raw bigint (6-decimals) and a decimal string suitable for display.
 *
 * Defaults: chainId = 84532 (Base Sepolia), viem's default RPC. Pass `rpcUrl`
 * for a custom RPC; pass `decimals` if your integrator denominates the limit
 * in something other than USDC.
 */
export async function fetchUserTxLimit(
  integratorAddress: `0x${string}`,
  opts: { chainId?: number; rpcUrl?: string; decimals?: number } = {},
): Promise<{ raw: bigint; formatted: string }> {
  const { chainId = 84532, rpcUrl, decimals = USDC_DECIMALS } = opts;
  const chain = chainId === 8453 ? base : baseSepolia;
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const raw = (await client.readContract({
    address: integratorAddress,
    abi: INTEGRATOR_LIMITS_ABI,
    functionName: "userTxLimit",
  })) as bigint;
  return { raw, formatted: formatUnits(raw, decimals) };
}

// ─── ERC20 read fragment ─────────────────────────────────────────────
//
// Just the read selectors `balanceOf` + `decimals`. The widget uses this to
// render an optional "you have X USDC available" affordance on the
// amount-input offramp. Approve/transfer are intentionally absent — those
// go to integrator-specific code (host concern).

export const ERC20_READ_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
