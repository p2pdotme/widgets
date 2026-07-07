/**
 * Canonical buy + offramp integration. Uses a viem private-key signer for
 * brevity — see README §"Signer adapter" for Privy / wagmi recipes that drop
 * straight into this `CheckoutSigner` shape.
 *
 * The widget itself is integrator-agnostic. This file shows the *host* side:
 *   • a V2-style integrator for buys (BUY_INTEGRATOR_ABI),
 *   • a LotPot-shaped integrator for offramps (OFFRAMP_INTEGRATOR_ABI),
 *   • the four host callbacks the widgets need.
 *
 * Adapt the addresses, ABIs, and event parsers to your deployment.
 */

import { useCallback, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  stringToHex,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
// Shared types + helpers come from the bare entry; each widget is imported
// from its own subpath so unused widgets are tree-shaken out.
import {
  P2PError,
  parseOrderIdFromReceipt,
  type CheckoutSigner,
  type CurrencyOption,
} from "@p2pdotme/widgets";
import {
  Checkout,
  type PlaceOrderContext,
  type PlaceOrderResult,
} from "@p2pdotme/widgets/checkout";
import {
  Cashout,
  type DeliverUpiContext,
  type PlaceCashoutContext,
  type PlaceCashoutResult,
  type ReconcileContext,
} from "@p2pdotme/widgets/cashout";
import {
  createLocalStorageRelayStore,
  createRelayIdentity,
} from "@p2pdotme/sdk/orders";

// ─── Configuration ────────────────────────────────────────────────────

const CHAIN = baseSepolia;
const RPC_URL: string | undefined = undefined; // pass to override viem's default
const DIAMOND_ADDRESS = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as `0x${string}`;
const USDC_ADDRESS = "0x4095fE4f1E636f11A95820BA2bB87F335Bd1040d" as `0x${string}`;

// V2 stack (buy flow)
const BUY_INTEGRATOR_ADDRESS = "0x4eEe0701b53A031B510468fe4b9C6523Aa21613a" as `0x${string}`;
const CLIENT_ADDRESS = "0xF99216e437f04270D815563c548A0E4599207973" as `0x${string}`;

// Offramp integrator (LotPot-style — any contract exposing the three
// selectors below works). The widget never imports the ABI; this file does.
const OFFRAMP_INTEGRATOR_ADDRESS =
  "0x59422CFb0b1951F98eCD5C720bC3F4ec4E00Bb64" as `0x${string}`;

const CURRENCIES: CurrencyOption[] = [
  { symbol: "INR", flag: "🇮🇳", paymentMethod: "UPI", circleId: 1n },
  { symbol: "BRL", flag: "🇧🇷", paymentMethod: "PIX", circleId: 2n },
];

// ─── ABIs (host-side — the widget never sees these) ───────────────────

const BUY_INTEGRATOR_ABI = [
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

const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const OFFRAMP_INTEGRATOR_ABI = [
  {
    name: "userInitiateOfframp",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
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
    type: "event",
    name: "OfframpInitiated",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
    ],
  },
] as const;

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

// ─── Signer adapter (viem private key) ───────────────────────────────
//
// In production you'd source this from a wallet provider (Privy, wagmi,
// thirdweb, …). See README §"Signer adapter" for those recipes — they
// produce the same `CheckoutSigner` shape this hook returns.

function useCheckoutSigner(privateKey: `0x${string}`): CheckoutSigner {
  return useMemo(() => {
    const account = privateKeyToAccount(privateKey);
    const wallet = createWalletClient({
      account,
      chain: CHAIN,
      transport: http(RPC_URL),
    });
    return {
      address: account.address,
      sendTransaction: async (tx) => {
        const hash = await wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
        });
        return { hash };
      },
      // Required when `screening` is configured on <Checkout>.
      signMessage: (message) => wallet.signMessage({ message }),
    };
  }, [privateKey]);
}

// ─── Receipt parser for the offramp event ─────────────────────────────

function parseOfframpOrderId(receipt: { logs: readonly Log[] }): string | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: OFFRAMP_INTEGRATOR_ABI,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "OfframpInitiated") {
        return (decoded.args as { orderId: bigint }).orderId.toString();
      }
    } catch {
      // Not our event — keep scanning.
    }
  }
  return null;
}

// ─── App ──────────────────────────────────────────────────────────────

interface AppProps {
  /** Hex-encoded private key. In production, replace this prop with whatever
   *  signer source you use (Privy embedded wallet, wagmi connector, …). */
  privateKey: `0x${string}`;
}

