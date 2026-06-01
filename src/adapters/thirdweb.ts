// Thirdweb → SupportSigner adapter (D-005-v2).
//
// Duck-typed against `thirdweb/wallets`' `Account`. Thirdweb's `signMessage`
// takes `{ message }` and returns a hex signature string. Wrapping it
// here keeps the widget free of the thirdweb peer dep.

import type { SupportSigner } from "../types";

export interface ThirdwebAccountLike {
  address: string;
  /**
   * Numeric chain id of the connected account, if the host tracks it.
   * Thirdweb resolves this from the active `Chain`; pass `chain.id` here
   * (or omit and let the sign-in path default). Bound into the bridge
   * sign-in per D-027-v3 §4.
   */
  chainId?: number;
  signMessage: (args: { message: string }) => Promise<string>;
}

/**
 * Wrap a Thirdweb `Account` (or anything shaped like one) as a
 * `SupportSigner`. See `fromPrivyWallet` for the parallel Privy path.
 */
export function fromThirdwebAccount(account: ThirdwebAccountLike): SupportSigner {
  return {
    address: account.address as `0x${string}`,
    chainId: account.chainId,
    signMessage: (message: string) => account.signMessage({ message }),
  };
}
