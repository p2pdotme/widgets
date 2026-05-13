# LotPot onramp placement reverts with "Execution reverted for an unknown reason"

**Symptom.** After swapping the old `LotPotCheckoutIntegrator` for the new
credit-aware build (branch `lotpot/credit-redemption-and-fraud-guard`,
commit `89666cf`), every onramp BUY placement reverts. The host's wallet
surfaces a generic *"Execution reverted for an unknown reason"* because
the revert is a custom error whose selector isn't in the host's ABI.

**Most likely root cause.** The new integrator was registered on the
P2P Diamond with the **wrong `proxyImpl`** — almost certainly the OLD
integrator's UserProxy address that got copy-pasted from a deploy script
or a hardcoded constant. `registerIntegrator` accepts the call silently;
the mismatch only surfaces later, inside the Diamond's CREATE2
authorization check on `placeB2BOrder`.

---

## Why this regressed at the integrator swap

### 1. The credit branch ships a NEW `UserProxy` bytecode

`p2p-checkout/contracts/UserProxy.sol` was modified on the credit branch:

- `sweepERC20(token)` now reverts with `USDCSweepBlocked` when `token` is
  the integrator's USDC. The token address is resolved at runtime via
  `IUsdcSource(integrator()).usdc()`.
- `execute(...)` no longer auto-sweeps the USDC remainder back to the
  owner EOA — unspent USDC stays on the proxy as credit.

Different source → different deployed bytecode → different `proxyImpl`
address when the new integrator runs `address(new UserProxy())` in its
constructor (`LotPotCheckoutIntegrator.sol:316`).

### 2. `registerIntegrator` does NOT verify the `proxyImpl` you pass

From `contracts-v4/contracts/facets/B2BGatewayFacet.sol:115-139`:

```solidity
function registerIntegrator(
    address integrator,
    bool usdcThroughIntegrator,
    address proxyImpl
) external onlySuperAdmin {
    if (integrator == address(0) || proxyImpl == address(0)) revert Errors.ZeroAddress();

    B2BGatewayStorage.IntegratorConfig storage cfg = B2BGatewayStorage.layout().integrators[integrator];

    // proxyImpl is set-once. Rotating it would invalidate every UserProxy
    // clone already deployed by the integrator, so re-registration is
    // allowed only with the same value.
    if (cfg.proxyImpl != address(0) && cfg.proxyImpl != proxyImpl) {
        revert Errors.B2BProxyImplLocked();
    }

    cfg.isActive = true;
    cfg.usdcThroughIntegrator = usdcThroughIntegrator;
    cfg.proxyImpl = proxyImpl;
}
```

The only checks are non-zero, and (on re-registration) same value as
before. The Diamond **never reads `integrator.proxyImpl()` to verify
the values match.** Per the docblock, "the protocol relies on
superAdmin's pre-registration code review."

So `registerIntegrator` succeeding tells you *something* was stored, not
that the stored value is correct.

### 3. The Diamond authorizes proxies by CREATE2 prediction, not by registry

There is **no per-user proxy registration** anywhere. The Diamond's only
authorization signal for `placeB2BOrder` is to re-derive the expected
CREATE2 address using its own stored `cfg.proxyImpl`:

`B2BGatewayFacet.sol:380-417`:

```solidity
function _resolveIntegrator() internal view returns (address) {
    address proxy = msg.sender;
    if (proxy.code.length == 0) revert Errors.B2BCallerNotContract();

    address integrator = IUserProxy(proxy).integrator();
    B2BGatewayStorage.IntegratorConfig storage cfg = …integrators[integrator];
    if (!cfg.isActive || cfg.proxyImpl == address(0)) revert Errors.B2BIntegratorInactive();

    address endUser = IUserProxy(proxy).owner();
    address expected = _predictCloneAddress(
        cfg.proxyImpl,                                       // ← Diamond's stored impl
        abi.encodePacked(endUser, integrator),
        bytes32(uint256(uint160(endUser))),
        integrator
    );
    if (expected != proxy) revert Errors.B2BProxyAddressMismatch();   // ← THE REVERT
    return integrator;
}
```

