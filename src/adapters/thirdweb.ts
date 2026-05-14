// Thirdweb → SupportSigner adapter (D-005-v2).
//
// Duck-typed against `thirdweb/wallets`' `Account`. Thirdweb's `signMessage`
// takes `{ message }` and returns a hex signature string. Wrapping it
// here keeps the widget free of the thirdweb peer dep.

import type { SupportSigner } from "../types";

export interface ThirdwebAccountLike {
  address: string;
  signMessage: (args: { message: string }) => Promise<string>;
}

/**
 * Wrap a Thirdweb `Account` (or anything shaped like one) as a
 * `SupportSigner`. See `fromPrivyWallet` for the parallel Privy path.
 */
export function fromThirdwebAccount(account: ThirdwebAccountLike): SupportSigner {
  return {
    address: account.address as `0x${string}`,
    signMessage: (message: string) => account.signMessage({ message }),
  };
}
