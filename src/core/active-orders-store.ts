// Per-(user, chainId, currency, usdcAmount) record of an in-flight buy order.
// Lets the widget resume a pending order when the user re-clicks "Pay now"
// with identical inputs instead of placing a duplicate on-chain. Cleared on
// completion / cancellation (real or detected via polling), and aged out
// after MAX_AGE_MS so a stale entry can't strand a fresh attempt.

const STORAGE_KEY = "p2p-checkout:active-orders:v1";
// Auto-cancel window is 5 min; this is the comfortable upper bound for a
// resumable entry — anything older is almost certainly already terminal on
// chain even if we never observed it.
const MAX_AGE_MS = 60 * 60 * 1000;

export interface StoredOrder {
  orderId: string;
  txHash: string;
  createdAt: number;
}

export interface ActiveOrderKey {
  user: string;
  chainId: number;
  currency: string;
  usdcAmount: bigint;
}

type Store = Record<string, StoredOrder>;

function readStore(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    const now = Date.now();
    let mutated = false;
    for (const k of Object.keys(parsed)) {
      if (!parsed[k] || now - parsed[k].createdAt > MAX_AGE_MS) {
        delete parsed[k];
        mutated = true;
      }
    }
    if (mutated) writeStore(parsed);
    return parsed;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(store).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

export function keyFor(k: ActiveOrderKey): string {
  return `${k.user.toLowerCase()}|${k.chainId}|${k.currency}|${k.usdcAmount.toString()}`;
}

export function getActiveOrder(k: ActiveOrderKey): StoredOrder | null {
  return readStore()[keyFor(k)] ?? null;
}

export function setActiveOrder(
  k: ActiveOrderKey,
  entry: { orderId: string; txHash: string },
): void {
  const store = readStore();
  store[keyFor(k)] = { ...entry, createdAt: Date.now() };
  writeStore(store);
}

export function removeActiveOrder(k: ActiveOrderKey): void {
  const store = readStore();
  if (keyFor(k) in store) {
    delete store[keyFor(k)];
    writeStore(store);
  }
}