The integrator-side `_ensureProxy` deploys clones using
`integrator.proxyImpl` (its own pinned impl). If that differs from
`cfg.proxyImpl` on the Diamond, the CREATE2 initcode hashes differ →
predicted address ≠ actual deployed proxy → `B2BProxyAddressMismatch()`.

`B2BProxyAddressMismatch()` is a custom error with no string. Host ABIs
don't include it. viem reports "Execution reverted for an unknown
reason."

---

## Diagnosis — three reads

```bash
RPC=<base-sepolia-rpc-url>
NEW_INT=<new-LotPot-integrator-address>
DIAMOND=0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9   # P2P Diamond

# A. What did the integrator actually deploy as its UserProxy template?
cast call $NEW_INT "proxyImpl()(address)" --rpc-url $RPC

# B. What did the admin tell the Diamond to expect?
cast call $DIAMOND "getIntegratorConfig(address)((bool,bool,address,uint256))" $NEW_INT --rpc-url $RPC
#   Returns: (isActive, usdcThroughIntegrator, proxyImpl, activeOrderCount)
#   (If the getter name on your Diamond differs, grep B2BGatewayFacet
#    for the view selector — there is one.)

# C. If A != B, the diagnosis is confirmed.
```

### One-shot proof — trace the failing tx

```bash
cast run <failing-tx-hash> --rpc-url $RPC --quick
# Find the deepest REVERT. The 4-byte selector at that frame is your
# custom error sig. Decode:
cast 4byte 0x<selector>
# Expected: "B2BProxyAddressMismatch()"  (or B2BIntegratorInactive())
```

The widget now logs this selector automatically — see
`src/core/place-error.ts`. On any `placeOrder` / `placeOfframp` revert,
the console gets a structured `[p2p-widget:place:buy|sell]` entry with
`selector`, `revertData`, attempt context, and a hint listing common B2B
gateway custom errors. Decode the selector from the log without having
to spin up `cast run`.

---

## Fix

`proxyImpl` is **set-once** on the Diamond (the `B2BProxyImplLocked`
guard at `B2BGatewayFacet.sol:130-132` rejects re-registration with a
different impl). You cannot rotate it in place.

Two paths forward:

1. **Deploy a fresh integrator address**, then call
   `registerIntegrator(newAddress, false, newIntegrator.proxyImpl())`
   — read the second argument FROM the deployed integrator, do not
   re-use a constant. Update the host's `LOTPOT_INTEGRATOR_ADDRESS`
   constant accordingly. Old proxies (and any USDC stranded on them
   from the now-orphaned integrator) are unrecoverable through the
   new integrator path — recovery requires hitting the old proxies
   directly while the old integrator is still active.

2. **If you happen to have passed the right `proxyImpl` to
   `registerIntegrator` already** (i.e. Step A == Step B above), the
   revert is something else from the secondary-suspects list below.

### Preventive: pre-registration sanity check

Any deploy script that registers a new integrator should read
`integrator.proxyImpl()` and pass that value through, not a stored
constant:

```ts
const newProxyImpl = await publicClient.readContract({
  address: newIntegratorAddress,
  abi: [{ name: "proxyImpl", type: "function", stateMutability: "view",
          inputs: [], outputs: [{ type: "address" }] }],
  functionName: "proxyImpl",
});
await superAdminSigner.writeContract({
  address: diamondAddress,
  abi: B2B_GATEWAY_ABI,
  functionName: "registerIntegrator",
  args: [newIntegratorAddress, false, newProxyImpl],
});
```

---

## What `registerIntegrator` succeeding actually proves

| Question | Answer |
|---|---|
| `cfg.isActive == true`? | Yes |
| `cfg.proxyImpl != address(0)`? | Yes |
| `cfg.proxyImpl == integrator.proxyImpl()`? | **No guarantee** — Diamond doesn't check |
| Per-user proxies need separate registration? | No, none exists |
| `usdcThroughIntegrator` set to what `placeB2BOrder` expects? | **No guarantee** — admin chose the bool |

---

## Secondary suspects (only if `proxyImpl` matches)

These all surface as different reverts that may or may not have ABI
coverage in the host:

1. **`cfg.isActive == false`** → `B2BIntegratorInactive`. Did anyone
   call `deactivateIntegrator(newAddress)`? Re-running
   `registerIntegrator` with the *same* `proxyImpl` flips it back on.

