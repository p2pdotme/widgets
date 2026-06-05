// Privy → SupportSigner adapter (D-005-v2).
//
// Duck-typed against the public surface of `@privy-io/react-auth`'s
// `ConnectedWallet`, so the widget never imports the Privy package and
// integrators avoid a peer dependency. Privy's embedded and external
// wallets both expose `getEthereumProvider().request({...})`.

import type { SupportSigner } from "../types";

export interface PrivyWalletLike {
  address: string;
  /**
   * Privy's `ConnectedWallet` exposes the LIVE chain as a CAIP-2 string
   * (`"eip155:8453"`). Pass the wallet through unchanged — the adapter reads
   * and parses this field at sign time so a chain switch is reflected. Bound
   * into the bridge sign-in per D-027-v3 §4.
   */
  chainId?: string;
  getEthereumProvider: () => Promise<EthereumProviderLike> | EthereumProviderLike;
}

/**
 * Parse a Privy CAIP-2 chain id (`"eip155:8453"`) to a number. Throws when
 * the wallet exposes nothing parseable — the support sign-in path treats
 * chainId as mandatory (hard cutover, D-027-v3 §4).
 */
function parsePrivyChainId(raw: string | undefined): number {
  const tail = typeof raw === "string" ? raw.split(":").pop() : undefined;
  // Number("") === 0 and Number("  ") === 0, both finite, so a bare
  // "eip155:" or empty/whitespace tail must be rejected explicitly. Require
  // a positive integer (chainId 0 is not a valid EVM chain).
  const n = tail !== undefined && tail.trim() !== "" ? Number(tail) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `fromPrivyWallet: could not resolve a numeric chainId from the live wallet (got ${JSON.stringify(raw)})`,
    );
  }
  return n;
}

export interface EthereumProviderLike {
  request: (args: {
    method: string;
    params?: readonly unknown[];
  }) => Promise<unknown>;
}

/**
 * Wrap a Privy `ConnectedWallet` (or anything shaped like one) as a
 * `SupportSigner`. The widget then treats it identically to any other
 * signer. Per D-024-v2 the signature only authenticates the wallet to
 * the bridge — it carries no on-chain authority.
 */
export function fromPrivyWallet(wallet: PrivyWalletLike): SupportSigner {
  const address = wallet.address as `0x${string}`;
  return {
    address,
    // Read live: parse the wallet's current CAIP-2 chainId at sign time, so
    // a chain switch after this signer was built is reflected. Async so an
    // unresolvable chain surfaces as a rejected promise.
    getChainId: async () => parsePrivyChainId(wallet.chainId),
    signMessage: async (message: string) => {
      const provider = await wallet.getEthereumProvider();
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;
      return signature;
    },
  };
}
