// Thirdweb → SupportSigner adapter (D-005-v2).
//
// Duck-typed against `thirdweb/wallets`' `Account`. Thirdweb's `signMessage`
// takes `{ message }` and returns a hex signature string. Wrapping it
// here keeps the widget free of the thirdweb peer dep.

import type { SupportSigner } from "../types";

export interface ThirdwebChainLike {
  id: number;
}

export interface ThirdwebAccountLike {
  address: string;
  /**
   * Returns the account's LIVE active `Chain`. Thirdweb's connected account
   * surfaces the active chain (e.g. via `useActiveWalletChain()` plumbed in
   * by the host, or a wallet wrapper). The adapter reads `chain.id` at sign
   * time so a chain switch is reflected. Bound into the bridge sign-in per
   * D-027-v3 §4.
   */
  getChain?: () => ThirdwebChainLike | undefined;
  signMessage: (args: { message: string }) => Promise<string>;
}

/**
 * Wrap a Thirdweb `Account` (or anything shaped like one) as a
 * `SupportSigner`. See `fromPrivyWallet` for the parallel Privy path.
 *
 * The support sign-in path treats chainId as mandatory (hard cutover,
 * D-027-v3 §4); if the active chain cannot be resolved to a number,
 * `getChainId` throws rather than defaulting.
 */
export function fromThirdwebAccount(account: ThirdwebAccountLike): SupportSigner {
  return {
    address: account.address as `0x${string}`,
    // Read live: resolve the active chain id at sign time. Async so an
    // unresolvable chain surfaces as a rejected promise.
    getChainId: async () => {
      const id = account.getChain?.()?.id;
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
        throw new Error(
          "fromThirdwebAccount: could not resolve a numeric chainId from the active chain",
        );
      }
      return id;
    },
    signMessage: (message: string) => account.signMessage({ message }),
  };
}
