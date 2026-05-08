# Fraud screening — integrator guide

This page is for partners integrating `<P2PCheckout>` who need their orders to
be **accepted by merchants**. The merchant app rejects any order that has no
screening record, so wiring this up is mandatory for production traffic.

What the widget does once configured: on Pay-now, it sends an encrypted log
to the p2p.me fraud engine, runs your `placeOrder` callback, then links the
on-chain `orderId` back to the log so the merchant app sees the order as
screened+approved.

---

## 0. What you'll receive from p2p.me

Two values, one set per environment (testnet / mainnet):

| Value | Description |
|---|---|
| `FRAUD_ENGINE_API_URL` | Base URL **including the `/api/v1` prefix**. Testnet: `https://fe.p2p.lol/api/v1` |
| `FRAUD_ENGINE_ENCRYPTION_KEY` | 64-char hex AES-256-GCM key (32 bytes). Treat as a shared secret — must match our backend. |

---

## 1. Set env vars in your app

```env
# .env / .env.local (Vite)
VITE_FRAUD_ENGINE_API_URL=https://fe.p2p.lol/api/v1
VITE_FRAUD_ENGINE_ENCRYPTION_KEY=<the hex value we sent you>
VITE_FRAUD_ENGINE_ORDER_SOURCE=<your-app-name>   # free-form analytics tag
```

Use `NEXT_PUBLIC_…` for Next.js or `REACT_APP_…` for CRA. The widget reads no
env vars itself — you pipe these into the `screening` prop in step 3.

---

## 2. Add `signMessage` to your `CheckoutSigner`

The widget needs an EIP-191 signature to authenticate to the fraud engine. For
Privy:

```ts
const signer: CheckoutSigner = useMemo(() => ({
  address: wallet.address as `0x${string}`,
  sendTransaction: async (tx) => { /* unchanged */ },
  // 👇 ADD THIS
  signMessage: async (message) => {
    const provider = await wallet.getEthereumProvider();
    return (await provider.request({
      method: "personal_sign",
      params: [message, wallet.address],
    })) as string;
  },
  // 👇 ONLY for ERC-4337 smart wallets — point at the admin EOA that signs
  // signerAddress: wallet.adminEOA as `0x${string}`,
}), [wallet]);
```

For wagmi/viem, `walletClient.signMessage({ message })` works the same shape.

---

## 3. Pass the `screening` prop to `<P2PCheckout>`

```tsx
<P2PCheckout
  signer={signer}
  placeOrder={placeOrder}
  currencies={CURRENCIES}
  amount="…"
  productName="…"
  // ↓ NEW
  screening={{
    apiUrl: import.meta.env.VITE_FRAUD_ENGINE_API_URL,
    encryptionKey: import.meta.env.VITE_FRAUD_ENGINE_ENCRYPTION_KEY,
    orderSource: import.meta.env.VITE_FRAUD_ENGINE_ORDER_SOURCE,
    orderDetails: {
      cryptoAmount: 5,         // USDC the user is buying
      fiatAmount: 415,         // expected fiat amount (optional)
      currency: "INR",         // ISO code of the fiat side
    },
    userDetails: {             // all optional, useful for analytics
      country: "IN",
      loginMethod: "google",
    },
  }}
/>
```

That's the whole integration. After this is wired, on every Pay-now click the
widget fires three calls in this order:

1. `POST /api/v1/activity-logs/b2b-buy-order` (encrypted log) → `200 {activity_log_id}`
2. Your existing `placeOrder` callback (the on-chain `userPlaceOrder` tx)
3. `PATCH /api/v1/activity-logs/link-order` (fire-and-forget, links the orderId) → `200`

Once step 3 lands, the merchant app's poll sees `screened: true, status: approved`
and accepts the order.

---

## 4. Verify

Open DevTools → Network → click Pay-now. Expect:

| Request | Expected |
|---|---|
| `POST …/b2b-buy-order` | `200 {success:true, approved:true, activity_log_id:N}` |
| (on-chain tx in your provider's logs) | confirms |
| `PATCH …/link-order` | `200 {success:true}` |

If only the on-chain tx fires, either step 2 or step 3 of the integration is
missing. Check the browser console — the widget logs
`[p2p-widget] screening configured but signer.signMessage is missing…`
when `signMessage` is absent.

---

## 5. Common errors

| HTTP / symptom | Cause | Fix |
|---|---|---|
| **No fraud-engine requests at all** | `screening` prop not passed, OR `signMessage` not on signer | revisit step 2 + step 3 |
| `400 Failed to decrypt payload` | `VITE_FRAUD_ENGINE_ENCRYPTION_KEY` doesn't match our backend | use the exact value we provided |
| `401 Signature expired` | client clock > 5 min off | sync system clock |
| `401 Signature does not match signer` | smart wallet signs with admin EOA but `address` is the smart account | set `signerAddress` on the `CheckoutSigner` to the admin EOA |
| `404` on `b2b-buy-order` | wrong base URL | must include `/api/v1` |
| `404 Activity log not found` on link-order | step-1 POST didn't land | check step-1 response body |

---

## 6. Fail-open guarantees

- Fraud-engine outage → step 1 fails, step 2 still runs, step 3 is skipped.
  **Order is placed**, but merchant app will reject it (no screening record);
  the user can retry once the engine recovers.
- `signMessage` not implemented → steps 1 and 3 both skipped, step 2 runs.
  Same outcome.

Screening can never block a buy on widget-side bugs, but every order needs the
screening record to be accepted by merchants — so don't ship without it.
