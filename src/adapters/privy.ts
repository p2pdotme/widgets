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
   * Numeric chain id of the wallet, if the host tracks it. Privy's
   * `ConnectedWallet` exposes `chainId` as a CAIP-2 string
   * (`"eip155:8453"`); pass the numeric form here (or omit and let the
   * sign-in path default). Bound into the bridge sign-in per D-027-v3 §4.
   */
  chainId?: number;
  getEthereumProvider: () => Promise<EthereumProviderLike> | EthereumProviderLike;
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
    chainId: wallet.chainId,
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
