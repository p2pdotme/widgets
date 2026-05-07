import { decodeEventLog } from "viem";

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

/**
 * Convenience: parse orderId from a tx receipt containing
 * CheckoutOrderCreated or B2BOrderPlaced events. Clients using
 * standard integrators can use this in their placeOrder callback.
 */
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

// ─── Offramp ABIs ────────────────────────────────────────────────────

const OFFRAMP_INITIATED_EVENT = {
  type: "event" as const,
  name: "OfframpInitiated",
  inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "client", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: false },
    { name: "productId", type: "uint256", indexed: false },
    { name: "usdcAmount", type: "uint256", indexed: false },
  ],
};

export const MARKETPLACE_INTEGRATOR_ABI = [
  {
    name: "userInitiateSellBack",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "client", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "currency", type: "bytes32" },
      { name: "fiatAmount", type: "uint256" },
      { name: "circleId", type: "uint256" },
      { name: "preferredPaymentChannelConfigId", type: "uint256" },
      { name: "userPubKey", type: "string" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
  {
    name: "deliverOfframpUpi",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "encUpi", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "reconcile",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "currentStatus", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "proxyAddress",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "offrampEnabled",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  OFFRAMP_INITIATED_EVENT,
] as const;

export const MARKETPLACE_CLIENT_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tokenProduct",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const USER_PROXY_ABI = [
  {
    name: "sweepERC721",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** Parse orderId from an OfframpInitiated event in a receipt. */
export function parseOfframpOrderIdFromReceipt(receipt: { logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[] }): string | null {
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: [OFFRAMP_INITIATED_EVENT], data: log.data, topics: log.topics as any });
      if (d.eventName === "OfframpInitiated") return (d.args as any).orderId.toString();
    } catch {}
  }
  return null;
}
