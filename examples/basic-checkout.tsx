/**
 * Canonical buy + sell-back integration. Uses Privy for the wallet, a
 * V2-style integrator for buys, and a MarketplaceCheckoutIntegrator for
 * sell-back. Adapt the addresses and ABIs to your deployment.
 *
 * Drop this file into a Vite + React + Privy app, plug your env vars in,
 * and you have a working storefront.
 */

import { useCallback, useMemo, useState } from "react";
import { usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  stringToHex,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  P2PCheckout,
  P2POfframp,
  parseOrderIdFromReceipt,
  type CheckoutSigner,
  type CurrencyOption,
  type PlaceOrderContext,
  type PlaceOrderResult,
} from "@p2pdotme/checkout-widget";
import {
  createLocalStorageRelayStore,
  createRelayIdentity,
} from "@p2pdotme/sdk/orders";

// ─── Configuration ────────────────────────────────────────────────────

const CHAIN = baseSepolia;
const RPC_URL = undefined; // pass to override viem's default
const DIAMOND_ADDRESS = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as `0x${string}`;
const USDC_ADDRESS = "0x4095fE4f1E636f11A95820BA2bB87F335Bd1040d" as `0x${string}`;

// V2 stack (store flow)
const INTEGRATOR_ADDRESS = "0x4eEe0701b53A031B510468fe4b9C6523Aa21613a" as `0x${string}`;
const CLIENT_ADDRESS = "0xF99216e437f04270D815563c548A0E4599207973" as `0x${string}`;

// Marketplace stack (sell-back capable)
const MARKETPLACE_INTEGRATOR_ADDRESS = "0x59422CFb0b1951F98eCD5C720bC3F4ec4E00Bb64" as `0x${string}`;
const MARKETPLACE_ADDRESS = "0xFCd89B3022b4C13F57bB97aCd040F2e4C458290F" as `0x${string}`;

const CURRENCIES: CurrencyOption[] = [
  { symbol: "INR", flag: "🇮🇳", paymentMethod: "UPI", circleId: 1n },
  { symbol: "BRL", flag: "🇧🇷", paymentMethod: "PIX", circleId: 2n },
];

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

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

// ─── Signer adapter (Privy) ──────────────────────────────────────────

function useCheckoutSigner(): CheckoutSigner | null {
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const wallet = wallets[0];
  return useMemo(() => {
    if (!wallet) return null;
    const isEmbedded = wallet.walletClientType === "privy";
    return {
      address: wallet.address as `0x${string}`,
      sendTransaction: async (tx) => {
        const result = await sendTransaction(
          {
            to: tx.to,
            data: tx.data,
            gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
          },
          { address: wallet.address, ...(isEmbedded ? { sponsor: true } : {}) },
        );
        return { hash: result.hash as `0x${string}` };
      },
      // Required when `screening` is configured on <P2PCheckout>.
      signMessage: async (message) => {
        const provider = await wallet.getEthereumProvider();
        return provider.request({
          method: "personal_sign",
          params: [message, wallet.address],
        }) as Promise<string>;
      },
    };
  }, [wallet, sendTransaction]);
}

// Optional: enable B2B fraud-engine screening. Source these from your env.
const SCREENING = {
  apiUrl: import.meta.env.VITE_FRAUD_ENGINE_API_URL as string | undefined,
  encryptionKey: import.meta.env.VITE_FRAUD_ENGINE_ENCRYPTION_KEY as string | undefined,
  orderSource: import.meta.env.VITE_FRAUD_ENGINE_ORDER_SOURCE as string | undefined,
};

// ─── App ──────────────────────────────────────────────────────────────

export default function App() {
  const { ready, authenticated, login } = usePrivy();
  const signer = useCheckoutSigner();
  const [showBuy, setShowBuy] = useState(false);
  const [sellTokenId, setSellTokenId] = useState<bigint | null>(null);

  const placeBuy = useCallback(
    async (ctx: PlaceOrderContext): Promise<PlaceOrderResult> => {
      if (!signer) throw new Error("No signer");
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
        abi: INTEGRATOR_ABI,
        functionName: "userPlaceOrder",
        args: [
          CLIENT_ADDRESS,
          1n,                              // productId
          1n,                              // quantity
          stringToHex(ctx.currency.symbol, { size: 32 }),
          ctx.currency.circleId,
          identity.publicKey,
          0n, 0n,                          // ppcId + fiatAmountLimit
        ],
      });

      const { hash } = await signer.sendTransaction({
        to: INTEGRATOR_ADDRESS,
        data,
        gasLimit: 1_500_000,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") throw new Error("Tx reverted on chain");
      const orderId = parseOrderIdFromReceipt(receipt as any);
      if (!orderId) throw new Error("orderId missing from receipt");
      return { orderId, txHash: hash };
    },
    [signer],
  );

  if (!ready) return null;
  if (!authenticated) return <button onClick={() => login()}>Sign in</button>;

  return (
    <main>
      <button onClick={() => setShowBuy(true)}>Buy 1 Common NFT (5 USDC)</button>
      <button onClick={() => setSellTokenId(1n)}>Sell back token #1</button>

      {showBuy && signer && (
        <P2PCheckout
          placeOrder={placeBuy}
          currencies={CURRENCIES}
          amount="5 USDC"
          productName="Common NFT"
          signer={signer}
          chainId={CHAIN.id}
          diamondAddress={DIAMOND_ADDRESS}
          rpcUrl={RPC_URL}
          screening={
            SCREENING.apiUrl && SCREENING.encryptionKey
              ? {
                  apiUrl: SCREENING.apiUrl,
                  encryptionKey: SCREENING.encryptionKey,
                  orderSource: SCREENING.orderSource,
                  orderDetails: { cryptoAmount: 5, currency: "INR" },
                }
              : undefined
          }
          onClose={() => setShowBuy(false)}
          onComplete={() => setShowBuy(false)}
        />
      )}

      {sellTokenId !== null && signer && (
        <P2POfframp
          integratorAddress={MARKETPLACE_INTEGRATOR_ADDRESS}
          marketplaceAddress={MARKETPLACE_ADDRESS}
          tokenId={sellTokenId}
          signer={signer}
          currencies={CURRENCIES}
          diamondAddress={DIAMOND_ADDRESS}
          usdcAddress={USDC_ADDRESS}
          chainId={CHAIN.id}
          onClose={() => setSellTokenId(null)}
          onComplete={() => setSellTokenId(null)}
          onCancelled={() => setSellTokenId(null)}
        />
      )}
    </main>
  );
}