export default function App({ privateKey }: AppProps) {
  const signer = useCheckoutSigner(privateKey);
  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);

  // ─── Buy callback ──────────────────────────────────────────────────
  const placeBuy = useCallback(
    async (ctx: PlaceOrderContext): Promise<PlaceOrderResult> => {
      if (!ctx.currency) throw new Error("Pick a currency");

      // The merchant uses this pubkey to encrypt their UPI/PIX details.
      // Persisted across reloads so the user can decrypt later.
      const store = createLocalStorageRelayStore();
      let identity = await store.get();
      if (!identity) {
        identity = createRelayIdentity();
        await store.set(identity);
      }

      const data = encodeFunctionData({
        abi: BUY_INTEGRATOR_ABI,
        functionName: "userPlaceOrder",
        args: [
          CLIENT_ADDRESS,
          1n, // productId
          1n, // quantity
          stringToHex(ctx.currency.symbol, { size: 32 }),
          ctx.currency.circleId!,
          identity.publicKey,
          0n, // preferredPaymentChannelConfigId
          0n, // fiatAmountLimit
        ],
      });

      const { hash } = await signer.sendTransaction({
        to: BUY_INTEGRATOR_ADDRESS,
        data,
        gasLimit: 1_500_000,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") throw new Error("Tx reverted on chain");
      const orderId = parseOrderIdFromReceipt(receipt);
      if (!orderId) throw new Error("orderId missing from receipt");
      return { orderId, txHash: hash };
    },
    [signer],
  );

  // ─── Offramp callbacks ─────────────────────────────────────────────
  //
  // The widget owns the Diamond-level orchestration; the host owns the
  // integrator-specific txs. Three callbacks: place, deliver, reconcile.

  const placeCashout = useCallback(
    async (ctx: PlaceCashoutContext): Promise<PlaceCashoutResult> => {
      // 1) Approve USDC to the integrator if allowance is short. Approve
      //    the TOTAL (principal + fee) — the Diamond pulls that much from
      //    the user at `setSellOrderUpi`.
      const totalCharge = ctx.usdcAmount + ctx.feeUsdc;
      const allowance = (await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [signer.address, OFFRAMP_INTEGRATOR_ADDRESS],
      })) as bigint;
      if (allowance < totalCharge) {
        const { hash: approveHash } = await signer.sendTransaction({
          to: USDC_ADDRESS,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [OFFRAMP_INTEGRATOR_ADDRESS, totalCharge],
          }),
          gasLimit: 100_000,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 2) Submit the integrator's place-offramp tx.
      const data = encodeFunctionData({
        abi: OFFRAMP_INTEGRATOR_ABI,
        functionName: "userInitiateOfframp",
        args: [
          ctx.usdcAmount,
          stringToHex(ctx.currency.symbol, { size: 32 }),
          0n, // fiatAmountLimit (slippage floor) — 0 disables the check
          ctx.currency.circleId!,
          ctx.currency.paymentChannelConfigId ?? 0n,
          ctx.userPubKey,
        ],
      });
      const { hash } = await signer.sendTransaction({
        to: OFFRAMP_INTEGRATOR_ADDRESS,
        data,
        gasLimit: 1_000_000,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") throw new Error("Tx reverted on chain");
      const orderId = parseOfframpOrderId(receipt);
      if (!orderId) throw new Error("orderId not in receipt");
      return { orderId, txHash: hash };
    },
    [signer],
  );

  const deliverUpi = useCallback(
    async (ctx: DeliverUpiContext): Promise<{ txHash: string }> => {
      const data = encodeFunctionData({
        abi: OFFRAMP_INTEGRATOR_ABI,
        functionName: "deliverOfframpUpi",
        args: [BigInt(ctx.orderId), ctx.encryptedUpi],
      });
      const { hash } = await signer.sendTransaction({
        to: OFFRAMP_INTEGRATOR_ADDRESS,
        data,
        gasLimit: 500_000,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { txHash: hash };
    },
    [signer],
  );

  const reconcile = useCallback(
    async (ctx: ReconcileContext): Promise<{ txHash: string }> => {
      const data = encodeFunctionData({
        abi: OFFRAMP_INTEGRATOR_ABI,
        functionName: "reconcile",
        args: [BigInt(ctx.orderId), ctx.status],
      });
      const { hash } = await signer.sendTransaction({
        to: OFFRAMP_INTEGRATOR_ADDRESS,
        data,
        gasLimit: 200_000,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return { txHash: hash };
    },
    [signer],
  );

  // ─── Error reporter (P2PError-aware) ───────────────────────────────
  const handleError = useCallback((err: Error) => {
    if (err instanceof P2PError) {
      if (err.code === "WALLET_USER_REJECTED") return; // user cancelled
      console.error(`[checkout] ${err.code}:`, err.userMessage, err.context);
    } else {
      console.error("[checkout] unexpected", err);
    }
  }, []);

  return (
    <main>
      <button onClick={() => setShowBuy(true)}>Buy 1 Common NFT (5 USDC)</button>
      <button onClick={() => setShowSell(true)}>Withdraw USDC to fiat</button>

      {showBuy && (
        <Checkout
          placeOrder={placeBuy}
          currencies={CURRENCIES}
          amount="5 USDC"
          // To price in fiat instead of USDC, drop `amount`/`usdcAmount` and
          // pass e.g. `fiatChargeAmount={5000_000000n}` (₹5,000 all-in). The
          // resolved USDC arrives on `ctx.usdcAmount` in `placeBuy`. See
          // README §"Pricing the order in fiat".
          productName="Common NFT"
          signer={signer}
          chainId={CHAIN.id}
          diamondAddress={DIAMOND_ADDRESS}
          rpcUrl={RPC_URL}
          onError={handleError}
          onClose={() => setShowBuy(false)}
          onComplete={() => setShowBuy(false)}
        />
      )}

      {showSell && (
        <Cashout
          signer={signer}
          usdcAddress={USDC_ADDRESS}
          diamondAddress={DIAMOND_ADDRESS}
          chainId={CHAIN.id}
          rpcUrl={RPC_URL}
          currencies={CURRENCIES}
          defaultAmountUsdc={2_000_000n}
          // To fix the fiat the user RECEIVES instead, drop `defaultAmountUsdc`
          // and pass e.g. `fiatPayoutAmount={5000_000000n}` (₹5,000) — the widget
          // computes the USDC to sell. Sell-side analog of `fiatChargeAmount`.
          placeCashout={placeCashout}
          deliverUpi={deliverUpi}
          reconcile={reconcile}
          onError={handleError}
          onClose={() => setShowSell(false)}
          onComplete={() => setShowSell(false)}
          onCancelled={() => setShowSell(false)}
        />
      )}
    </main>
  );
}