2. **`validateOrder` returns false** → `B2BIntegratorRejectedOrder`
   (`B2BGatewayFacet.sol:177`). On the new integrator
   (`LotPotCheckoutIntegrator.sol:627-647` on credit branch) this fires when:
   - `amount > getUserTxLimit(user, currency)`. If `baseTxLimit` was
     deployed as 0, every nonzero amount fails.
     Check: `cast call $NEW_INT "baseTxLimit()(uint256)"`.
   - `userDailyCount[user][today] + 1 > dailyTxCountLimit`. If
     `dailyTxCountLimit` was deployed as 0, every placement fails.
     Check: `cast call $NEW_INT "dailyTxCountLimit()(uint256)"`.

3. **`usdcThroughIntegrator` registered as `true`.** The credit branch's
   `_placeOrder` comment requires `false`. If registered `true`,
   *completion* (not placement) routes USDC through the integrator,
   but `onOrderComplete` is written to read USDC from the proxy →
   completion reverts. If your failure happens late in the flow, this
   is the cause.

4. **Megapot wiring on the new integrator.** Only matters on the
   credit-only redemption path (when proxy USDC ≥ totalPrice — unlikely
   on a fresh integrator where every user starts with zero credit).
   Check: `cast call $NEW_INT "megapot()(address)"` and call
   `getDrawingState(currentDrawingId())` on the result.

5. **Currency / circle config on the Diamond.** Unchanged across the
   integrator swap, so unlikely — but worth confirming:
   `cast call $DIAMOND "getPriceConfig(bytes32)((uint256,uint256,int256,uint256))"
   $(cast --to-bytes32 INR)` should return a non-zero `buyPrice`.

---

## Adding the missing selectors to the host ABI

So this never reads as "unknown reason" again on the host side, append
these to the host's integrator ABI fragment (the one passed to
`encodeFunctionData` in `placeOrder`):

```ts
const B2B_GATEWAY_ERRORS = [
  { type: "error", name: "B2BProxyAddressMismatch", inputs: [] },
  { type: "error", name: "B2BIntegratorInactive", inputs: [] },
  { type: "error", name: "B2BCallerNotContract", inputs: [] },
  { type: "error", name: "B2BProxyIntegratorReadFailed", inputs: [] },
  { type: "error", name: "B2BProxyOwnerReadFailed", inputs: [] },
  { type: "error", name: "B2BProxyOwnerZero", inputs: [] },
  { type: "error", name: "B2BIntegratorRejectedOrder", inputs: [] },
  { type: "error", name: "B2BProxyImplLocked", inputs: [] },
] as const;

const LOTPOT_INTEGRATOR_ABI = [
  ...EXISTING_LOTPOT_ABI,
  ...B2B_GATEWAY_ERRORS,
] as const;
```

With these in the ABI, viem decodes the revert reason directly and the
host's `onError` surfaces "B2BProxyAddressMismatch" instead of
"Execution reverted for an unknown reason."

---

## Source references

- `p2pdotme-checkout-widget/src/core/order-machine.ts:595-602` — where the
  widget calls the host's `placeOrder`. The widget itself never
  submits the failing tx.
- `p2pdotme-checkout-widget/src/core/place-error.ts` — diagnostic logger
  that surfaces the raw revert data + selector to the console on any
  `placeOrder` / `placeOfframp` failure.
- `p2p-checkout/contracts/LotPotCheckoutIntegrator.sol:316` —
  `proxyImpl = address(new UserProxy())` in the integrator constructor.
- `p2p-checkout/contracts/LotPotCheckoutIntegrator.sol:1014-1025` —
  `_ensureProxy` (deploys per-user clones lazily on first call).
- `contracts-v4/contracts/facets/B2BGatewayFacet.sol:115-139` —
  `registerIntegrator`.
- `contracts-v4/contracts/facets/B2BGatewayFacet.sol:380-417` —
  `_resolveIntegrator` (the CREATE2 authorization check that reverts).
- `p2p-checkout` branch `lotpot/credit-redemption-and-fraud-guard`,
  commit `89666cf` — the credit-redemption changes that introduced the
  new UserProxy bytecode.
