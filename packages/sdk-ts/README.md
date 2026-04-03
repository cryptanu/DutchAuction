# @najnomics/dutch-auction-sdk

TypeScript SDK for integrating Stealth Dutch Auction hook flows in launchpad products.

## What it provides

- `createAuctionClient(config)`
- Healthcheck for RPC/contract/cofhe capabilities
- Auction state reads and quote preflight checks
- HookData builders (`proofs`, `sdk`) only
- Swap + buy orchestration with deterministic error codes
- Two-step pending settlement reads + finalize writes
- Direct encrypted `buyWithPaymentTokenEncrypted` path
- Explicit decrypt paths:
  - `decrypt.forView(...)`
  - `decrypt.forTx(...)`

## Migration stance

Legacy `cofhejs` paths are intentionally unsupported in v1 and fail closed.
Use `@cofhe/sdk` by injecting a cofhe adapter into client config.

## Quick sample

```ts
import { createAuctionClient } from "@najnomics/dutch-auction-sdk";

const client = createAuctionClient({
  chainId: 84532,
  publicClient,
  walletClient,
  addresses,
  pool: { fee: 3000, tickSpacing: 60 },
  cofhe: {
    buildAuctionIntentHookData: async intent => cofheSdk.buildAuctionIntentHookData(intent),
    decryptForView: args => cofheSdk.decrypt.forView(args),
    decryptForTx: args => cofheSdk.decrypt.forTx(args),
  },
});

const health = await client.healthcheck();
```

## Manual Two-Step Flow (v1)

v1 ships with manual finalize as the default and supported integration path.

1) Step 1: submit swap + encrypted intent

```ts
const step1Hash = await client.auction.swapAndBuy({
  poolId,
  swapInput: 2n,
  mode: "sdk",
  intent: {
    desiredAuctionTokens: 10n,
    maxPricePerToken: 110n,
    minPaymentTokensFromSwap: 1900n,
  },
});
```

2) Poll pending settlement for buyer

```ts
const pending = await client.auction.getPendingPurchase({ poolId });
if (!pending.ready) {
  // wait and retry
}
```

3) Build tx proofs from `pending.encFinalPaymentHandle` and `pending.encFinalFillHandle`

```ts
const paymentProof = await cofheSdk.decrypt.forTx({ handle: pending.encFinalPaymentHandle });
const fillProof = await cofheSdk.decrypt.forTx({ handle: pending.encFinalFillHandle });
```

4) Step 2: finalize manually

```ts
const finalizeHash = await client.auction.finalizePendingPurchase({
  poolId,
  paymentProof: {
    value: BigInt(paymentProof.decryptedValue),
    signature: paymentProof.signature,
  },
  fillProof: {
    value: BigInt(fillProof.decryptedValue),
    signature: fillProof.signature,
  },
});
```

### Finalize Errors (deterministic)

- `PROOF_INVALID`: proof signature is not non-empty hex.
- `PENDING_NOT_READY`: no ready pending settlement found for buyer + pool.
- `PENDING_EXPIRED`: finalize deadline passed.
- `WALLET_UNAVAILABLE`: buyer/account missing for buyer-scoped calls.
